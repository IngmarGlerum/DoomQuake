import { describe, expect, it } from 'vitest'
import { generateCaveLevel } from './generateCaves'
import { validateLevel } from './validate'

describe('generateCaveLevel', () => {
  it('is deterministisch per seed', () => {
    expect(JSON.stringify(generateCaveLevel('abyss-1'))).toBe(JSON.stringify(generateCaveLevel('abyss-1')))
  })

  it('maakt over veel seeds speelbare grotlevels met basis-decor', () => {
    const counts: Record<string, number> = {}
    for (let i = 0; i < 60; i++) {
      const level = generateCaveLevel(`cave-test-${i}`)
      expect(validateLevel(level).problems).toEqual([])
      expect(level.kind).toBe('caves')
      expect(level.things.filter((t) => t.kind === 'key')).toHaveLength(1)
      expect(level.things.filter((t) => t.kind === 'exit')).toHaveLength(1)
      // alleen de grotwezens, nooit de vijanden uit het eerste level
      const enemies = level.things.filter((t) => t.kind === 'enemy')
      expect(enemies.length).toBeGreaterThan(3)
      for (const e of enemies) expect(['mutant', 'clawbeast']).toContain(e.enemy)
      for (const e of enemies) expect(level.cells[e.cell].room).not.toBe(level.startRoom)
      for (const e of enemies) counts[e.enemy!] = (counts[e.enemy!] ?? 0) + 1
      // schuifdeuren en een deur op slot voor de exit
      expect(level.cells.some((c) => c.slide)).toBe(true)
      expect(level.cells.some((c) => c.door)).toBe(true)
      // zowel grotten als basiskamers
      expect(level.rooms.some((r) => r.kind === 'cave')).toBe(true)
      expect(level.rooms.some((r) => r.kind === 'base')).toBe(true)
      for (const p of level.props ?? []) counts[p.kind] = (counts[p.kind] ?? 0) + 1
      // het decor staat nooit op de start, sleutel of exit
      for (const t of level.things) expect(level.cells[t.cell].prop).toBeFalsy()
    }
    for (const kind of ['mutant', 'clawbeast', 'rack', 'terminal', 'switchboard', 'cage', 'crate', 'lamp', 'pipe', 'cable']) {
      expect(counts[kind] ?? 0, kind).toBeGreaterThan(0)
    }
  })
})
