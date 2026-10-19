import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { sfx } from '../audio'
import { damageEnemy } from '../enemies/damage'
import type { EnemyState } from '../enemies/types'
import type { Lighting, RGB } from '../render/lighting'
import { sawDiskGeometry } from '../render/models'
import { useGame } from '../store'
import { fx } from './Effects'
import { raycast, runtime } from './runtime'

const MAX = 16
const SPEED = 22
const RADIUS = 0.28
/** Zoveel keer stuitert een disk; de volgende muur breekt hem. */
const MAX_BOUNCES = 5
const LIFETIME = 8
const SPIN = 28
/** Dezelfde vijand kan na een stuit opnieuw geraakt worden, maar niet in hetzelfde moment. */
const REHIT_DELAY = 0.35

interface Disk {
  active: boolean
  pos: THREE.Vector3
  dir: THREE.Vector3
  bounces: number
  life: number
  damage: [number, number]
  spin: number
  glint: number
  /** vijand-id → tijdstip waarop deze disk hem het laatst raakte */
  lastHit: Map<number, number>
}

const pool: Disk[] = Array.from({ length: MAX }, () => ({
  active: false,
  pos: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  bounces: 0,
  life: 0,
  damage: [0, 0],
  spin: 0,
  glint: 0,
  lastHit: new Map(),
}))

const rand = (a: number, b: number) => a + Math.random() * (b - a)

if (import.meta.env.DEV) Object.assign(window, { __disks: pool })

export function spawnDisk(from: THREE.Vector3, dir: THREE.Vector3, damage: [number, number]) {
  const d = pool.find((q) => !q.active)
  if (!d) return
  d.active = true
  d.pos.copy(from)
  d.dir.copy(dir).normalize()
  d.bounces = 0
  d.life = LIFETIME
  d.damage = damage
  d.spin = Math.random() * Math.PI * 2
  d.glint = 0
  d.lastHit.clear()
}

const tmpHit = new THREE.Vector3()
const tmpNormal = new THREE.Vector3()

/**
 * Raakt de baan (from → from + dir·len) vijanden? Een vijand is een verticale cilinder;
 * de disk snijdt door iedereen heen die hij op zijn pad tegenkomt.
 */
function sweepEnemies(d: Disk, from: THREE.Vector3, dir: THREE.Vector3, len: number, now: number) {
  if (len <= 0) return
  const seen = new Set<EnemyState>()
  for (const e of runtime.enemyByCollider.values()) {
    if (seen.has(e) || e.state === 'dead') continue
    seen.add(e)
    // dichtstbijzijnde punt op het pad tot de as van de vijand (in het horizontale vlak)
    const vx = dir.x * len
    const vz = dir.z * len
    const lenSq = vx * vx + vz * vz
    let t = lenSq > 1e-8 ? ((e.pos.x - from.x) * vx + (e.pos.z - from.z) * vz) / lenSq : 0
    t = Math.max(0, Math.min(1, t))
    const px = from.x + vx * t
    const pz = from.z + vz * t
    const py = from.y + dir.y * len * t
    if (Math.hypot(e.pos.x - px, e.pos.z - pz) > e.def.radius + RADIUS * 0.8) continue
    if (py < e.pos.y - 0.1 || py > e.pos.y + e.def.height + 0.1) continue
    const last = d.lastHit.get(e.id)
    if (last !== undefined && now - last < REHIT_DELAY) continue
    d.lastHit.set(e.id, now)
    tmpHit.set(px, py, pz)
    damageEnemy(e, Math.round(rand(...d.damage)), tmpHit.clone(), dir.clone())
    fx.fleshImpact(tmpHit, dir, 2.5)
    sfx.rend(tmpHit)
  }
}

function update(d: Disk, dt: number, now: number) {
  d.life -= dt
  d.spin += SPIN * dt
  if (d.life <= 0) {
    d.active = false
    return
  }
  let remaining = SPEED * dt
  const reach = RADIUS * 0.6
  // een paar iteraties: in één frame kan hij in een hoek twee keer stuiteren
  for (let iter = 0; iter < 4 && remaining > 1e-4; iter++) {
    const hit = raycast(d.pos, d.dir, remaining + reach, { ignoreEnemies: true })
    if (!hit) {
      sweepEnemies(d, d.pos, d.dir, remaining, now)
      d.pos.addScaledVector(d.dir, remaining)
      return
    }
    const step = Math.max(0, Math.min(remaining, hit.distance - reach))
    sweepEnemies(d, d.pos, d.dir, step, now)
    d.pos.addScaledVector(d.dir, step)
    remaining -= step

    // stuiteren: hoek van inval = hoek van uitval
    tmpNormal.copy(hit.normal)
    if (tmpNormal.dot(d.dir) > 0) tmpNormal.negate()
    d.bounces++
    sfx.clang(hit.point)
    fx.sparks(hit.point, tmpNormal, d.bounces > MAX_BOUNCES ? 1.5 : 1)
    if (d.bounces > MAX_BOUNCES) {
      fx.shards(hit.point, tmpNormal)
      d.active = false
      return
    }
    d.dir.reflect(tmpNormal).normalize()
    // los van het oppervlak houden
    d.pos.addScaledVector(tmpNormal, 0.02)
  }
}

export function Disks({ lighting }: { lighting: Lighting }) {
  const group = useRef<THREE.Group>(null)
  const light = useRef<RGB>([0, 0, 0])

  useEffect(() => pool.forEach((d) => (d.active = false)), [])

  useFrame((_, delta) => {
    const { locked, status } = useGame.getState()
    const dt = locked && status !== 'won' ? Math.min(delta, 0.05) : 0
    const now = performance.now() / 1000
    pool.forEach((d, i) => {
      if (d.active && dt > 0) {
        update(d, dt, now)
        d.glint += dt
        if (d.active && d.glint > 0.05) {
          d.glint = 0
          fx.flash(d.pos, 0.35, [1.4, 1.5, 1.7], 0.04)
        }
      }
      const mesh = group.current?.children[i] as THREE.Mesh | undefined
      if (!mesh) return
      mesh.visible = d.active
      if (!d.active) return
      mesh.position.copy(d.pos)
      mesh.rotation.set(0, d.spin, 0)
      lighting.sample(d.pos.x, d.pos.y, d.pos.z, undefined, light.current)
      const c = light.current
      ;(mesh.material as THREE.MeshBasicMaterial).color.setRGB(c[0] + 0.45, c[1] + 0.45, c[2] + 0.5)
    })
  })

  return (
    <group ref={group}>
      {pool.map((_, i) => (
        <mesh key={i} visible={false} geometry={sawDiskGeometry()}>
          <meshBasicMaterial vertexColors />
        </mesh>
      ))}
    </group>
  )
}
