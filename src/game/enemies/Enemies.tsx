import { useFrame } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { sfx } from '../audio'
import { fx } from '../combat/Effects'
import { raycast, runtime } from '../combat/runtime'
import { canWalk } from '../level/validate'
import { CELL, type Level } from '../level/types'
import type { Lighting, RGB } from '../render/lighting'
import { enemyGeometry } from '../render/models'
import { player, useGame } from '../store'
import { computeFlowField, nextStep } from './flowField'
import { spawnFireball } from './Projectiles'
import { ENEMY_DEFS, type EnemyState } from './types'

const SIGHT_RANGE = 42
const HEARING_RANGE = 24
const rand = (a: number, b: number) => a + Math.random() * (b - a)

const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const tmpC = new THREE.Vector3()

const eye = (e: EnemyState, out: THREE.Vector3) => out.set(e.pos.x, e.pos.y + e.def.height * 0.82, e.pos.z)
const playerChest = (out: THREE.Vector3) => out.set(player.position.x, player.position.y + 1.1, player.position.z)

/** Vijand neemt schade (aangeroepen door de wapens). */
export function damageEnemy(e: EnemyState, amount: number, point: THREE.Vector3, dir: THREE.Vector3) {
  if (e.state === 'dead') return
  e.hp -= amount
  e.hitFlash = 1
  fx.fleshImpact(point, dir, Math.min(2, amount / 10))
  // een beetje terugduwen
  e.pos.addScaledVector(tmpA.set(dir.x, 0, dir.z).normalize(), Math.min(0.25, amount * 0.01))

  if (e.hp <= 0) {
    e.state = 'dead'
    e.stateTime = 0
    fx.fleshImpact(point, dir, 3)
    sfx.death(e.pos)
    useGame.getState().addKill()
    if (e.collider && runtime.world) {
      runtime.enemyByCollider.delete(e.collider.handle)
      try {
        runtime.world.removeCollider(e.collider, false)
      } catch {
        // wereld al opgeruimd
      }
      e.collider = null
    }
    return
  }
  if (e.state === 'idle') wake(e)
  if (Math.random() < e.def.painChance) {
    e.state = 'pain'
    e.stateTime = 0
    sfx.pain(e.pos)
  }
}

function wake(e: EnemyState) {
  e.state = 'chase'
  e.stateTime = 0
  e.cooldown = rand(0.3, 1.0)
  if (e.kind === 'grunt') sfx.alert(e.pos)
  else sfx.growl(e.pos)
}

export function Enemies({ level, lighting }: { level: Level; lighting: Lighting }) {
  const { world, rapier } = useRapier()

  const enemies = useMemo<EnemyState[]>(
    () =>
      level.things
        .filter((t) => t.kind === 'enemy')
        .map((t, id) => {
          const kind = t.enemy ?? 'grunt'
          return {
            id,
            kind,
            def: ENEMY_DEFS[kind],
            pos: new THREE.Vector3(t.x, t.y, t.z),
            yaw: Math.random() * Math.PI * 2,
            hp: ENEMY_DEFS[kind].hp,
            state: 'idle',
            stateTime: 0,
            cooldown: 0,
            fired: false,
            canSee: false,
            seeTimer: Math.random() * 0.3,
            moving: false,
            hitFlash: 0,
            strafe: Math.random() < 0.5 ? -1 : 1,
            collider: null,
          }
        }),
    [level],
  )

  // colliders aanmaken zodat kogels én de speler ze raken
  useEffect(() => {
    useGame.getState().setEnemyCount(enemies.length)
    for (const e of enemies) {
      const half = e.def.height / 2 - e.def.radius
      e.collider = world.createCollider(
        rapier.ColliderDesc.capsule(half, e.def.radius).setTranslation(e.pos.x, e.pos.y + e.def.height / 2, e.pos.z),
      )
      runtime.enemyByCollider.set(e.collider.handle, e)
    }
    return () => {
      for (const e of enemies) {
        if (!e.collider) continue
        runtime.enemyByCollider.delete(e.collider.handle)
        try {
          world.removeCollider(e.collider, false)
        } catch {
          // wereld al opgeruimd
        }
        e.collider = null
      }
    }
  }, [enemies, world, rapier])

  const flow = useRef({ field: new Int32Array(level.cells.length), target: -2, doors: false, timer: 0 })

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const game = useGame.getState()
    // pauze zolang de muis niet gelockt is (menu open)
    const active = game.status === 'playing' && game.locked
    if (!active) return

    // flow field verversen als de speler van cel wisselt of een deur opengaat
    const f = flow.current
    f.timer -= dt
    if ((f.target !== player.cell || f.doors !== runtime.doorsOpen) && f.timer <= 0) {
      computeFlowField(level, player.cell, runtime.doorsOpen, f.field)
      f.target = player.cell
      f.doors = runtime.doorsOpen
      f.timer = 0.2
    }

    for (const e of enemies) {
      e.stateTime += dt
      e.hitFlash = Math.max(0, e.hitFlash - dt * 6)
      if (e.state === 'dead') continue
      e.cooldown -= dt
      e.moving = false

      const dx = player.position.x - e.pos.x
      const dz = player.position.z - e.pos.z
      const dist = Math.hypot(dx, dz)

      // zicht periodiek checken met een raycast door de level-geometrie
      e.seeTimer -= dt
      if (e.seeTimer <= 0) {
        e.seeTimer = rand(0.15, 0.3)
        e.canSee = false
        if (dist < SIGHT_RANGE && !game.noclip) {
          eye(e, tmpA)
          playerChest(tmpB)
          const d = tmpC.subVectors(tmpB, tmpA)
          const len = d.length()
          const hit = raycast(tmpA, d.normalize(), len, { ignoreEnemies: true })
          e.canSee = !hit || hit.distance >= len - 0.3
        }
      }

      if (e.state === 'idle') {
        const heard = performance.now() - runtime.lastShot.time < 300 && Math.hypot(runtime.lastShot.x - e.pos.x, runtime.lastShot.z - e.pos.z) < HEARING_RANGE
        if (e.canSee || heard) wake(e)
        continue
      }

      const faceYaw = Math.atan2(-dx, -dz)

      if (e.state === 'pain') {
        if (e.stateTime > 0.3) {
          e.state = 'chase'
          e.stateTime = 0
        }
        continue
      }

      if (e.state === 'attack') {
        turnTowards(e, faceYaw, dt * 10)
        if (!e.fired && e.stateTime >= e.def.windup) {
          e.fired = true
          attack(e, dist)
        }
        if (e.stateTime >= e.def.windup + 0.35) {
          e.state = 'chase'
          e.stateTime = 0
          e.cooldown = rand(...e.def.cooldown)
          if (Math.random() < 0.5) e.strafe *= -1
        }
        continue
      }

      // chase
      if (e.cooldown <= 0 && e.canSee && dist <= e.def.range) {
        e.state = 'attack'
        e.stateTime = 0
        e.fired = false
        continue
      }

      const cell = cellOf(level, e.pos)
      let mx = 0
      let mz = 0
      const tooClose = e.def.attack === 'melee' ? dist < e.def.range * 0.7 : e.canSee && dist < e.def.holdDistance
      if (tooClose) {
        // ranged vijanden schuiven zijwaarts terwijl ze herladen
        if (e.def.attack !== 'melee') {
          mx = (-dz / dist) * e.strafe * 0.6
          mz = (dx / dist) * e.strafe * 0.6
        }
      } else if (e.canSee && dist < 9) {
        mx = dx / dist
        mz = dz / dist
      } else {
        const next = nextStep(level, f.field, cell)
        if (next >= 0) {
          const tx = ((next % level.width) + 0.5) * CELL
          const tz = (Math.floor(next / level.width) + 0.5) * CELL
          const l = Math.hypot(tx - e.pos.x, tz - e.pos.z) || 1
          mx = (tx - e.pos.x) / l
          mz = (tz - e.pos.z) / l
        }
      }

      if (mx || mz) {
        const step = e.def.speed * dt
        if (!tryMove(level, e, cell, mx * step, mz * step)) {
          // langs muren glijden: probeer de assen apart
          if (!tryMove(level, e, cell, mx * step, 0)) tryMove(level, e, cell, 0, mz * step)
          if (tooClose) e.strafe *= -1
        }
        e.moving = true
        turnTowards(e, tooClose ? faceYaw : Math.atan2(-mx, -mz), dt * 8)
      } else {
        turnTowards(e, faceYaw, dt * 6)
      }
    }

    // vijanden duwen elkaar uit elkaar
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i]
      if (a.state === 'dead') continue
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j]
        if (b.state === 'dead') continue
        const ox = b.pos.x - a.pos.x
        const oz = b.pos.z - a.pos.z
        const min = a.def.radius + b.def.radius
        const d = Math.hypot(ox, oz)
        if (d >= min || d < 1e-4) continue
        const push = (min - d) / 2
        tryMove(level, a, cellOf(level, a.pos), (-ox / d) * push, (-oz / d) * push)
        tryMove(level, b, cellOf(level, b.pos), (ox / d) * push, (oz / d) * push)
      }
    }

    // hoogte volgen (trappen) en colliders bijwerken
    for (const e of enemies) {
      if (e.state === 'dead') continue
      const c = level.cells[cellOf(level, e.pos)]
      e.pos.y += (c.floor - e.pos.y) * Math.min(1, dt * 12)
      e.collider?.setTranslation({ x: e.pos.x, y: e.pos.y + e.def.height / 2, z: e.pos.z })
    }
  })

  return (
    <>
      {enemies.map((e) => (
        <EnemyMesh key={e.id} enemy={e} lighting={lighting} />
      ))}
    </>
  )
}

function cellOf(level: Level, p: THREE.Vector3) {
  const x = Math.min(level.width - 1, Math.max(0, Math.floor(p.x / CELL)))
  const z = Math.min(level.height - 1, Math.max(0, Math.floor(p.z / CELL)))
  return z * level.width + x
}

/** Beweeg alleen als de nieuwe positie (plus straal) in beloopbare cellen blijft. */
function tryMove(level: Level, e: EnemyState, cell: number, mx: number, mz: number) {
  const nx = e.pos.x + mx
  const nz = e.pos.z + mz
  const r = e.def.radius * 0.9
  const from = level.cells[cell]
  for (const [ox, oz] of [
    [0, 0],
    [r, 0],
    [-r, 0],
    [0, r],
    [0, -r],
  ]) {
    const cx = Math.floor((nx + ox) / CELL)
    const cz = Math.floor((nz + oz) / CELL)
    if (cx < 0 || cz < 0 || cx >= level.width || cz >= level.height) return false
    const i = cz * level.width + cx
    if (i === cell) continue
    const to = level.cells[i]
    if (!canWalk(from, to) || (to.door && !runtime.doorsOpen)) return false
  }
  e.pos.x = nx
  e.pos.z = nz
  return true
}

function turnTowards(e: EnemyState, target: number, k: number) {
  const diff = Math.atan2(Math.sin(target - e.yaw), Math.cos(target - e.yaw))
  e.yaw += diff * Math.min(1, k)
}

function attack(e: EnemyState, dist: number) {
  const fwdX = -Math.sin(e.yaw)
  const fwdZ = -Math.cos(e.yaw)
  const muzzle = eye(e, new THREE.Vector3()).add(new THREE.Vector3(fwdX * 0.55, -0.35, fwdZ * 0.55))
  const target = playerChest(new THREE.Vector3())
  const [min, max] = e.def.damage

  if (e.def.attack === 'melee') {
    if (dist < e.def.range + 0.4) {
      useGame.getState().damage(Math.round(rand(min, max)))
      sfx.bite(e.pos)
      sfx.hurt()
    }
    return
  }

  if (e.def.attack === 'fireball') {
    spawnFireball(muzzle, target, Math.round(rand(min, max)))
    sfx.fireball(e.pos)
    fx.flash(muzzle, 1.2, [2, 1, 0.3], 0.1)
    return
  }

  // hitscan: minder nauwkeurig op afstand en tegen een rennende speler
  const spread = 0.025 + dist * 0.0025 + player.speed * 0.006
  const dir = target.sub(muzzle).normalize()
  dir.x += rand(-spread, spread)
  dir.y += rand(-spread, spread) * 0.6
  dir.z += rand(-spread, spread)
  dir.normalize()
  sfx.enemyShot(e.pos)
  fx.flash(muzzle, 0.9, [2, 1.6, 0.6], 0.06)
  const hit = raycast(muzzle, dir, 80, { ignorePlayer: false })
  const end = hit ? hit.point : muzzle.clone().addScaledVector(dir, 80)
  fx.tracer(muzzle, end, [1.8, 0.6, 0.3])
  if (!hit) return
  if (hit.collider === runtime.playerCollider) {
    useGame.getState().damage(Math.round(rand(min, max)))
    sfx.hurt()
  } else if (hit.enemy) {
    damageEnemy(hit.enemy, Math.round(rand(min, max)) * 0.5, hit.point, dir)
  } else {
    fx.wallImpact(hit.point, hit.normal, hit.collider.parent()?.isFixed() ?? true)
    sfx.ricochet(hit.point)
  }
}

function EnemyMesh({ enemy: e, lighting }: { enemy: EnemyState; lighting: Lighting }) {
  const ref = useRef<THREE.Mesh>(null)
  const light = useRef<RGB>([0, 0, 0])
  const walk = useRef(Math.random() * 10)

  useFrame((_, delta) => {
    const m = ref.current
    if (!m) return
    m.rotation.order = 'YXZ'
    m.position.copy(e.pos)
    m.rotation.y = e.yaw
    m.rotation.x = 0
    m.rotation.z = 0

    if (e.state === 'dead') {
      // achterover vallen en een beetje wegzakken
      const k = Math.min(1, e.stateTime / 0.45)
      m.rotation.x = k * k * (Math.PI / 2) * 0.96
      m.position.y = e.pos.y + 0.05 - k * 0.05
    } else if (e.state === 'attack') {
      const wind = Math.min(1, e.stateTime / e.def.windup)
      m.rotation.x = e.fired ? 0.12 : -0.22 * wind
      if (e.def.attack === 'melee' && !e.fired) m.position.addScaledVector(tmpA.set(-Math.sin(e.yaw), 0, -Math.cos(e.yaw)), wind * 0.3)
    } else if (e.state === 'pain') {
      m.rotation.x = 0.3 * (1 - e.stateTime / 0.3)
      m.rotation.z = 0.15
    } else if (e.moving) {
      walk.current += delta * e.def.speed * 2.6
      m.rotation.z = Math.sin(walk.current) * 0.09
      m.position.y += Math.abs(Math.cos(walk.current)) * 0.06
    }

    lighting.sample(e.pos.x, e.pos.y + 1, e.pos.z, undefined, light.current)
    const flash = 1 + e.hitFlash * 4
    const dim = e.state === 'dead' ? 0.6 : 1
    const mat = m.material as THREE.MeshBasicMaterial
    mat.color.setRGB(
      Math.min(1.5, light.current[0] + 0.1) * flash * dim,
      Math.min(1.5, light.current[1] + 0.1) * flash * dim,
      Math.min(1.5, light.current[2] + 0.1) * flash * dim,
    )
  })

  return (
    <mesh ref={ref} geometry={enemyGeometry(e.kind)}>
      <meshBasicMaterial vertexColors />
    </mesh>
  )
}
