import { generateLevel } from './generate'
import { generateCaveLevel } from './generateCaves'
import type { Level, LevelKind } from './types'

export interface LevelInfo {
  kind: LevelKind
  name: string
  description: string
  generate: (seed: string) => Level
}

/** Alle levels die je in het beginscherm kunt kiezen. */
export const LEVELS: Record<LevelKind, LevelInfo> = {
  outpost: {
    kind: 'outpost',
    name: 'Buitenpost',
    description: 'Tech-basis, bakstenen hallen en de hel. Vol vijanden.',
    generate: (seed) => generateLevel(seed),
  },
  caves: {
    kind: 'caves',
    name: 'Grotbasis',
    description: 'Kronkelige grotten met een kwaadaardige basis. Nog geen vijanden.',
    generate: (seed) => generateCaveLevel(seed),
  },
}

export const LEVEL_ORDER: LevelKind[] = ['outpost', 'caves']
