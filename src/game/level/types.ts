/** Wereldmaat van één gridcel in meters. */
export const CELL = 2
/** Hoogtes worden op deze stap afgerond (traptreden). */
export const STEP = 0.25
/** Hoogste trede die de speler zonder springen op kan lopen. */
export const MAX_STEP = 0.5
export const PLAYER_HEIGHT = 1.8

export type Theme = 'tech' | 'brick' | 'hell' | 'cave' | 'base'

export interface Cell {
  solid: boolean
  floor: number
  ceil: number
  /** id van de kamer, of -1 voor gang / muur */
  room: number
  /** id van de gang (edge) die deze cel uitgroef, -1 als geen */
  corridor: number
  /** ligt op een looproute van een gang (kamer-features blijven hier vanaf) */
  path: boolean
  liquid: boolean
  door: boolean
  theme: Theme
  /** automatische schuifdeur (gaat vanzelf open, niet op slot) */
  slide?: boolean
  /** cel waar een groot decorstuk staat (serverkast, terminal, kooi...) */
  prop?: boolean
}

export type RoomFeature = 'none' | 'pillars' | 'dais' | 'pit'

export interface Room {
  id: number
  x: number
  y: number
  w: number
  h: number
  floor: number
  ceil: number
  theme: Theme
  feature: RoomFeature
  /** afstand (in kamers) vanaf de startkamer in de spanning tree */
  depth: number
  /** grotbasis: natuurlijke grot of gebouwde kamer, en waar de kamer voor dient */
  kind?: 'cave' | 'base'
  purpose?: RoomPurpose
}

export type RoomPurpose = 'server' | 'control' | 'lab' | 'storage' | 'reactor'

/** Decorstukken in de grotbasis. Posities in wereldcoördinaten; `rot` = draaiing om de y-as (voorkant = +z). */
export type Prop =
  | {
      kind: 'rack' | 'terminal' | 'switchboard' | 'cage' | 'crate' | 'lamp'
      x: number
      y: number
      z: number
      rot: number
      variant: number
    }
  | {
      kind: 'pipe' | 'cable'
      points: [number, number, number][]
      radius: number
      color: number
    }

export type LevelKind = 'outpost' | 'caves'

export type EnemyKind = 'grunt' | 'imp' | 'demon' | 'mutant' | 'clawbeast'
export type ThingKind = 'enemy' | 'health' | 'ammo' | 'armor' | 'key' | 'exit'

export interface Thing {
  kind: ThingKind
  enemy?: EnemyKind
  /** wereldcoördinaten */
  x: number
  y: number
  z: number
  /** cel-index in het grid */
  cell: number
}

export interface Light {
  x: number
  y: number
  z: number
  radius: number
  color: [number, number, number]
}

export interface Level {
  seed: string
  width: number
  height: number
  cells: Cell[]
  rooms: Room[]
  /** verbindingen tussen kamers (spanning tree + extra lussen) */
  edges: [number, number][]
  things: Thing[]
  lights: Light[]
  spawn: { x: number; y: number; z: number; yaw: number; cell: number }
  startRoom: number
  keyRoom: number
  exitRoom: number
  kind?: LevelKind
  /** decorstukken (alleen in de grotbasis) */
  props?: Prop[]
  /** hoeveel muurhoeken in grotten willekeurig verschoven worden (meters), voor een rotsachtig effect */
  cornerJitter?: number
}

export const cellIndex = (lvl: { width: number }, x: number, y: number) => y * lvl.width + x
export const cellCenter = (x: number, y: number) => ({ x: (x + 0.5) * CELL, z: (y + 0.5) * CELL })
