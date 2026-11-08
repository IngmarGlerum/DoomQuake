import { useFrame } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import type { Collider } from '@dimforge/rapier3d-compat'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import patientUrl from '../../assets/models/patient.glb?url'
import { sfx } from '../audio'
import { runtime } from '../combat/runtime'
import { CELL, type Level, type Npc } from '../level/types'
import type { Lighting, RGB } from '../render/lighting'
import { player, useGame } from '../store'
import { findPath, randomReachable, straightRun } from './pathing'

/**
 * Patiënten in het gesticht. Model en bewegingen komen uit Mixamo (Adobe): een gerigd
 * menselijk model met motion-capture-clips (stilstaan, lopen) plus houdingen die we additief
 * over de beweging leggen (gebogen/verslagen houding, sluipen, hoofdschudden, knikken).
 * Het ziekenhuishemd en de bleke huid worden in de shader over het model geschilderd.
 *
 * Gedrag:
 * - wander: schuifelt naar willekeurige plekken in de buurt, blijft er even staan
 * - pacer: ijsbeert heen en weer langs een rechte lijn
 * - rocker: staat wiegend te knikken, met het gezicht naar de muur
 * - stander: staat stil met hangende schouders; af en toe een trekkend hoofdschudden
 * Komt de speler dichtbij, dan blijven ze staan, draaien langzaam naar hem toe en volgen hem met hun hoofd.
 */

const WALK_SPEED = 0.85
const NOTICE_RANGE = 6.5
const FORGET_RANGE = 9
const TURN_SPEED = 1.1

let gltfPromise: Promise<GLTF> | null = null
const loadPatient = () => (gltfPromise ??= new GLTFLoader().loadAsync(patientUrl))

interface Clips {
  idle: THREE.AnimationClip
  walk: THREE.AnimationClip
  sad: THREE.AnimationClip
  sneak: THREE.AnimationClip
  shake: THREE.AnimationClip
  nod: THREE.AnimationClip
}

let clipCache: Clips | null = null
function prepareClips(gltf: GLTF): Clips {
  if (clipCache) return clipCache
  const get = (name: string) => gltf.animations.find((a) => a.name === name)!.clone()
  // de loop-animatie op de plek houden: horizontale verplaatsing van de heupen eruit
  const walk = get('walk')
  for (const t of walk.tracks) {
    if (!t.name.endsWith('Hips.position')) continue
    const v = t.values
    for (let i = 0; i < v.length; i += 3) {
      v[i] = v[0]
      v[i + 2] = v[2]
    }
  }
  const additive = (name: string) => {
    const c = get(name)
    THREE.AnimationUtils.makeClipAdditive(c)
    return c
  }
  clipCache = { idle: get('idle'), walk, sad: additive('sad_pose'), sneak: additive('sneak_pose'), shake: additive('headShake'), nod: additive('agree') }
  return clipCache
}

/** Hemd + huid op de bind-pose (T-pose) coördinaten: romp en dijen hemd, de rest bleke huid. */
function patientMaterial(gown: THREE.Color, skin: THREE.Color, seed: number) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGown = { value: gown }
    shader.uniforms.uSkin = { value: skin }
    shader.uniforms.uSeed = { value: seed }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vBind;
uniform vec3 uGown;
uniform vec3 uSkin;
uniform float uSeed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 p = vBind;
  float ax = abs(p.x);
  // romp tot net boven de knie, korte mouwen tot halverwege de bovenarm
  float torso = smoothstep(0.27, 0.24, ax) * smoothstep(0.46, 0.5, p.y) * smoothstep(1.49, 1.45, p.y);
  float sleeve = smoothstep(0.42, 0.39, ax) * smoothstep(1.27, 1.31, p.y) * smoothstep(1.52, 1.48, p.y);
  float gown = max(torso, sleeve);
  // grove stof: lichte verticale streep, vlekken
  float stripe = 0.94 + 0.06 * step(0.5, fract(p.x * 18.0));
  float stain = smoothstep(0.78, 0.92, hash(floor(p.xy * 9.0)));
  vec3 cloth = uGown * stripe * (1.0 - stain * 0.25);
  // huid: vlekkerig, rond de ogen donkerder
  float blotch = 0.9 + 0.1 * hash(floor(p.xy * 30.0));
  float eyes = smoothstep(0.05, 0.0, abs(p.y - 1.66)) * smoothstep(0.07, 0.02, abs(ax - 0.035)) * step(0.05, p.z);
  vec3 skinCol = uSkin * blotch * (1.0 - eyes * 0.55);
  diffuseColor.rgb *= mix(skinCol, cloth, gown);
}`,
      )
      // net als de muren de (vooraf berekende) belichting op de plek overnemen: deels zelf-oplichtend
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.55;')
  }
  mat.customProgramCacheKey = () => 'patient-v2'
  return mat
}

const GOWNS = [0xb8c6c4, 0xc8ccc4, 0xa9b9bf, 0xd0cfc4]
const SKINS = [0xcbb4a2, 0xbfae9e, 0xd2c0b0, 0xb5a597]

type Mode = 'idle' | 'walk' | 'notice'

interface Patient {
  npc: Npc
  root: THREE.Group
  mixer: THREE.AnimationMixer
  actions: Record<keyof Clips, THREE.AnimationAction>
  mat: THREE.MeshStandardMaterial
  head: THREE.Object3D | null
  neck: THREE.Object3D | null
  pos: THREE.Vector3
  heading: number
  homeHeading: number
  mode: Mode
  timer: number
  path: number[]
  /** pacer: de twee eindpunten */
  ends: [number, number] | null
  endIndex: number
  look: number
  twitch: number
  nextTwitch: number
  nextMurmur: number
  walkWeight: number
  collider: Collider | null
  lightTimer: number
  light: RGB
}

const headingFromYaw = (yaw: number) => Math.atan2(-Math.sin(yaw), -Math.cos(yaw))
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

export function Patients({ level, lighting }: { level: Level; lighting: Lighting }) {
  const [gltf, setGltf] = useState<GLTF | null>(null)
  const { world, rapier } = useRapier()

  useEffect(() => {
    if (!level.npcs?.length) return
    let alive = true
    loadPatient()
      .then((g) => alive && setGltf(g))
      .catch((err) => console.warn('Kon het patiëntmodel niet laden', err))
    return () => {
      alive = false
    }
  }, [level])

  const patients = useMemo<Patient[]>(() => {
    if (!gltf || !level.npcs) return []
    const clips = prepareClips(gltf)
    return level.npcs.map((npc, i) => {
      const root = SkeletonUtils.clone(gltf.scene) as THREE.Group
      const mat = patientMaterial(new THREE.Color(GOWNS[i % GOWNS.length]), new THREE.Color(SKINS[(i * 3) % SKINS.length]), i * 7.31)
      root.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
          const m = o as THREE.SkinnedMesh
          m.material = mat
          m.frustumCulled = false
        }
      })
      // lichte variatie in lengte en bouw
      const s = 0.94 + ((i * 37) % 10) / 100
      root.scale.set(s * (0.97 + ((i * 13) % 7) / 100), s, s)
      const mixer = new THREE.AnimationMixer(root)
      const act = (clip: THREE.AnimationClip, weight: number, timeScale = 1) => {
        const a = mixer.clipAction(clip)
        a.setEffectiveWeight(weight)
        a.setEffectiveTimeScale(timeScale)
        a.play()
        a.time = Math.random() * clip.duration
        return a
      }
      const b = npc.behavior
      const actions = {
        idle: act(clips.idle, 1, 0.8 + Math.random() * 0.3),
        walk: act(clips.walk, 0, 0.72),
        sad: act(clips.sad, b === 'pacer' ? 0.5 : 0.95),
        sneak: act(clips.sneak, b === 'pacer' ? 0.65 : b === 'wander' ? 0.25 : 0),
        shake: act(clips.shake, 0, 1.3),
        nod: act(clips.nod, b === 'rocker' ? 1 : 0, 0.7),
      }
      const heading = headingFromYaw(npc.yaw)
      return {
        npc,
        root,
        mixer,
        actions,
        mat,
        head: root.getObjectByName('mixamorigHead') ?? null,
        neck: root.getObjectByName('mixamorigNeck') ?? null,
        pos: new THREE.Vector3(npc.x, npc.y, npc.z),
        heading,
        homeHeading: heading,
        mode: 'idle' as Mode,
        timer: 1 + Math.random() * 4,
        path: [],
        ends: null,
        endIndex: 0,
        look: 0,
        twitch: 0,
        nextTwitch: 3 + Math.random() * 6,
        nextMurmur: 4 + Math.random() * 8,
        walkWeight: 0,
        collider: null,
        lightTimer: 0,
        light: [1, 1, 1] as RGB,
      }
    })
  }, [gltf, level])

  // colliders: de speler botst tegen patiënten, kogels gaan erdoorheen
  useEffect(() => {
    for (const p of patients) {
      p.collider = world.createCollider(rapier.ColliderDesc.capsule(0.55, 0.28).setTranslation(p.pos.x, p.pos.y + 0.85, p.pos.z))
      runtime.passThrough.add(p.collider.handle)
      // pacer: een rechte lijn vanaf de startplek
      if (p.npc.behavior === 'pacer') {
        const end = straightRun(level, p.npc.cell, 4)
        if (end !== p.npc.cell) p.ends = [p.npc.cell, end]
      }
    }
    if (import.meta.env.DEV) Object.assign(window, { __patients: patients })
    return () => {
      for (const p of patients) {
        if (!p.collider) continue
        runtime.passThrough.delete(p.collider.handle)
        try {
          world.removeCollider(p.collider, false)
        } catch {
          // wereld al opgeruimd
        }
        p.collider = null
      }
      for (const p of patients) {
        p.mixer.stopAllAction()
        p.mat.dispose()
      }
    }
  }, [patients, world, rapier, level])

  const tmp = useMemo(() => ({ q: new THREE.Quaternion(), q2: new THREE.Quaternion(), v: new THREE.Vector3(), v2: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }), [])

  useFrame((_, delta) => {
    if (!patients.length) return
    const game = useGame.getState()
    const dt = Math.min(delta, 0.05)
    const active = game.status === 'playing' && game.locked
    for (const p of patients) {
      if (active) think(p, dt)
      animate(p, active ? dt : 0)
    }
  })

  function think(p: Patient, dt: number) {
    const dx = player.position.x - p.pos.x
    const dz = player.position.z - p.pos.z
    const dist = Math.hypot(dx, dz)
    const toPlayer = Math.atan2(dx, dz)

    // opmerken en weer vergeten
    if (p.mode !== 'notice' && dist < NOTICE_RANGE && Math.abs(player.position.y - p.pos.y) < 2.5) {
      p.mode = 'notice'
      p.path = []
      p.timer = 0
      if (Math.random() < 0.6) sfx.murmur(p.pos)
    } else if (p.mode === 'notice' && dist > FORGET_RANGE) {
      p.mode = 'idle'
      p.timer = 1 + Math.random() * 2
    }

    if (p.mode === 'notice') {
      // langzaam omdraaien naar de speler (de rocker blijft naar de muur staan, alleen het hoofd draait)
      if (p.npc.behavior !== 'rocker') p.heading += wrap(toPlayer - p.heading) * Math.min(1, dt * TURN_SPEED)
      p.look = Math.min(1, p.look + dt * 1.2)
      p.nextMurmur -= dt
      if (p.nextMurmur <= 0) {
        p.nextMurmur = 6 + Math.random() * 9
        if (dist < 5) sfx.murmur(p.pos)
      }
    } else {
      p.look = Math.max(0, p.look - dt * 0.8)
      if (p.mode === 'walk') walk(p, dt)
      else {
        // terug naar de oorspronkelijke kijkrichting (rocker en stander)
        if (p.npc.behavior === 'rocker' || p.npc.behavior === 'stander') p.heading += wrap(p.homeHeading - p.heading) * Math.min(1, dt * 0.6)
        p.timer -= dt
        if (p.timer <= 0) startWalk(p)
      }
    }

    // trekkend hoofdschudden
    p.nextTwitch -= dt
    if (p.nextTwitch <= 0) {
      p.nextTwitch = (p.npc.behavior === 'stander' ? 4 : 9) + Math.random() * 8
      p.twitch = 1.4
    }
    p.twitch = Math.max(0, p.twitch - dt)
  }

  function startWalk(p: Patient) {
    const b = p.npc.behavior
    let target = -1
    if (b === 'wander') target = randomReachable(level, p.npc.cell, cellOf(p.pos), 6)
    else if (b === 'pacer' && p.ends) {
      p.endIndex = 1 - p.endIndex
      target = p.ends[p.endIndex]
    } else {
      p.timer = 3 + Math.random() * 4
      return
    }
    const path = target >= 0 ? findPath(level, cellOf(p.pos), target) : []
    if (path.length) {
      p.path = path
      p.mode = 'walk'
    } else {
      p.timer = 1 + Math.random() * 2
    }
  }

  function walk(p: Patient, dt: number) {
    const next = p.path[0]
    if (next === undefined) {
      p.mode = 'idle'
      p.timer = p.npc.behavior === 'pacer' ? 0.8 + Math.random() * 1.5 : 2 + Math.random() * 5
      return
    }
    const tx = ((next % level.width) + 0.5) * CELL
    const tz = (Math.floor(next / level.width) + 0.5) * CELL
    const dx = tx - p.pos.x
    const dz = tz - p.pos.z
    const d = Math.hypot(dx, dz)
    const want = Math.atan2(dx, dz)
    const diff = wrap(want - p.heading)
    p.heading += diff * Math.min(1, dt * 3)
    // eerst (een beetje) draaien, dan pas schuifelen
    const step = WALK_SPEED * dt * Math.max(0, Math.cos(diff)) * p.walkWeight
    if (d <= step + 0.05) {
      p.path.shift()
      return
    }
    p.pos.x += (dx / d) * step
    p.pos.z += (dz / d) * step
  }

  function animate(p: Patient, dt: number) {
    const walking = p.mode === 'walk'
    p.walkWeight += ((walking ? 1 : 0) - p.walkWeight) * Math.min(1, dt * 3)
    p.actions.walk.setEffectiveWeight(p.walkWeight)
    p.actions.idle.setEffectiveWeight(1 - p.walkWeight)
    const shake = p.twitch > 0 ? Math.sin((1 - p.twitch / 1.4) * Math.PI) : 0
    p.actions.shake.setEffectiveWeight(shake)
    if (p.npc.behavior === 'rocker') p.actions.nod.setEffectiveWeight(p.mode === 'notice' ? 0.4 : 1)
    p.mixer.update(dt)

    // hoogte volgen (traptreden) en model plaatsen
    const c = level.cells[cellOf(p.pos)]
    if (c && !c.solid) p.pos.y += (c.floor - p.pos.y) * Math.min(1, dt * 10)
    p.root.position.copy(p.pos)
    p.root.rotation.y = p.heading
    p.collider?.setTranslation({ x: p.pos.x, y: p.pos.y + 0.85, z: p.pos.z })

    // hoofd (en een beetje de nek) draait naar de speler
    if (p.look > 0.01 && p.head && p.neck) {
      p.root.updateMatrixWorld(true)
      const { q, q2, v, v2 } = tmp
      p.head.getWorldPosition(v)
      v2.set(player.position.x, player.position.y + 1.55, player.position.z).sub(v).normalize()
      // huidige kijkrichting van het hoofd ≈ voorkant van het lichaam
      const fwd = v.set(Math.sin(p.heading), 0, Math.cos(p.heading))
      q.setFromUnitVectors(fwd, v2)
      // niet verder draaien dan een mens kan (±70°)
      const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)))
      const limit = 1.2
      const k = (angle > limit ? limit / angle : 1) * p.look
      q2.identity().slerp(q, k * 0.4)
      twistBone(p.neck, q2)
      q2.identity().slerp(q, k * 0.6)
      twistBone(p.head, q2)
    }

    // meekleuren met het licht op de plek
    p.lightTimer -= dt
    if (p.lightTimer <= 0) {
      p.lightTimer = 0.25
      lighting.sample(p.pos.x, p.pos.y + 1.5, p.pos.z, undefined, p.light)
      p.mat.color.setRGB(Math.min(1.5, 0.12 + p.light[0]), Math.min(1.5, 0.12 + p.light[1]), Math.min(1.5, 0.12 + p.light[2]))
    }
  }

  /** Extra draaiing (in wereldruimte) toepassen op een bot, bovenop de animatie. */
  function twistBone(bone: THREE.Object3D, worldDelta: THREE.Quaternion) {
    const parentWorld = tmp.q.clone()
    bone.parent!.getWorldQuaternion(parentWorld)
    const boneWorld = new THREE.Quaternion()
    bone.getWorldQuaternion(boneWorld)
    boneWorld.premultiply(worldDelta)
    bone.quaternion.copy(parentWorld.invert().multiply(boneWorld))
    bone.updateMatrixWorld(true)
  }

  const cellOf = (pos: THREE.Vector3) => Math.floor(pos.z / CELL) * level.width + Math.floor(pos.x / CELL)

  return (
    <>
      {patients.map((p, i) => (
        <primitive key={i} object={p.root} />
      ))}
    </>
  )
}
