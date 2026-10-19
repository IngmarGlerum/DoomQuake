import * as THREE from 'three'
import type { EnemyKind } from '../level/types'
import { useGame, type DropKind } from '../store'
import type { EnemyState } from './types'

/** Kansen per vijandtype; hooguit één drop per vijand. */
const DROP_TABLE: Record<EnemyKind, [DropKind, number][]> = {
  grunt: [
    ['clip', 0.45],
    ['stimpack', 0.15],
  ],
  imp: [
    ['shells', 0.35],
    ['stimpack', 0.25],
    ['clip', 0.1],
    ['disks', 0.1],
  ],
  demon: [
    ['stimpack', 0.35],
    ['rocket', 0.3],
    ['shells', 0.2],
    ['disks', 0.1],
  ],
}

export interface Drop {
  id: number
  kind: DropKind
  pos: THREE.Vector3
  vel: THREE.Vector3
  floor: number
  landed: boolean
  taken: boolean
}

let nextId = 0
export const drops: Drop[] = []
if (import.meta.env.DEV) Object.assign(window, { __drops: drops })
/** Wordt verhoogd bij elke nieuwe drop, zodat de render-component weet dat hij opnieuw moet tekenen. */
export const dropVersion = { value: 0 }

export function clearDrops() {
  drops.length = 0
  dropVersion.value++
}

function rollDrop(kind: EnemyKind): DropKind | null {
  const health = useGame.getState().health
  let r = Math.random()
  for (const [drop, chance] of DROP_TABLE[kind]) {
    // weinig health? dan valt er vaker een stimpack
    const c = drop === 'stimpack' && health < 35 ? chance * 2 : chance
    if (r < c) return drop
    r -= c
  }
  return null
}

/** Rolt een drop voor een verslagen vijand en gooit hem een stukje omhoog. */
export function spawnDrop(e: EnemyState) {
  const kind = rollDrop(e.kind)
  if (!kind) return
  const a = Math.random() * Math.PI * 2
  drops.push({
    id: nextId++,
    kind,
    pos: new THREE.Vector3(e.pos.x, e.pos.y + 1, e.pos.z),
    vel: new THREE.Vector3(Math.cos(a) * 1.2, 3.5, Math.sin(a) * 1.2),
    floor: e.pos.y,
    landed: false,
    taken: false,
  })
  dropVersion.value++
}
