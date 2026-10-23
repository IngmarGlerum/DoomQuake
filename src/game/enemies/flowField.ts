import { canWalk } from '../level/validate'
import type { Level } from '../level/types'

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

/**
 * Breadth-first "flow field" vanaf de cel van de speler: per cel het aantal stappen
 * naar de speler (-1 = onbereikbaar). Alle vijanden delen één veld, dus pathfinding
 * kost per frame niets extra per vijand.
 */
export function computeFlowField(level: Level, target: number, doorsOpen: boolean, out?: Int32Array): Int32Array {
  const { width, height, cells } = level
  const dist = out ?? new Int32Array(cells.length)
  dist.fill(-1)
  if (target < 0 || target >= cells.length || cells[target].solid) return dist
  const queue = new Int32Array(cells.length)
  let head = 0
  let tail = 0
  queue[tail++] = target
  dist[target] = 0
  while (head < tail) {
    const i = queue[head++]
    const x = i % width
    const y = (i - x) / width
    for (const [dx, dy] of DIRS) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const j = ny * width + nx
      if (dist[j] !== -1) continue
      if (!doorsOpen && cells[j].door) continue
      if (cells[j].prop || !canWalk(cells[i], cells[j])) continue
      dist[j] = dist[i] + 1
      queue[tail++] = j
    }
  }
  return dist
}

/** Buurcel die dichter bij de speler ligt, of -1. */
export function nextStep(level: Level, field: Int32Array, from: number): number {
  const { width, height } = level
  const here = field[from]
  if (here <= 0) return -1
  const x = from % width
  const y = (from - x) / width
  let best = -1
  let bestD = here
  for (const [dx, dy] of DIRS) {
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
    const j = ny * width + nx
    if (field[j] >= 0 && field[j] < bestD) {
      bestD = field[j]
      best = j
    }
  }
  return best
}
