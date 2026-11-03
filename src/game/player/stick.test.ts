import { describe, expect, it } from 'vitest'
import { stick } from './stick'

describe('stick', () => {
  it('negeert kleine uitslag (dode zone) en geeft vol bij volle uitslag', () => {
    expect(stick(0.1, 0, 0.15, 1)).toEqual({ x: 0, y: 0, mag: 0 })
    const full = stick(0, -1, 0.15, 1)
    expect(full.y).toBeCloseTo(-1)
    expect(full.mag).toBeCloseTo(1)
  })

  it('houdt de richting aan en loopt vloeiend op vanaf de rand van de dode zone', () => {
    const d = stick(0.3, 0.3, 0.12, 1.8)
    expect(d.x).toBeCloseTo(d.y)
    expect(stick(0.13, 0, 0.12, 1.8).mag).toBeLessThan(0.01)
    const a = stick(0.4, 0, 0.12, 1.8).mag
    const b = stick(0.7, 0, 0.12, 1.8).mag
    expect(b).toBeGreaterThan(a)
    // curve: halve uitslag geeft minder dan de helft van de draaisnelheid (fijn richten)
    expect(stick(0.56, 0, 0.12, 1.8).mag).toBeLessThan(0.5)
  })
})
