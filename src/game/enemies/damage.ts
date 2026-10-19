import * as THREE from 'three'
import { sfx } from '../audio'
import { fx } from '../combat/Effects'
import { runtime } from '../combat/runtime'
import { DIFFICULTY } from '../difficulty'
import { useGame } from '../store'
import { spawnDrop } from './drops'
import type { EnemyState } from './types'

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const tmpA = new THREE.Vector3()

/** Vijand neemt schade (aangeroepen door de wapens). */
export function damageEnemy(e: EnemyState, amount: number, point: THREE.Vector3, dir: THREE.Vector3) {
  if (e.state === 'dead') return
  amount *= DIFFICULTY.damageDealt
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
    spawnDrop(e)
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

export function wake(e: EnemyState) {
  e.state = 'chase'
  e.stateTime = 0
  e.cooldown = rand(0.3, 1.0)
  if (e.kind === 'grunt') sfx.alert(e.pos)
  else sfx.growl(e.pos)
}

