export type WeaponId = 'pistol' | 'shotgun' | 'machinegun'
export type AmmoType = 'bullets' | 'shells'

export interface WeaponDef {
  id: WeaponId
  name: string
  slot: number
  ammo: AmmoType
  pellets: number
  /** schade per kogel/hagel: [min, max] */
  damage: [number, number]
  /** spreiding als halve hoek in radialen */
  spread: number
  /** seconden tussen schoten */
  cooldown: number
  /** vuren zolang de knop ingedrukt is */
  auto: boolean
  /** terugslag van het viewmodel (0..1) */
  kick: number
  /** kleur van het lichtspoor */
  tracer: [number, number, number]
  /** positie van de loop t.o.v. de camera */
  muzzle: [number, number, number]
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 'pistol',
    name: 'Heavy Pistol',
    slot: 1,
    ammo: 'bullets',
    pellets: 1,
    damage: [22, 30],
    spread: 0.006,
    cooldown: 0.36,
    auto: false,
    kick: 0.7,
    tracer: [1.6, 1.3, 0.6],
    muzzle: [0.22, -0.22, -0.72],
  },
  {
    id: 'shotgun',
    name: 'Shotgun',
    slot: 2,
    ammo: 'shells',
    pellets: 8,
    damage: [8, 12],
    spread: 0.075,
    cooldown: 0.85,
    auto: false,
    kick: 1,
    tracer: [1.6, 1.1, 0.4],
    muzzle: [0.22, -0.24, -1.1],
  },
  {
    id: 'machinegun',
    name: 'Machine Gun',
    slot: 3,
    ammo: 'bullets',
    pellets: 1,
    damage: [9, 13],
    spread: 0.028,
    cooldown: 0.085,
    auto: true,
    kick: 0.35,
    tracer: [1.4, 1.5, 0.8],
    muzzle: [0.22, -0.23, -1.22],
  },
]

export const AMMO_MAX: Record<AmmoType, number> = { bullets: 200, shells: 50 }
