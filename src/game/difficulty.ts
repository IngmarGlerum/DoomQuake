import { isTouchDevice } from './player/input'

export interface Difficulty {
  name: string
  /** vermenigvuldiger voor schade die de speler krijgt */
  damageTaken: number
  /** vermenigvuldiger voor schade die de speler doet */
  damageDealt: number
}

const NORMAL: Difficulty = { name: 'normaal', damageTaken: 1, damageDealt: 1 }
/** Mikken met je duim is lastiger dan met een muis, dus op telefoons is het spel vergevingsgezinder. */
const MOBILE: Difficulty = { name: 'mobiel', damageTaken: 0.5, damageDealt: 1.5 }

// ?difficulty=mobiel of ?difficulty=normaal forceert een stand (handig om te testen)
const forced = new URLSearchParams(window.location.search).get('difficulty')

export const DIFFICULTY: Difficulty = forced === 'mobiel' ? MOBILE : forced === 'normaal' ? NORMAL : isTouchDevice ? MOBILE : NORMAL
