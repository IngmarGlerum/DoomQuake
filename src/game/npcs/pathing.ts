import { canWalk } from '../level/validate'
import type { Cell, Level } from '../level/types'

/** Waar een patiënt mag lopen: geen decor, geen deuren, niet de schacht in. */
const free = (c: Cell | undefined) => !!c && !c.solid && !c.prop && !c.door && !c.slide && c.floor > -1

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

function neighbours(level: Pick<Level, 'width' | 'height' | 'cells'>, i: number) {
  const x = i % level.width
  const y = (i - x) / level.width
  const out: number[] = []
  for (const [dx, dy] of DIRS) {
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || ny < 0 || nx >= level.width || ny >= level.height) continue
    const j = ny * level.width + nx
    if (free(level.cells[j]) && canWalk(level.cells[i], level.cells[j])) out.push(j)
  }
  return out
}

/** Kortste pad (BFS) van `from` naar `to`, zonder `from` zelf; leeg als er geen pad is. */
export function findPath(level: Pick<Level, 'width' | 'height' | 'cells'>, from: number, to: number, maxSteps = 400): number[] {
  if (from === to || !free(level.cells[to])) return []
  const prev = new Map<number, number>([[from, -1]])
  const queue = [from]
  for (let head = 0; head < queue.length && head < maxSteps * 4; head++) {
    const i = queue[head]
    if (i === to) break
    for (const j of neighbours(level, i)) {
      if (prev.has(j)) continue
      prev.set(j, i)
      queue.push(j)
    }
  }
  if (!prev.has(to)) return []
  const path: number[] = []
  for (let i = to; i !== from; i = prev.get(i)!) path.push(i)
  return path.reverse()
}

/** Willekeurige bereikbare cel binnen `radius` stappen van de thuisplek. */
export function randomReachable(level: Pick<Level, 'width' | 'height' | 'cells'>, home: number, from: number, radius: number, random = Math.random): number {
  const dist = new Map<number, number>([[home, 0]])
  const queue = [home]
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]
    const d = dist.get(i)!
    if (d >= radius) continue
    for (const j of neighbours(level, i)) {
      if (dist.has(j)) continue
      dist.set(j, d + 1)
      queue.push(j)
    }
  }
  const options = queue.filter((i) => i !== from && dist.get(i)! >= 2)
  return options.length ? options[Math.floor(random() * options.length)] : -1
}

/** Eindcel van de langste rechte vrije lijn (max `maxLen` cellen) vanaf `cell`, om heen en weer te lopen. */
export function straightRun(level: Pick<Level, 'width' | 'height' | 'cells'>, cell: number, maxLen: number): number {
  let best = cell
  let bestLen = 0
  for (const [dx, dy] of DIRS) {
    let i = cell
    let len = 0
    while (len < maxLen) {
      const x = (i % level.width) + dx
      const y = Math.floor(i / level.width) + dy
      if (x < 0 || y < 0 || x >= level.width || y >= level.height) break
      const j = y * level.width + x
      if (!free(level.cells[j]) || !canWalk(level.cells[i], level.cells[j])) break
      i = j
      len++
    }
    if (len > bestLen) {
      bestLen = len
      best = i
    }
  }
  return bestLen >= 2 ? best : cell
}
