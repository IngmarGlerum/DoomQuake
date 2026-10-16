import { describe, expect, it } from 'vitest'
import { generateLevel } from '../level/generate'
import { computeFlowField, nextStep } from './flowField'

describe('flow field', () => {
  it('leidt elke bereikbare vijand stap voor stap naar de speler', () => {
    const level = generateLevel('phobos-1234')
    const field = computeFlowField(level, level.spawn.cell, false)
    expect(field[level.spawn.cell]).toBe(0)
    for (const t of level.things.filter((t) => t.kind === 'enemy')) {
      if (field[t.cell] < 0) continue // achter de exitdeur
      let cell = t.cell
      let steps = 0
      while (field[cell] > 0) {
        cell = nextStep(level, field, cell)
        expect(cell).toBeGreaterThanOrEqual(0)
        if (++steps > 10000) throw new Error('loopt rondjes')
      }
      expect(cell).toBe(level.spawn.cell)
    }
  })

  it('houdt vijanden achter dichte deuren tot de deur open is', () => {
    const level = generateLevel('phobos-1234')
    const exitCell = level.things.find((t) => t.kind === 'exit')!.cell
    expect(computeFlowField(level, level.spawn.cell, false)[exitCell]).toBe(-1)
    expect(computeFlowField(level, level.spawn.cell, true)[exitCell]).toBeGreaterThan(0)
  })
})
