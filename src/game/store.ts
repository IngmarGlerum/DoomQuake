import * as THREE from 'three'
import { create } from 'zustand'
import { AMMO_MAX, WEAPONS, type AmmoType } from './combat/weapons'
import { randomSeed } from './rng'

export type Status = 'playing' | 'won' | 'dead'
export type PickupKind = 'health' | 'ammo' | 'armor'

interface GameState {
  seed: string
  /** verhoogd bij elke (her)start, zodat de scene opnieuw mount */
  run: number
  status: Status
  hasKey: boolean
  health: number
  armor: number
  ammo: Record<AmmoType, number>
  /** index in WEAPONS */
  weapon: number
  kills: number
  enemies: number
  /** tijdstip van laatste schade (voor de rode flits) */
  hurtAt: number
  message: string
  messageAt: number
  locked: boolean
  showMap: boolean
  noclip: boolean

  newLevel(seed?: string): void
  restart(): void
  say(message: string): void
  pickup(kind: PickupKind): boolean
  takeKey(): void
  damage(amount: number): void
  /** verbruikt munitie voor het huidige wapen; false als leeg */
  useAmmo(): boolean
  selectWeapon(index: number): boolean
  setEnemyCount(n: number): void
  addKill(): void
  win(): void
  setLocked(locked: boolean): void
  toggleMap(): void
  toggleNoclip(): void
}

const initialSeed = new URLSearchParams(window.location.search).get('seed') || randomSeed()

const fresh = () => ({
  status: 'playing' as Status,
  hasKey: false,
  health: 100,
  armor: 0,
  ammo: { bullets: 60, shells: 12, rockets: 8 },
  weapon: 0,
  kills: 0,
  enemies: 0,
  hurtAt: -1e9,
  message: '',
  messageAt: 0,
})

export const useGame = create<GameState>()((set, get) => ({
  seed: initialSeed,
  run: 0,
  ...fresh(),
  locked: false,
  showMap: true,
  noclip: false,

  newLevel(seed = randomSeed()) {
    const url = new URL(window.location.href)
    url.searchParams.set('seed', seed)
    window.history.replaceState(null, '', url)
    set((s) => ({ ...fresh(), seed, run: s.run + 1 }))
  },
  restart() {
    set((s) => ({ ...fresh(), run: s.run + 1 }))
  },
  say(message) {
    set({ message, messageAt: performance.now() })
  },
  pickup(kind) {
    const s = get()
    if (kind === 'health') {
      if (s.health >= 100) return false
      set({ health: Math.min(100, s.health + 25) })
      s.say('Medikit opgepakt')
    } else if (kind === 'armor') {
      if (s.armor >= 100) return false
      set({ armor: Math.min(100, s.armor + 50) })
      s.say('Armor opgepakt')
    } else {
      if (s.ammo.bullets >= AMMO_MAX.bullets && s.ammo.shells >= AMMO_MAX.shells && s.ammo.rockets >= AMMO_MAX.rockets) return false
      set({
        ammo: {
          bullets: Math.min(AMMO_MAX.bullets, s.ammo.bullets + 30),
          shells: Math.min(AMMO_MAX.shells, s.ammo.shells + 6),
          rockets: Math.min(AMMO_MAX.rockets, s.ammo.rockets + 2),
        },
      })
      s.say('Munitie opgepakt')
    }
    return true
  },
  takeKey() {
    set({ hasKey: true })
    get().say('Rode sleutel opgepakt!')
  },
  damage(amount) {
    const s = get()
    if (s.status !== 'playing' || get().noclip) return
    const absorbed = Math.min(s.armor, amount / 3)
    const health = Math.max(0, s.health - (amount - absorbed))
    set({ armor: s.armor - absorbed, health, hurtAt: performance.now(), status: health <= 0 ? 'dead' : s.status })
  },
  useAmmo() {
    const s = get()
    const type = WEAPONS[s.weapon].ammo
    if (s.ammo[type] <= 0 || s.status !== 'playing') return false
    set({ ammo: { ...s.ammo, [type]: s.ammo[type] - 1 } })
    return true
  },
  selectWeapon(index) {
    if (index < 0 || index >= WEAPONS.length || index === get().weapon) return false
    set({ weapon: index })
    return true
  },
  setEnemyCount(enemies) {
    set({ enemies, kills: 0 })
  },
  addKill() {
    set((s) => ({ kills: s.kills + 1 }))
  },
  win() {
    if (get().status === 'playing') set({ status: 'won' })
  },
  setLocked(locked) {
    set({ locked })
  },
  toggleMap() {
    set((s) => ({ showMap: !s.showMap }))
  },
  toggleNoclip() {
    const noclip = !get().noclip
    set({ noclip })
    get().say(noclip ? 'Noclip AAN (vrij vliegen)' : 'Noclip UIT')
  },
}))

/** Mutable spelerspositie voor systemen die elk frame lezen (geen React-renders). */
export const player = {
  position: new THREE.Vector3(),
  yaw: 0,
  speed: 0,
  grounded: false,
  cell: 0,
  /** wordt door explosies gevuld en door de Player-controller bij de snelheid opgeteld (rocket jumps) */
  impulse: new THREE.Vector3(),
}
