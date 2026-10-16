/** Wereldmaat van één gridcel in meters. */
export const CELL = 2
/** Hoogtes worden op deze stap afgerond (traptreden). */
export const STEP = 0.25
/** Hoogste trede die de speler zonder springen op kan lopen. */
export const MAX_STEP = 0.5
export const PLAYER_HEIGHT = 1.8

export type Theme = 'tech' | 'brick' | 'hell'

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
}

export type EnemyKind = 'grunt' | 'imp' | 'demon'
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
}

export const cellIndex = (lvl: { width: number }, x: number, y: number) => y * lvl.width + x
export const cellCenter = (x: number, y: number) => ({ x: (x + 0.5) * CELL, z: (y + 0.5) * CELL })
