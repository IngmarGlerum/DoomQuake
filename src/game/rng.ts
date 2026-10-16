/** Kleine, deterministische RNG (mulberry32) zodat een seed altijd hetzelfde level oplevert. */
export interface Rng {
  /** float in [0, 1) */
  next(): number
  /** integer in [min, max] (inclusief) */
  int(min: number, max: number): number
  /** true met kans p */
  chance(p: number): boolean
  pick<T>(items: readonly T[]): T
  shuffle<T>(items: T[]): T[]
}

export function hashSeed(seed: string): number {
  // FNV-1a
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function makeRng(seed: string | number): Rng {
  let a = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed)
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    shuffle: (items) => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[items[i], items[j]] = [items[j], items[i]]
      }
      return items
    },
  }
  return rng
}

export function randomSeed(): string {
  const words = ['hangar', 'nukage', 'toxin', 'phobos', 'deimos', 'inferno', 'refinery', 'command', 'tower', 'gate', 'abyss', 'forge']
  const w = words[Math.floor(Math.random() * words.length)]
  return `${w}-${Math.floor(Math.random() * 9000 + 1000)}`
}
