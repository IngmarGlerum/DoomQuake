import type { Collider } from '@dimforge/rapier3d-compat'
import type * as THREE from 'three'
import type { EnemyKind } from '../level/types'

export type AttackKind = 'hitscan' | 'fireball' | 'melee'
export type AiState = 'idle' | 'chase' | 'attack' | 'pain' | 'dead'

export interface EnemyDef {
  hp: number
  speed: number
  radius: number
  height: number
  attack: AttackKind
  /** maximale aanvalsafstand in meters */
  range: number
  /** tijd tussen aanvallen [min, max] */
  cooldown: [number, number]
  /** voorbereidingstijd voordat de aanval afgaat (zichtbaar + ontwijkbaar) */
  windup: number
  damage: [number, number]
  painChance: number
  /** afstand waarop ranged vijanden blijven staan in plaats van verder te lopen */
  holdDistance: number
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  grunt: {
    hp: 30,
    speed: 3.4,
    radius: 0.4,
    height: 1.95,
    attack: 'hitscan',
    range: 28,
    cooldown: [1.1, 2.0],
    windup: 0.45,
    damage: [5, 11],
    painChance: 0.75,
    holdDistance: 7,
  },
  imp: {
    hp: 60,
    speed: 3.0,
    radius: 0.45,
    height: 2.05,
    attack: 'fireball',
    range: 32,
    cooldown: [1.5, 2.5],
    windup: 0.6,
    damage: [12, 20],
    painChance: 0.5,
    holdDistance: 6,
  },
  demon: {
    hp: 130,
    speed: 6.5,
    radius: 0.65,
    height: 1.6,
    attack: 'melee',
    range: 1.9,
    cooldown: [0.8, 1.2],
    windup: 0.3,
    damage: [12, 22],
    painChance: 0.3,
    holdDistance: 0,
  },
}

export interface EnemyState {
  id: number
  kind: EnemyKind
  def: EnemyDef
  pos: THREE.Vector3
  yaw: number
  hp: number
  state: AiState
  stateTime: number
  cooldown: number
  /** is de aanval in deze attack-fase al afgevuurd */
  fired: boolean
  /** ziet de speler (periodiek ververst) */
  canSee: boolean
  seeTimer: number
  moving: boolean
  /** witte flits als hij geraakt wordt (0..1) */
  hitFlash: number
  /** zijwaarts bewegen tijdens het wachten op een nieuwe aanval */
  strafe: number
  collider: Collider | null
}
