import { useFrame } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import type { Collider } from '@dimforge/rapier3d-compat'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import maleUrl from '../../assets/models/patient-male.glb?url'
import mocapUrl from '../../assets/models/mocap-xbot.glb?url'
import { sfx } from '../audio'
import { fx } from '../combat/Effects'
import { runtime, type NpcTarget } from '../combat/runtime'
import { CELL, type Level, type Npc } from '../level/types'
import type { Lighting, RGB } from '../render/lighting'
import { player, useGame } from '../store'
import { findPath, randomReachable, straightRun } from './pathing'
import { retargetClip } from './retarget'
import { blood } from '../combat/BloodFX'
import { paintFor, patientMaterial, patientUniforms, rotSpots, MAX_WOUNDS, type ClothLook, type PatientUniforms } from './patientMaterials'

/**
 * Patiënten in het gesticht.
 *
 * Lichaam: "Michelle", een Mixamo-personage met realistische textures (kleur, normal map, glans).
 * Bewegingen: motion capture uit de Mixamo-bibliotheek (stilstaan, lopen, rennen, plus houdingen die
 * additief over de beweging liggen), bij het laden van het Xbot-skelet naar Michelle geretarget.
 * Het nachthemd of dwangbuis wordt in de shader over haar kleding geschilderd; haar normal map
 * (plooien) blijft zichtbaar. Armhoudingen (gekruist in een dwangbuis, gestrekt als een zombie,
 * uithalen) worden met een kleine IK bovenop de motion capture gezet.
 *
 * Gedrag zolang je ze met rust laat: rondschuifelen, ijsberen, wiegen tegen de muur of stil staan
 * met af en toe een trekking; komt de speler dichtbij, dan draaien ze langzaam naar hem toe en volgen
 * hem met hun hoofd. Val je ze aan, dan slaan de meesten door: met gestrekte armen schuifelen ze op je
 * af en halen ze uit. Wie een dwangbuis draagt (of bang is) rent weg en kruipt in een hoek.
 */

const WALK_SPEED = 0.85
const HOSTILE_SPEED = 1.45
const FLEE_SPEED = 2.8
const NOTICE_RANGE = 6.5
const FORGET_RANGE = 9
const TURN_SPEED = 1.1
const HP = 70
const ATTACK_RANGE = 1.35
const HIT_RANGE = 1.9
const ATTACK_TIME = 1.0
const STRIKE_AT = 0.45

interface Clips {
  idle: THREE.AnimationClip
  walk: THREE.AnimationClip
  run: THREE.AnimationClip
  sad: THREE.AnimationClip
  sneak: THREE.AnimationClip
  shake: THREE.AnimationClip
  nod: THREE.AnimationClip
}

interface Body {
  gltf: GLTF
  clips: Clips
  /** voorvoegsel van de botnamen ('mixamorig' bij Michelle, niets bij Ready Player Me) */
  prefix: string
  /** Michelle: één mesh waarop het hemd geschilderd wordt; man: losse kledingstukken */
  kind: 'female' | 'male'
}

interface Assets {
  bodies: Body[]
}

let assetsPromise: Promise<Assets> | null = null
const loadAssets = () => (assetsPromise ??= load())

async function load(): Promise<Assets> {
  const loader = new GLTFLoader()
  const [male, mocap] = await Promise.all([loader.loadAsync(maleUrl), loader.loadAsync(mocapUrl)])
  mocap.scene.updateMatrixWorld(true)
  const hipY = (root: THREE.Object3D, name: string) => root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3()).y
  const sourceHip = hipY(mocap.scene, 'mixamorigHips')

  const make = (gltf: GLTF, prefix: string, kind: Body['kind'], alignArms: boolean): Body => {
    gltf.scene.updateMatrixWorld(true)
    const options = {
      hip: `${prefix}Hips`,
      // heupbeweging schalen naar de lengte van dit lichaam
      hipScale: hipY(gltf.scene, `${prefix}Hips`) / sourceHip,
      sourceName: (n: string) => `mixamorig${n.slice(prefix.length)}`,
      alignArms,
    }
    const retarget = (name: string) => retargetClip(mocap.scene, mocap.animations.find((a) => a.name === name)!, gltf.scene, options)
    const additive = (name: string, pose: boolean) => {
      let c = retarget(name)
      THREE.AnimationUtils.makeClipAdditive(c)
      // houdingsclips gaan van neutraal naar de houding; alleen de houding zelf gebruiken
      // (anders knikt het lichaam steeds naar voren en terug)
      if (pose) c = THREE.AnimationUtils.subclip(c, name, 2, 3, 30)
      return c
    }
    return {
      gltf,
      prefix,
      kind,
      clips: {
        idle: retarget('idle'),
        walk: retarget('walk'),
        run: retarget('run'),
        sad: additive('sad_pose', true),
        sneak: additive('sneak_pose', true),
        shake: additive('headShake', false),
        nod: additive('agree', false),
      },
    }
  }
  return { bodies: [make(male, '', 'male', true)] }
}

// stof is nooit spierwit: vergeeld, grauw (onder een zaklamp slaat wit anders uit)
const CLOTHS = [0x948e80, 0x8c8a80, 0x868c88, 0x99938a, 0x8a8372]
const JACKET = 0xa29e92

type Mode = 'idle' | 'walk' | 'notice' | 'hostile' | 'attack' | 'flee' | 'dead'

interface Patient {
  npc: Npc
  root: THREE.Group
  mixer: THREE.AnimationMixer
  actions: Record<keyof Clips, THREE.AnimationAction>
  mats: THREE.Material[]
  /** gedeelde uniforms: eigen licht (gebakken licht op de plek), kogelwonden, rotte plekken */
  uniforms: PatientUniforms
  /** voorkant van het hoofd, in de ruimte van het hoofdbot */
  headForward: THREE.Vector3
  /** meshes met een 'mouthOpen'-vorm (hoofd, tanden, baard, ogen) voor de onderkaak */
  jaws: { mesh: THREE.SkinnedMesh; index: number }[]
  /** mesh waarvan het skelet gebruikt wordt om kogelgaten op het lichaam vast te zetten */
  refMesh: THREE.SkinnedMesh | null
  jaw: number
  /** loopt af tijdens een reeks hongerige happen */
  bite: number
  nextBite: number
  woundIndex: number
  /** plas bloed onder het lijk al gelegd */
  pooled: boolean
  bones: Record<'head' | 'neck' | 'armL' | 'foreL' | 'handL' | 'armR' | 'foreR' | 'handR', THREE.Object3D | null>
  jacket: boolean
  pos: THREE.Vector3
  heading: number
  homeHeading: number
  mode: Mode
  timer: number
  path: number[]
  repath: number
  ends: [number, number] | null
  endIndex: number
  look: number
  twitch: number
  nextTwitch: number
  nextSound: number
  walkWeight: number
  runWeight: number
  /** gewicht van de zombie-armen (gestrekt naar voren) */
  reach: number
  attackT: number
  struck: boolean
  cooldown: number
  hp: number
  deadT: number
  collider: Collider | null
  target: NpcTarget | null
  lightTimer: number
  light: RGB
}

const headingFromYaw = (yaw: number) => Math.atan2(-Math.sin(yaw), -Math.cos(yaw))
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const ease = (k: number) => k * k * (3 - 2 * k)

export function Patients({ level, lighting }: { level: Level; lighting: Lighting }) {
  const [assets, setAssets] = useState<Assets | null>(null)
  const { world, rapier } = useRapier()

  useEffect(() => {
    if (!level.npcs?.length) return
    let alive = true
    loadAssets()
      .then((a) => alive && setAssets(a))
      .catch((err) => console.warn('Kon de patiënten niet laden', err))
    return () => {
      alive = false
    }
  }, [level])

  const patients = useMemo<Patient[]>(() => {
    if (!assets || !level.npcs) return []
    const { bodies } = assets
    return level.npcs.map((npc, i) => {
      const body = bodies[i % bodies.length]
      const root = SkeletonUtils.clone(body.gltf.scene) as THREE.Group
      root.rotation.order = 'YXZ'
      const jacket = npc.behavior === 'rocker' || i % 5 === 2
      const look: ClothLook = {
        cloth: new THREE.Color(jacket ? JACKET : CLOTHS[i % CLOTHS.length]),
        jacket: jacket ? 1 : 0,
        blood: i % 3 === 1 ? 0.8 : i % 4 === 0 ? 0.35 : 0.15,
      }
      const uniforms = patientUniforms(i * 7.31, rotSpots(i))
      const mats: THREE.Material[] = []
      const made = new Map<THREE.Material, THREE.Material>()
      const jaws: { mesh: THREE.SkinnedMesh; index: number }[] = []
      let refMesh: THREE.SkinnedMesh | null = null
      root.traverse((o) => {
        const m = o as THREE.SkinnedMesh
        if (!m.isSkinnedMesh) return
        const base = m.material as THREE.MeshStandardMaterial
        const paint = paintFor(base.name)
        // geen hoed, geen baard (die verbergt de bebloede mond)
        if (paint === 'hide' || paint === 'beard') {
          m.visible = false
          return
        }
        let mat = made.get(base)
        if (!mat) {
          mat = patientMaterial(base, paint, uniforms, paint === 'cloth' ? look : undefined)
          made.set(base, mat)
          mats.push(mat)
        }
        m.material = mat
        m.frustumCulled = false
        m.castShadow = true
        m.receiveShadow = true
        const jaw = m.morphTargetDictionary?.mouthOpen
        if (jaw !== undefined) jaws.push({ mesh: m, index: jaw })
        if (base.name === 'Wolf3D_Outfit_Top') refMesh = m
      })
      const s = 0.97 + ((i * 37) % 9) / 100
      root.scale.setScalar(s)
      const mixer = new THREE.AnimationMixer(root)
      const clips = body.clips
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
        idle: act(clips.idle, 1, 0.75 + Math.random() * 0.3),
        walk: act(clips.walk, 0, 0.72),
        run: act(clips.run, 0, 1),
        sad: act(clips.sad, b === 'pacer' ? 0.4 : 0.6),
        sneak: act(clips.sneak, b === 'pacer' ? 0.6 : b === 'wander' ? 0.25 : 0),
        shake: act(clips.shake, 0, 1.3),
        nod: act(clips.nod, b === 'rocker' ? 1 : 0, 0.6),
      }
      const bone = (n: string) => root.getObjectByName(`${body.prefix}${n}`) ?? null
      // voorkant van het hoofd in de ruimte van het hoofdbot (in rust kijkt het model naar +z)
      root.updateMatrixWorld(true)
      const headBone = bone('Head')
      const headForward = headBone ? new THREE.Vector3(0, 0, 1).applyQuaternion(headBone.getWorldQuaternion(new THREE.Quaternion()).invert()) : new THREE.Vector3(0, 0, 1)
      const heading = headingFromYaw(npc.yaw)
      return {
        npc,
        root,
        mixer,
        actions,
        mats,
        uniforms,
        headForward,
        jaws,
        refMesh,
        jaw: 0,
        bite: 0,
        nextBite: 2 + Math.random() * 5,
        woundIndex: 0,
        pooled: false,
        bones: {
          head: bone('Head'),
          neck: bone('Neck'),
          armL: bone('LeftArm'),
          foreL: bone('LeftForeArm'),
          handL: bone('LeftHand'),
          armR: bone('RightArm'),
          foreR: bone('RightForeArm'),
          handR: bone('RightHand'),
        },
        jacket,
        pos: new THREE.Vector3(npc.x, npc.y, npc.z),
        heading,
        homeHeading: heading,
        mode: 'idle' as Mode,
        timer: 1 + Math.random() * 4,
        path: [],
        repath: 0,
        ends: null,
        endIndex: 0,
        look: 0,
        twitch: 0,
        nextTwitch: 3 + Math.random() * 6,
        nextSound: 4 + Math.random() * 8,
        walkWeight: 0,
        runWeight: 0,
        reach: 0,
        attackT: 0,
        struck: false,
        cooldown: 0,
        hp: HP,
        deadT: 0,
        collider: null,
        target: null,
        lightTimer: 0,
        light: [1, 1, 1] as RGB,
      }
    })
  }, [assets, level])

  // colliders (de speler botst ertegen, kogels raken ze) en de schade-afhandeling
  useEffect(() => {
    for (const p of patients) {
      p.collider = world.createCollider(rapier.ColliderDesc.capsule(0.55, 0.28).setTranslation(p.pos.x, p.pos.y + 0.85, p.pos.z))
      p.target = { pos: p.pos, radius: 0.3, height: 1.7, alive: () => p.mode !== 'dead', hurt: (amount, point, dir) => hurt(p, amount, point, dir) }
      runtime.npcByCollider.set(p.collider.handle, p.target)
      runtime.npcs.add(p.target)
      if (p.npc.behavior === 'pacer') {
        const end = straightRun(level, p.npc.cell, 4)
        if (end !== p.npc.cell) p.ends = [p.npc.cell, end]
      }
    }
    if (import.meta.env.DEV) Object.assign(window, { __patients: patients })
    return () => {
      for (const p of patients) {
        if (p.target) runtime.npcs.delete(p.target)
        removeCollider(p)
        p.mixer.stopAllAction()
        p.mats.forEach((m) => m.dispose())
      }
    }
    // hurt/removeCollider zijn stabiele functies in deze component
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patients, world, rapier, level])

  function removeCollider(p: Patient) {
    if (!p.collider) return
    runtime.npcByCollider.delete(p.collider.handle)
    try {
      world.removeCollider(p.collider, false)
    } catch {
      // wereld al opgeruimd
    }
    p.collider = null
  }

  /**
   * Kogelgat op de plek van de treffer, blijvend op het lichaam: het trefpunt wordt via het
   * dichtstbijzijnde bot terugvertaald naar de bind-pose, waar de shader de wond tekent.
   */
  function addWound(p: Patient, point: THREE.Vector3, amount: number) {
    const mesh = p.refMesh
    if (!mesh) return
    p.root.updateMatrixWorld(true)
    const bones = mesh.skeleton.bones
    // bot waarvan het segment (bot → eerste kind) het dichtst bij de treffer ligt
    let best = 0
    let bestD = Infinity
    const a = tmp.a
    const b = tmp.b
    const seg = new THREE.Line3()
    const closest = new THREE.Vector3()
    bones.forEach((bone, i) => {
      bone.getWorldPosition(a)
      const child = bone.children.find((c) => (c as THREE.Bone).isBone)
      if (child) child.getWorldPosition(b)
      else b.copy(a)
      seg.set(a, b).closestPointToPoint(point, true, closest)
      const d = closest.distanceToSquared(point)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    // wereld → (huidige) botruimte → bind-pose van de mesh:  P = Bi · boneInverse⁻¹ · Bw⁻¹ · B · M⁻¹ · H
    const v = point.clone()
    v.applyMatrix4(tmp.m1.copy(mesh.matrixWorld).invert())
    v.applyMatrix4(mesh.bindMatrix)
    v.applyMatrix4(tmp.m1.copy(bones[best].matrixWorld).invert())
    v.applyMatrix4(tmp.m1.copy(mesh.skeleton.boneInverses[best]).invert())
    v.applyMatrix4(mesh.bindMatrixInverse)
    const w = p.uniforms.uWounds.value[p.woundIndex % MAX_WOUNDS]
    w.set(v.x, v.y, v.z, THREE.MathUtils.clamp(0.008 + amount * 0.0009, 0.009, 0.022))
    p.woundIndex++
    p.uniforms.uWoundCount.value = Math.min(MAX_WOUNDS, p.woundIndex)
  }

  function hurt(p: Patient, amount: number, point: THREE.Vector3, dir: THREE.Vector3) {
    if (p.mode === 'dead') return
    p.hp -= amount
    fx.fleshImpact(point, dir, Math.min(2.5, amount / 8))
    addWound(p, point, amount)
    p.pos.addScaledVector(tmp.v.set(dir.x, 0, dir.z).normalize(), Math.min(0.2, amount * 0.008))
    p.twitch = 1.4
    if (p.hp <= 0) {
      p.mode = 'dead'
      p.deadT = 0
      fx.fleshImpact(point, dir, 3)
      sfx.npcDeath(p.pos)
      removeCollider(p)
      return
    }
    if (p.mode === 'hostile' || p.mode === 'attack' || p.mode === 'flee') return
    // de meesten slaan door; wie een dwangbuis draagt (of bang is) vlucht
    if (p.jacket || p.npc.variant % 4 === 3) {
      p.mode = 'flee'
      p.timer = 3.5
      p.path = []
      sfx.whimper(p.pos)
    } else {
      p.mode = 'hostile'
      p.path = []
      p.repath = 0
      sfx.shriek(p.pos)
    }
  }

  const tmp = useMemo(
    () => ({
      q: new THREE.Quaternion(),
      q2: new THREE.Quaternion(),
      m1: new THREE.Matrix4(),
      v: new THREE.Vector3(),
      v2: new THREE.Vector3(),
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
      pq: new THREE.Quaternion(),
      bq: new THREE.Quaternion(),
    }),
    [],
  )

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

  const cellOf = (pos: THREE.Vector3) => Math.floor(pos.z / CELL) * level.width + Math.floor(pos.x / CELL)

  function think(p: Patient, dt: number) {
    if (p.mode === 'dead') return
    const dx = player.position.x - p.pos.x
    const dz = player.position.z - p.pos.z
    const dist = Math.hypot(dx, dz)
    const toPlayer = Math.atan2(dx, dz)
    p.cooldown = Math.max(0, p.cooldown - dt)

    // trekkend hoofdschudden
    p.nextTwitch -= dt
    if (p.nextTwitch <= 0) {
      p.nextTwitch = (p.npc.behavior === 'stander' ? 4 : 9) + Math.random() * 8
      p.twitch = 1.4
    }
    p.twitch = Math.max(0, p.twitch - dt)

    if (p.mode === 'hostile' || p.mode === 'attack') return hostile(p, dt, dist, toPlayer)
    if (p.mode === 'flee') return flee(p, dt, dx, dz)

    // opmerken en weer vergeten
    if (p.mode !== 'notice' && dist < NOTICE_RANGE && Math.abs(player.position.y - p.pos.y) < 2.5) {
      p.mode = 'notice'
      p.path = []
      if (Math.random() < 0.6) sfx.murmur(p.pos)
    } else if (p.mode === 'notice' && dist > FORGET_RANGE) {
      p.mode = 'idle'
      p.timer = 1 + Math.random() * 2
    }

    if (p.mode === 'notice') {
      if (p.npc.behavior !== 'rocker') p.heading += wrap(toPlayer - p.heading) * Math.min(1, dt * TURN_SPEED)
      p.look = Math.min(1, p.look + dt * 1.2)
      p.nextSound -= dt
      if (p.nextSound <= 0) {
        p.nextSound = 6 + Math.random() * 9
        if (dist < 5) sfx.murmur(p.pos)
      }
      return
    }
    p.look = Math.max(0, p.look - dt * 0.8)
    if (p.mode === 'walk') {
      if (followPath(p, dt, WALK_SPEED)) {
        p.mode = 'idle'
        p.timer = p.npc.behavior === 'pacer' ? 0.8 + Math.random() * 1.5 : 2 + Math.random() * 5
      }
      return
    }
    if (p.npc.behavior === 'rocker' || p.npc.behavior === 'stander') p.heading += wrap(p.homeHeading - p.heading) * Math.min(1, dt * 0.6)
    p.timer -= dt
    if (p.timer <= 0) startWalk(p)
  }

  /** Doorgeslagen: met gestrekte armen op de speler af, en uithalen als hij dichtbij is. */
  function hostile(p: Patient, dt: number, dist: number, toPlayer: number) {
    p.look = Math.min(1, p.look + dt * 2)
    p.nextSound -= dt
    if (p.nextSound <= 0) {
      p.nextSound = 2.5 + Math.random() * 3.5
      sfx.groan(p.pos)
    }
    if (p.mode === 'attack') {
      p.attackT += dt
      p.heading += wrap(toPlayer - p.heading) * Math.min(1, dt * 6)
      if (!p.struck && p.attackT >= STRIKE_AT) {
        p.struck = true
        sfx.swipe(p.pos)
        if (dist < HIT_RANGE && !useGame.getState().noclip) {
          useGame.getState().damage(9 + Math.round(Math.random() * 6))
          sfx.hurt()
          player.impulse.x += Math.sin(p.heading) * 3
          player.impulse.z += Math.cos(p.heading) * 3
        }
      }
      if (p.attackT >= ATTACK_TIME) {
        p.mode = 'hostile'
        p.cooldown = 0.5 + Math.random() * 0.4
      }
      return
    }
    if (dist < ATTACK_RANGE && p.cooldown <= 0) {
      p.mode = 'attack'
      p.attackT = 0
      p.struck = false
      return
    }
    if (dist < 2.5) {
      // dichtbij: recht op de speler af
      p.heading += wrap(toPlayer - p.heading) * Math.min(1, dt * 4)
      if (dist > 1.0) moveForward(p, HOSTILE_SPEED * dt)
      return
    }
    p.repath -= dt
    if (p.repath <= 0 || !p.path.length) {
      p.repath = 0.5
      p.path = findPath(level, cellOf(p.pos), player.cell)
    }
    followPath(p, dt, HOSTILE_SPEED)
  }

  /** Bang: wegrennen van de speler, daarna ineengedoken staan. */
  function flee(p: Patient, dt: number, dx: number, dz: number) {
    p.look = Math.max(0, p.look - dt)
    p.timer -= dt
    if (p.timer <= 0) {
      p.mode = 'idle'
      p.timer = 6 + Math.random() * 6
      p.homeHeading = Math.atan2(dx, dz) + Math.PI
      p.npc.behavior = 'stander'
      return
    }
    if (!p.path.length) {
      // een plek zoeken die verder van de speler af ligt
      let best = -1
      let bestD = -1
      for (let i = 0; i < 8; i++) {
        const c = randomReachable(level, cellOf(p.pos), cellOf(p.pos), 7)
        if (c < 0) continue
        const cx = ((c % level.width) + 0.5) * CELL
        const cz = (Math.floor(c / level.width) + 0.5) * CELL
        const d = Math.hypot(cx - player.position.x, cz - player.position.z)
        if (d > bestD) {
          bestD = d
          best = c
        }
      }
      if (best >= 0) p.path = findPath(level, cellOf(p.pos), best)
    }
    followPath(p, dt, FLEE_SPEED)
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

  /** Loop over het pad; true zodra het einde bereikt is. */
  function followPath(p: Patient, dt: number, speed: number) {
    const next = p.path[0]
    if (next === undefined) return true
    const tx = ((next % level.width) + 0.5) * CELL
    const tz = (Math.floor(next / level.width) + 0.5) * CELL
    const dx = tx - p.pos.x
    const dz = tz - p.pos.z
    const d = Math.hypot(dx, dz)
    const diff = wrap(Math.atan2(dx, dz) - p.heading)
    p.heading += diff * Math.min(1, dt * 3.5)
    const step = speed * dt * Math.max(0, Math.cos(diff))
    if (d <= step + 0.05) {
      p.path.shift()
      return p.path.length === 0
    }
    p.pos.x += (dx / d) * step
    p.pos.z += (dz / d) * step
    return false
  }

  /** Recht vooruit, maar alleen als de cel waar hij heen gaat beloopbaar is. */
  function moveForward(p: Patient, step: number) {
    const nx = p.pos.x + Math.sin(p.heading) * step
    const nz = p.pos.z + Math.cos(p.heading) * step
    const c = level.cells[Math.floor(nz / CELL) * level.width + Math.floor(nx / CELL)]
    if (!c || c.solid || c.prop || c.floor < -1) return
    p.pos.x = nx
    p.pos.z = nz
  }

  function animate(p: Patient, dt: number) {
    if (p.mode === 'dead') return die(p, dt)
    const hostile = p.mode === 'hostile' || p.mode === 'attack'
    const moving = p.mode === 'walk' || (hostile && p.mode !== 'attack') || p.mode === 'flee'
    const running = p.mode === 'flee'
    p.walkWeight += ((moving && !running ? 1 : 0) - p.walkWeight) * Math.min(1, dt * 3)
    p.runWeight += ((running ? 1 : 0) - p.runWeight) * Math.min(1, dt * 4)
    p.actions.walk.setEffectiveWeight(p.walkWeight)
    p.actions.run.setEffectiveWeight(p.runWeight)
    p.actions.idle.setEffectiveWeight(Math.max(0, 1 - p.walkWeight - p.runWeight))
    p.actions.walk.setEffectiveTimeScale(hostile ? 1.0 : 0.72)
    p.actions.sneak.setEffectiveWeight(hostile ? 0.7 : p.npc.behavior === 'pacer' ? 0.6 : p.npc.behavior === 'wander' ? 0.25 : 0)
    p.actions.sad.setEffectiveWeight(hostile || running ? 0.2 : p.npc.behavior === 'pacer' ? 0.4 : 0.6)
    p.actions.shake.setEffectiveWeight(p.twitch > 0 ? Math.sin((1 - p.twitch / 1.4) * Math.PI) : 0)
    if (p.npc.behavior === 'rocker') p.actions.nod.setEffectiveWeight(p.mode === 'notice' ? 0.4 : hostile ? 0 : 1)
    p.mixer.update(dt)
    chew(p, dt, hostile)

    const c = level.cells[cellOf(p.pos)]
    if (c && !c.solid) p.pos.y += (c.floor - p.pos.y) * Math.min(1, dt * 10)
    p.root.position.copy(p.pos)
    p.root.rotation.set(0, p.heading, 0)
    p.collider?.setTranslation({ x: p.pos.x, y: p.pos.y + 0.85, z: p.pos.z })
    p.root.updateMatrixWorld(true)

    // armen bovenop de motion capture: dwangbuis (gekruist), zombie (gestrekt), uithalen
    p.reach += ((hostile ? 1 : 0) - p.reach) * Math.min(1, dt * 3)
    if (p.jacket) {
      pose(p, [0.15, -0.75, 0.5], [-1, 0.12, 0.3], [-0.15, -0.75, 0.5], [1, 0.22, 0.3], 1)
    } else if (p.mode === 'attack') {
      const t = p.attackT
      const raise = ease(Math.min(1, t / STRIKE_AT))
      const strike = ease(Math.min(1, Math.max(0, (t - STRIKE_AT) / 0.15)))
      const back = ease(Math.min(1, Math.max(0, (t - STRIKE_AT - 0.2) / 0.35)))
      const mixDir = (a: number[], b: number[], k: number) => a.map((v, i) => v + (b[i] - v) * k) as [number, number, number]
      const up = [0.3, 0.8, 0.5]
      const down = [-0.2, -0.55, 0.8]
      const reach = [0.12, 0.0, 1]
      let armL = mixDir(reach, up, raise)
      armL = mixDir(armL, down, strike)
      armL = mixDir(armL, reach, back)
      const armR: [number, number, number] = [-armL[0], armL[1], armL[2]]
      pose(p, armL, [armL[0] * 0.5, armL[1] - 0.1, 1], armR, [armR[0] * 0.5, armR[1] - 0.1, 1], 1)
    } else if (p.reach > 0.02) {
      const sway = Math.sin(performance.now() / 380 + p.npc.variant) * 0.08
      pose(p, [0.12, 0.02 + sway, 1], [0.04, 0.06 + sway, 1], [-0.12, 0.02 - sway, 1], [-0.04, 0.06 - sway, 1], p.reach)
    }

    // hoofd (en een beetje de nek) draait naar de speler
    if (p.look > 0.01 && p.bones.head && p.bones.neck) {
      const { q, q2, v, v2 } = tmp
      p.bones.head.getWorldPosition(v)
      v2.set(player.position.x, player.position.y + 1.55, player.position.z).sub(v).normalize()
      // waar het hoofd nu werkelijk heen kijkt (ook als het gebogen hangt), niet de lichaamsrichting
      v.copy(p.headForward).applyQuaternion(p.bones.head.getWorldQuaternion(tmp.bq)).normalize()
      q.setFromUnitVectors(v, v2)
      const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)))
      const k = (angle > 1.4 ? 1.4 / angle : 1) * p.look
      q2.identity().slerp(q, k * 0.4)
      twistBone(p.bones.neck, q2)
      q2.identity().slerp(q, k * 0.6)
      twistBone(p.bones.head, q2)
    }

    tint(p, dt)
  }

  /** Dood: door de knieën en achterover vallen, daarna stil blijven liggen. */
  function die(p: Patient, dt: number) {
    if (p.deadT > 2) return
    p.deadT += dt
    p.mixer.update(dt * 0.3)
    const k = Math.min(1, p.deadT / 0.75)
    const fall = k * k * 1.5
    p.root.position.set(p.pos.x, p.pos.y - k * 0.08, p.pos.z)
    p.root.rotation.set(-fall, p.heading, 0)
    // plas bloed onder het lichaam zodra het ligt
    if (!p.pooled && k >= 1) {
      p.pooled = true
      const c = level.cells[cellOf(p.pos)]
      const back = tmp.v.set(-Math.sin(p.heading), 0, -Math.cos(p.heading)).multiplyScalar(0.7)
      blood.splat(new THREE.Vector3(p.pos.x + back.x, (c?.floor ?? p.pos.y) + 0.004, p.pos.z + back.z), new THREE.Vector3(0, 1, 0), 1.3)
    }
    jawPose(p, 0.55)
    tint(p, dt)
  }

  /** Onderkaak: hangt slap open, met af en toe een reeks hongerige happen. */
  function chew(p: Patient, dt: number, hostile: boolean) {
    p.nextBite -= dt
    if (p.nextBite <= 0 && p.bite <= 0) {
      const notice = p.mode === 'notice'
      p.nextBite = hostile ? 1.2 + Math.random() * 1.8 : notice ? 2.5 + Math.random() * 3 : 5 + Math.random() * 8
      p.bite = 0.75
      if (hostile || (notice && Math.random() < 0.7)) sfx.chomp(p.pos)
    }
    let open = 0.32 + Math.sin(performance.now() / 900 + p.npc.variant) * 0.08
    if (p.bite > 0) {
      p.bite -= dt
      // twee, drie snelle happen: wijd open, hard dicht
      const t = (0.75 - p.bite) / 0.25
      const phase = t - Math.floor(t)
      open = phase < 0.45 ? 0.2 + (phase / 0.45) * 0.85 : 1.05 - ((phase - 0.45) / 0.55) * 1.05
    }
    if (p.mode === 'attack') open = p.attackT < STRIKE_AT ? Math.min(1.1, 0.3 + p.attackT * 2) : 0
    jawPose(p, open)
  }

  function jawPose(p: Patient, open: number) {
    p.jaw += (open - p.jaw) * 0.5
    for (const j of p.jaws) if (j.mesh.morphTargetInfluences) j.mesh.morphTargetInfluences[j.index] = p.jaw
  }

  function tint(p: Patient, dt: number) {
    p.lightTimer -= dt
    if (p.lightTimer > 0) return
    p.lightTimer = 0.25
    lighting.sample(p.pos.x, p.pos.y + 1.5, p.pos.z, undefined, p.light)
    p.uniforms.uTint.value.setRGB(Math.min(1.5, 0.1 + p.light[0]), Math.min(1.5, 0.1 + p.light[1]), Math.min(1.5, 0.1 + p.light[2]))
  }

  /**
   * Armhouding opleggen: richtingen (lichaamsruimte: x = links, y = omhoog, z = vooruit) voor
   * bovenarm en onderarm links en rechts, gemengd met de motion capture via `w`.
   */
  function pose(p: Patient, upperL: number[], lowerL: number[], upperR: number[], lowerR: number[], w: number) {
    const b = p.bones
    if (!b.armL || !b.foreL || !b.handL || !b.armR || !b.foreR || !b.handR) return
    aim(p, b.armL, b.foreL, upperL, w)
    aim(p, b.foreL, b.handL, lowerL, w)
    aim(p, b.armR, b.foreR, upperR, w)
    aim(p, b.foreR, b.handR, lowerR, w)
  }

  /** Draai `bone` zo dat de lijn naar `child` in de gevraagde richting wijst (een mini-IK in wereldruimte). */
  function aim(p: Patient, bone: THREE.Object3D, child: THREE.Object3D, dirBody: number[], w: number) {
    const { a, b, v2, q, q2, up } = tmp
    bone.getWorldPosition(a)
    child.getWorldPosition(b)
    const current = b.sub(a).normalize()
    v2.set(dirBody[0], dirBody[1], dirBody[2]).normalize().applyAxisAngle(up, p.heading)
    q.setFromUnitVectors(current, v2)
    q2.identity().slerp(q, w)
    twistBone(bone, q2)
  }

  /** Extra draaiing (in wereldruimte) toepassen op een bot, bovenop de animatie. */
  function twistBone(bone: THREE.Object3D, worldDelta: THREE.Quaternion) {
    const { pq, bq } = tmp
    bone.parent!.getWorldQuaternion(pq)
    bone.getWorldQuaternion(bq)
    bq.premultiply(worldDelta)
    bone.quaternion.copy(pq.invert().multiply(bq))
    bone.updateMatrixWorld(true)
  }

  return (
    <>
      {patients.map((p, i) => (
        <primitive key={i} object={p.root} />
      ))}
    </>
  )
}
