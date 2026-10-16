import { CELL, type Level } from '../level/types'

export type RGB = [number, number, number]

export interface Lighting {
  /** Lichtkleur op een punt. Zonder normaal telt alleen afstand (voor objecten). */
  sample(x: number, y: number, z: number, normal?: RGB, out?: RGB): RGB
}

const AMBIENT = 0.035
const INTENSITY = 0.75
/** Doom-achtige lichtniveaus: licht in vaste stappen in plaats van vloeiend */
const BANDS = 14

/**
 * Gebakken belichting: per vertex worden alle lampen opgeteld, maar alleen als de lamp
 * de cel "ziet" (Bresenham-lijn door het grid zonder massieve cellen). Daardoor
 * lekt licht niet door muren en krijg je Doom-achtige donkere hoeken.
 */
export function createLighting(level: Level): Lighting {
  const { width, height, cells, lights } = level
  const lightCells = lights.map((l) => Math.floor(l.x / CELL) + Math.floor(l.z / CELL) * width)
  // 0 = onbekend, 1 = zichtbaar, 2 = geblokkeerd
  const visibility = lights.map(() => new Uint8Array(cells.length))

  const lineOfSight = (from: number, to: number) => {
    let x0 = from % width
    let y0 = Math.floor(from / width)
    const x1 = to % width
    const y1 = Math.floor(to / width)
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    while (x0 !== x1 || y0 !== y1) {
      if (cells[y0 * width + x0].solid) return false
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x0 += sx
      }
      if (e2 <= dx) {
        err += dx
        y0 += sy
      }
    }
    return true
  }

  const visible = (li: number, cell: number) => {
    const v = visibility[li]
    if (v[cell] === 0) v[cell] = lineOfSight(lightCells[li], cell) ? 1 : 2
    return v[cell] === 1
  }

  return {
    sample(x, y, z, normal, out = [0, 0, 0]) {
      const cx = Math.min(width - 1, Math.max(0, Math.floor(x / CELL)))
      const cy = Math.min(height - 1, Math.max(0, Math.floor(z / CELL)))
      const cell = cy * width + cx
      let r = AMBIENT
      let g = AMBIENT
      let b = AMBIENT
      for (let i = 0; i < lights.length; i++) {
        const l = lights[i]
        const dx = l.x - x
        const dy = l.y - y
        const dz = l.z - z
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 >= l.radius * l.radius) continue
        if (!visible(i, cell)) continue
        const d = Math.sqrt(d2)
        const falloff = (1 - d / l.radius) ** 2
        let facing = 1
        if (normal && d > 1e-4) facing = 0.35 + 0.65 * Math.max(0, (normal[0] * dx + normal[1] * dy + normal[2] * dz) / d)
        const f = falloff * facing * INTENSITY
        r += l.color[0] * f
        g += l.color[1] * f
        b += l.color[2] * f
      }
      const band = (v: number) => Math.min(1.3, Math.round(v * BANDS) / BANDS)
      out[0] = band(r)
      out[1] = band(g)
      out[2] = band(b)
      return out
    },
  }
}
