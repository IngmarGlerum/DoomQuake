import * as THREE from 'three'
import { create } from 'zustand'
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
  ammo: number
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
  fire(): boolean
  win(): void
  setLocked(locked: boolean): void
  toggleMap(): void
  toggleNoclip(): void
}

const initialSeed = new URLSearchParams(window.location.search).get('seed') || randomSeed()

const fresh = { status: 'playing' as Status, hasKey: false, health: 100, armor: 0, ammo: 25, message: '', messageAt: 0 }

export const useGame = create<GameState>()((set, get) => ({
  seed: initialSeed,
  run: 0,
  ...fresh,
  locked: false,
  showMap: true,
  noclip: false,

  newLevel(seed = randomSeed()) {
    const url = new URL(window.location.href)
    url.searchParams.set('seed', seed)
    window.history.replaceState(null, '', url)
    set((s) => ({ ...fresh, seed, run: s.run + 1 }))
  },
  restart() {
    set((s) => ({ ...fresh, run: s.run + 1 }))
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
      set({ ammo: Math.min(99, s.ammo + 8) })
      s.say('Shells opgepakt')
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
    set({ armor: s.armor - absorbed, health, status: health <= 0 ? 'dead' : s.status })
  },
  fire() {
    const s = get()
    if (s.ammo <= 0 || s.status !== 'playing') return false
    set({ ammo: s.ammo - 1 })
    return true
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
}
