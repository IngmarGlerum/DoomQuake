import { describe, expect, it } from 'vitest'
import { generateAsylumLevel } from './generateAsylum'
import { validateLevel } from './validate'

describe('generateAsylumLevel', () => {
  it('is deterministisch per seed', () => {
    expect(JSON.stringify(generateAsylumLevel('ward-7'))).toBe(JSON.stringify(generateAsylumLevel('ward-7')))
  })

  it('maakt over veel seeds speelbare gestichten met decor en patiënten', () => {
    const counts: Record<string, number> = {}
    for (let i = 0; i < 60; i++) {
      const level = generateAsylumLevel(`asylum-test-${i}`)
      expect(validateLevel(level).problems).toEqual([])
      expect(level.kind).toBe('asylum')
      expect(level.things.filter((t) => t.kind === 'key')).toHaveLength(1)
      expect(level.things.filter((t) => t.kind === 'exit')).toHaveLength(1)
      // geen vijanden: alleen patiënten
      expect(level.things.some((t) => t.kind === 'enemy')).toBe(false)
      expect(level.npcs!.length).toBeGreaterThanOrEqual(6)
      // je begint in een oude cel; er is een hal met een schacht
      expect(level.rooms[level.startRoom].purpose).toBe('cell')
      expect(level.rooms.some((r) => r.purpose === 'atrium')).toBe(true)
      expect(level.cells.some((c) => !c.solid && c.floor < -1)).toBe(true)
      for (const r of level.rooms) counts[r.purpose!] = (counts[r.purpose!] ?? 0) + 1
      for (const p of level.props ?? []) counts[p.kind] = (counts[p.kind] ?? 0) + 1
      // niets staat op een decorstuk of in de schacht, en patiënten staan op beloopbare cellen
      for (const t of level.things) {
        expect(level.cells[t.cell].prop).toBeFalsy()
        expect(level.cells[t.cell].floor).toBeGreaterThan(-1)
      }
      for (const n of level.npcs!) {
        const c = level.cells[n.cell]
        expect(c.solid || c.prop || c.floor < -1).toBe(false)
      }
    }
    for (const kind of ['ward', 'exam', 'padded', 'cell', 'bed', 'ironbed', 'screen', 'monitor', 'examtable', 'mattress', 'window', 'railing', 'pod', 'strip', 'ceillight', 'blood']) {
      expect(counts[kind] ?? 0, kind).toBeGreaterThan(0)
    }
  })
})
