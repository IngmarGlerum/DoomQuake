import { MAX_STEP, PLAYER_HEIGHT, type Cell, type Level } from './types'

const EPS = 1e-6
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

/** Kan de speler (zonder springen) van cel a naar buurcel b lopen? */
export function canWalk(a: Cell, b: Cell): boolean {
  if (a.solid || b.solid) return false
  if (Math.abs(a.floor - b.floor) > MAX_STEP + EPS) return false
  const headroom = Math.min(a.ceil, b.ceil) - Math.max(a.floor, b.floor)
  return headroom >= PLAYER_HEIGHT + 0.1 - EPS
}

/** Flood fill vanaf `start`; geeft per cel aan of hij bereikbaar is. */
export function reachable(level: Pick<Level, 'width' | 'height' | 'cells'>, start: number, doorsOpen: boolean): Uint8Array {
  const { width, height, cells } = level
  const seen = new Uint8Array(cells.length)
  const queue = [start]
  seen[start] = 1
  while (queue.length) {
    const i = queue.pop()!
    const x = i % width
    const y = (i - x) / width
    for (const [dx, dy] of DIRS) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const j = ny * width + nx
      if (seen[j]) continue
      if (!doorsOpen && cells[j].door) continue
      if (!canWalk(cells[i], cells[j])) continue
      seen[j] = 1
      queue.push(j)
    }
  }
  return seen
}

export interface Validation {
  ok: boolean
  problems: string[]
}

/**
 * Speelbaarheidseisen:
 * - zonder sleutel bereik je alle kamers behalve de exitkamer, en de sleutel zelf
 * - zonder sleutel bereik je de exit níet (de deur moet er echt toe doen)
 * - met open deuren is alles bereikbaar
 */
export function validateLevel(level: Level): Validation {
  const problems: string[] = []
  const { cells, rooms } = level
  if (cells[level.spawn.cell].liquid) problems.push('spawn staat in vloeistof')
  if (!cells.some((c) => c.door)) problems.push('geen deuren rond de exitkamer')

  const closed = reachable(level, level.spawn.cell, false)
  const open = reachable(level, level.spawn.cell, true)

  const roomReached = (seen: Uint8Array, id: number) => cells.some((c, i) => c.room === id && seen[i] === 1)

  for (const room of rooms) {
    if (room.id === level.exitRoom) {
      if (roomReached(closed, room.id)) problems.push('exitkamer bereikbaar zonder sleutel')
      if (!roomReached(open, room.id)) problems.push('exitkamer onbereikbaar')
    } else if (!roomReached(closed, room.id)) {
      problems.push(`kamer ${room.id} onbereikbaar zonder sleutel`)
    }
  }

  const key = level.things.find((t) => t.kind === 'key')
  const exit = level.things.find((t) => t.kind === 'exit')
  if (!key || !closed[key.cell]) problems.push('sleutel onbereikbaar')
  if (!exit || !open[exit.cell]) problems.push('exit onbereikbaar')

  return { ok: problems.length === 0, problems }
}
