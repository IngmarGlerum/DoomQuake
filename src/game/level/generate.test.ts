import { describe, expect, it } from 'vitest'
import { generateLevel } from './generate'
import { validateLevel } from './validate'

describe('generateLevel', () => {
  it('is deterministisch per seed', () => {
    const a = generateLevel('phobos-1234')
    const b = generateLevel('phobos-1234')
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('geeft verschillende levels voor verschillende seeds', () => {
    const a = generateLevel('seed-a')
    const b = generateLevel('seed-b')
    expect(JSON.stringify(a.cells)).not.toBe(JSON.stringify(b.cells))
  })

  it('maakt over veel seeds speelbare levels met hoogteverschillen', () => {
    for (let i = 0; i < 150; i++) {
      const level = generateLevel(`test-${i}`)
      expect(validateLevel(level).problems).toEqual([])
      expect(level.things.filter((t) => t.kind === 'key')).toHaveLength(1)
      expect(level.things.filter((t) => t.kind === 'exit')).toHaveLength(1)
      expect(level.things.some((t) => t.kind === 'enemy')).toBe(true)
      // de grotwezens komen hier nooit voor
      for (const t of level.things) if (t.kind === 'enemy') expect(['grunt', 'imp', 'demon']).toContain(t.enemy)
      const floors = new Set(level.cells.filter((c) => !c.solid).map((c) => c.floor))
      expect(floors.size).toBeGreaterThan(1)
      expect(new Set([level.startRoom, level.keyRoom, level.exitRoom]).size).toBe(3)
    }
  })
})
