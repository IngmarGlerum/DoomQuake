import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { sfx } from '../audio'
import { fx } from '../combat/Effects'
import { ROCKET_EXPLOSION, explode as explodeWithSplash } from '../combat/explosions'
import { raycast } from '../combat/runtime'
import { rocketGeometry } from '../render/models'
import { player, useGame } from '../store'
import { damageEnemy } from './damage'

const MAX = 40
const FIREBALL_SPEED = 13
const ROCKET_SPEED = 30
const HIT_RADIUS = 0.65

type Kind = 'fireball' | 'rocket'

interface Projectile {
  active: boolean
  kind: Kind
  pos: THREE.Vector3
  vel: THREE.Vector3
  damage: number
  life: number
  trail: number
}

const pool: Projectile[] = Array.from({ length: MAX }, () => ({
  active: false,
  kind: 'fireball',
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  damage: 0,
  life: 0,
  trail: 0,
}))

function spawn(kind: Kind, from: THREE.Vector3, target: THREE.Vector3, speed: number, damage: number) {
  const p = pool.find((q) => !q.active)
  if (!p) return
  p.active = true
  p.kind = kind
  p.pos.copy(from)
  p.vel.subVectors(target, from).normalize().multiplyScalar(speed)
  p.damage = damage
  p.life = kind === 'rocket' ? 5 : 6
  p.trail = 0
}

/** Vuurbal van een imp richting `target`; raakt alleen de speler en muren. */
export function spawnFireball(from: THREE.Vector3, target: THREE.Vector3, damage: number) {
  spawn('fireball', from, target, FIREBALL_SPEED, damage)
}

/** Raket van de speler; raakt vijanden en muren en ontploft met splash damage. */
export function spawnRocket(from: THREE.Vector3, target: THREE.Vector3, damage: number) {
  spawn('rocket', from, target, ROCKET_SPEED, damage)
}

/** Kortste afstand van punt p tot de verticale as van de speler (voeten+0.4 .. voeten+1.4). */
function distToPlayer(p: THREE.Vector3) {
  const y = Math.max(player.position.y + 0.4, Math.min(player.position.y + 1.4, p.y))
  return Math.hypot(p.x - player.position.x, p.y - y, p.z - player.position.z)
}

const FORWARD = new THREE.Vector3(0, 0, -1)

export function Projectiles() {
  const fireballs = useRef<THREE.Group>(null)
  const rockets = useRef<THREE.Group>(null)
  const dir = useRef(new THREE.Vector3())

  useEffect(() => pool.forEach((p) => (p.active = false)), [])

  useFrame(({ clock }, delta) => {
    const { locked, status } = useGame.getState()
    const dt = locked && status !== 'won' ? Math.min(delta, 0.05) : 0
    pool.forEach((p, i) => {
      if (p.active && dt > 0) {
        p.life -= dt
        const step = p.vel.length() * dt
        dir.current.copy(p.vel).normalize()
        if (p.kind === 'rocket') updateRocket(p, step, dir.current)
        else updateFireball(p, step, dir.current)
        p.trail += dt
        if (p.active && p.trail > 0.02) {
          p.trail = 0
          if (p.kind === 'rocket') fx.rocketTrail(p.pos, dir.current)
          else fx.fireTrail(p.pos)
        }
        if (p.active && p.kind === 'rocket') fx.flash(p.pos, 0.7, [1.6, 0.9, 0.3], 0.03)
      }

      const fb = fireballs.current?.children[i]
      if (fb) {
        fb.visible = p.active && p.kind === 'fireball'
        if (fb.visible) {
          fb.position.copy(p.pos)
          fb.rotation.set(clock.elapsedTime * 9, clock.elapsedTime * 7, 0)
          fb.scale.setScalar(1 + Math.sin(clock.elapsedTime * 30 + i) * 0.15)
        }
      }
      const rk = rockets.current?.children[i]
      if (rk) {
        rk.visible = p.active && p.kind === 'rocket'
        if (rk.visible) {
          rk.position.copy(p.pos)
          rk.quaternion.setFromUnitVectors(FORWARD, dir.current.copy(p.vel).normalize())
        }
      }
    })
  })

  return (
    <>
      <group ref={fireballs}>
        {pool.map((_, i) => (
          <mesh key={i} visible={false}>
            <octahedronGeometry args={[0.22, 0]} />
            <meshBasicMaterial color={[2, 1.1, 0.25]} fog={false} />
          </mesh>
        ))}
      </group>
      <group ref={rockets}>
        {pool.map((_, i) => (
          <mesh key={i} visible={false} geometry={rocketGeometry()}>
            <meshBasicMaterial vertexColors color={[1.2, 1.2, 1.2]} />
          </mesh>
        ))}
      </group>
    </>
  )
}

function updateFireball(p: Projectile, step: number, dir: THREE.Vector3) {
  const wall = raycast(p.pos, dir, step + 0.15, { ignoreEnemies: true })
  p.pos.addScaledVector(p.vel, step / p.vel.length())
  if (distToPlayer(p.pos) < HIT_RADIUS) {
    useGame.getState().damage(p.damage)
    sfx.hurt()
    // niet in de camera ontploffen: een stukje terug langs de baan
    smallBoom(p, p.pos.clone().addScaledVector(dir, -0.9))
  } else if (wall) {
    smallBoom(p, wall.point.addScaledVector(wall.normal, 0.2))
  } else if (p.life <= 0) {
    p.active = false
  }
}

function updateRocket(p: Projectile, step: number, dir: THREE.Vector3) {
  // raycast raakt muren, deuren en (levende) vijanden; de speler zelf niet
  const hit = raycast(p.pos, dir, step + 0.1)
  if (hit) {
    p.active = false
    if (hit.enemy) damageEnemy(hit.enemy, p.damage, hit.point, dir)
    explodeWithSplash(hit.point.addScaledVector(hit.enemy ? dir : hit.normal, hit.enemy ? -0.3 : 0.25), ROCKET_EXPLOSION)
    return
  }
  p.pos.addScaledVector(dir, step)
  if (p.life <= 0) {
    p.active = false
    explodeWithSplash(p.pos, ROCKET_EXPLOSION)
  }
}

function smallBoom(p: Projectile, at: THREE.Vector3) {
  p.active = false
  fx.explosion(at)
  sfx.explosion(at)
}
