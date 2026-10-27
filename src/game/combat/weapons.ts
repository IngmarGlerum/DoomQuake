export type WeaponId = 'pistol' | 'shotgun' | 'machinegun' | 'rocket' | 'disk'
export type AmmoType = 'bullets' | 'shells' | 'rockets' | 'disks'

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
  /** vuurt een projectiel (raket) in plaats van hitscan */
  projectile?: boolean
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
    muzzle: [0.18, -0.19, -0.71],
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
    name: 'Assault Rifle',
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
  {
    id: 'rocket',
    name: 'Rocket Launcher',
    slot: 4,
    ammo: 'rockets',
    pellets: 1,
    // directe treffer; de explosie doet daarnaast splash damage (zie explosions.ts)
    damage: [40, 60],
    spread: 0,
    cooldown: 0.8,
    auto: false,
    kick: 1,
    tracer: [0, 0, 0],
    muzzle: [0.24, -0.2, -1.0],
    projectile: true,
  },
  {
    id: 'disk',
    name: 'Disk Launcher',
    slot: 5,
    ammo: 'disks',
    pellets: 1,
    // schade per geraakte vijand; de schijf vliegt door vijanden heen en stuitert 5x
    damage: [34, 44],
    spread: 0,
    // vuren + leeg + nieuwe schijf laden (zie de viewmodel-animatie in Weapon.tsx)
    cooldown: 0.8,
    auto: false,
    kick: 0.5,
    tracer: [0, 0, 0],
    muzzle: [0.22, -0.17, -0.75],
    projectile: true,
  },
]

export const AMMO_MAX: Record<AmmoType, number> = { bullets: 200, shells: 50, rockets: 30, disks: 40 }

export const AMMO_LABEL: Record<AmmoType, string> = { bullets: 'BULLETS', shells: 'SHELLS', rockets: 'ROCKETS', disks: 'DISKS' }
