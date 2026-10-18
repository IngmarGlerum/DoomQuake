import * as THREE from 'three'
import { sfx } from '../audio'
import { damageEnemy } from '../enemies/damage'
import { player, useGame } from '../store'
import { fx } from './Effects'
import { raycast, runtime } from './runtime'

export interface ExplosionOptions {
  radius: number
  /** schade in het centrum; neemt lineair af naar 0 aan de rand */
  damage: number
  /** schade aan jezelf als fractie (Quake-achtig: rocket jumps kosten wat health) */
  selfDamage: number
  /** maximale snelheidsimpuls voor de speler in m/s */
  knockback: number
}

export const ROCKET_EXPLOSION: ExplosionOptions = { radius: 5, damage: 110, selfDamage: 0.2, knockback: 13 }

const tmpDir = new THREE.Vector3()
const tmpCenter = new THREE.Vector3()

/** Is er een vrije lijn van de explosie naar het doel (muren houden splash tegen)? */
function exposed(from: THREE.Vector3, to: THREE.Vector3, dist: number) {
  if (dist < 0.05) return true
  tmpDir.subVectors(to, from).normalize()
  const hit = raycast(from, tmpDir, dist, { ignoreEnemies: true })
  return !hit || hit.distance >= dist - 0.3
}

/**
 * Explosie met splash damage op vijanden en de speler, inclusief knockback
 * (zo werken rocket jumps). Vijanden in de buurt horen de knal.
 */
export function explode(point: THREE.Vector3, opts: ExplosionOptions) {
  fx.explosion(point, 1.6)
  sfx.bigExplosion(point)
  runtime.lastShot = { x: point.x, z: point.z, time: performance.now() }

  // vijanden (eerst verzamelen: damageEnemy haalt doden uit de map)
  const targets = [...new Set(runtime.enemyByCollider.values())]
  for (const e of targets) {
    if (e.state === 'dead') continue
    tmpCenter.set(e.pos.x, e.pos.y + e.def.height / 2, e.pos.z)
    const dist = Math.max(0, tmpCenter.distanceTo(point) - e.def.radius)
    if (dist >= opts.radius || !exposed(point, tmpCenter, dist)) continue
    const amount = Math.round(opts.damage * (1 - dist / opts.radius))
    if (amount <= 0) continue
    const dir = tmpCenter.clone().sub(point).normalize()
    damageEnemy(e, amount, tmpCenter.clone().addScaledVector(dir, -e.def.radius), dir)
  }

  // speler
  tmpCenter.set(player.position.x, player.position.y + 0.9, player.position.z)
  const dist = Math.max(0, tmpCenter.distanceTo(point) - 0.4)
  if (dist < opts.radius && exposed(point, tmpCenter, dist)) {
    const k = 1 - dist / opts.radius
    const game = useGame.getState()
    const amount = Math.round(opts.damage * k * opts.selfDamage)
    if (amount > 0 && !game.noclip) {
      game.damage(amount)
      sfx.hurt()
    }
    // wegduwen, met wat extra omhoog zodat een raket onder je voeten je lanceert
    const dir = tmpCenter.clone().sub(point)
    if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0)
    dir.normalize()
    dir.y = Math.max(dir.y, 0) + 0.35
    dir.normalize()
    player.impulse.addScaledVector(dir, opts.knockback * k)
  }
}
