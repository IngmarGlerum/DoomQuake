import type { Collider, World } from '@dimforge/rapier3d-compat'
import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { EnemyState } from '../enemies/types'

/**
 * Gedeelde runtime-objecten voor gevechtssystemen (geen React-state).
 * Wordt gevuld door de Physics-componenten zodra die mounten.
 */
export const runtime = {
  world: null as World | null,
  rapier: null as typeof RAPIER | null,
  playerCollider: null as Collider | null,
  /** collider-handle → vijand */
  enemyByCollider: new Map<number, EnemyState>(),
  doorsOpen: false,
  /** laatste schot van de speler; vijanden binnen gehoorsafstand worden wakker */
  lastShot: { x: 0, z: 0, time: -1e9 },
}

export interface RayHit {
  point: THREE.Vector3
  normal: THREE.Vector3
  distance: number
  collider: Collider
  enemy?: EnemyState
}

/**
 * Raycast door de physics-wereld. Standaard telt alles behalve de speler;
 * met `ignoreEnemies` alleen level-geometrie en deuren.
 */
export function raycast(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDistance: number,
  opts: { ignoreEnemies?: boolean; ignorePlayer?: boolean } = {},
): RayHit | null {
  const { world, rapier } = runtime
  if (!world || !rapier) return null
  const ray = new rapier.Ray(origin, dir)
  const exclude = opts.ignorePlayer === false ? undefined : (runtime.playerCollider ?? undefined)
  const predicate = opts.ignoreEnemies
    ? (c: Collider) => !runtime.enemyByCollider.has(c.handle)
    : (c: Collider) => {
        const e = runtime.enemyByCollider.get(c.handle)
        return !e || e.state !== 'dead'
      }
  const hit = world.castRayAndGetNormal(ray, maxDistance, true, undefined, undefined, exclude, undefined, predicate)
  if (!hit) return null
  return {
    point: origin.clone().addScaledVector(dir, hit.timeOfImpact),
    normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
    distance: hit.timeOfImpact,
    collider: hit.collider,
    enemy: runtime.enemyByCollider.get(hit.collider.handle),
  }
}
