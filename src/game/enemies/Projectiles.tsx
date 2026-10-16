import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { sfx } from '../audio'
import { fx } from '../combat/Effects'
import { raycast } from '../combat/runtime'
import { player, useGame } from '../store'

const MAX = 32
const FIREBALL_SPEED = 13
const HIT_RADIUS = 0.65

interface Projectile {
  active: boolean
  pos: THREE.Vector3
  vel: THREE.Vector3
  damage: number
  life: number
  trail: number
}

const pool: Projectile[] = Array.from({ length: MAX }, () => ({
  active: false,
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  damage: 0,
  life: 0,
  trail: 0,
}))

export function spawnFireball(from: THREE.Vector3, target: THREE.Vector3, damage: number) {
  const p = pool.find((q) => !q.active)
  if (!p) return
  p.active = true
  p.pos.copy(from)
  p.vel.subVectors(target, from).normalize().multiplyScalar(FIREBALL_SPEED)
  p.damage = damage
  p.life = 6
  p.trail = 0
}

/** Kortste afstand van punt p tot de verticale as van de speler (voeten+0.4 .. voeten+1.4). */
function distToPlayer(p: THREE.Vector3) {
  const y = Math.max(player.position.y + 0.4, Math.min(player.position.y + 1.4, p.y))
  return Math.hypot(p.x - player.position.x, p.y - y, p.z - player.position.z)
}

export function Projectiles() {
  const group = useRef<THREE.Group>(null)
  const dir = useRef(new THREE.Vector3())

  useEffect(() => pool.forEach((p) => (p.active = false)), [])

  useFrame(({ clock }, delta) => {
    const { locked, status } = useGame.getState()
    const dt = locked && status !== 'won' ? Math.min(delta, 0.05) : 0
    pool.forEach((p, i) => {
      const mesh = group.current?.children[i]
      if (p.active && dt > 0) {
        p.life -= dt
        const step = p.vel.length() * dt
        dir.current.copy(p.vel).normalize()
        const wall = raycast(p.pos, dir.current, step + 0.15, { ignoreEnemies: true })
        p.pos.addScaledVector(p.vel, dt)
        if (distToPlayer(p.pos) < HIT_RADIUS) {
          useGame.getState().damage(p.damage)
          sfx.hurt()
          // niet in de camera ontploffen: een stukje terug langs de baan
          explode(p, p.pos.clone().addScaledVector(dir.current, -0.9))
        } else if (wall) {
          explode(p, wall.point.addScaledVector(wall.normal, 0.2))
        } else if (p.life <= 0) {
          p.active = false
        }
        p.trail += dt
        if (p.active && p.trail > 0.02) {
          p.trail = 0
          fx.fireTrail(p.pos)
        }
      }
      if (mesh) {
        mesh.visible = p.active
        if (p.active) {
          mesh.position.copy(p.pos)
          mesh.rotation.set(clock.elapsedTime * 9, clock.elapsedTime * 7, 0)
          mesh.scale.setScalar(1 + Math.sin(clock.elapsedTime * 30 + i) * 0.15)
        }
      }
    })
  })

  return (
    <group ref={group}>
      {pool.map((_, i) => (
        <mesh key={i} visible={false}>
          <octahedronGeometry args={[0.22, 0]} />
          <meshBasicMaterial color={[2, 1.1, 0.25]} fog={false} />
        </mesh>
      ))}
    </group>
  )
}

function explode(p: Projectile, at: THREE.Vector3) {
  p.active = false
  fx.explosion(at)
  sfx.explosion(at)
}
