import { describe, expect, it } from 'vitest'
import { makeRng } from '../rng'
import { createRicochetPicker } from './ricochet'

describe('createRicochetPicker', () => {
  const run = (seed: string, n: number) => {
    const rng = makeRng(seed)
    const pick = createRicochetPicker(() => rng.next())
    const hits: number[] = []
    for (let i = 0; i < n; i++) if (pick()) hits.push(i)
    return hits
  }

  it('ketst gemiddeld bij ongeveer één op de drie missers', () => {
    const hits = run('rico', 30000)
    expect(hits.length / 30000).toBeGreaterThan(0.29)
    expect(hits.length / 30000).toBeLessThan(0.36)
  })

  it('heeft geen vast ritme: wisselende tussenpozen, nooit langer dan 6 missers', () => {
    const hits = run('rico-2', 3000)
    const gaps = hits.slice(1).map((h, i) => h - hits[i])
    const counts = new Map<number, number>()
    for (const g of gaps) counts.set(g, (counts.get(g) ?? 0) + 1)
    for (const g of [1, 2, 3, 4, 5]) expect(counts.get(g) ?? 0, `afstand ${g}`).toBeGreaterThan(0)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(6)
    // de meest voorkomende afstand komt in minder dan een derde van de gevallen voor
    expect(Math.max(...counts.values()) / gaps.length).toBeLessThan(0.34)
  })
})
