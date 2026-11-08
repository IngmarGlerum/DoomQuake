import * as THREE from 'three'
import { makeRng, type Rng } from '../rng'
import { heightToNormal } from './beretta'

/**
 * Hoge-resolutie PBR-textures voor het (realistische) gesticht, procedureel getekend:
 * kleur, ruwheid en een hoogtekaart waaruit een normal map wordt afgeleid.
 * Eén texture beslaat één cel (2 × 2 m), dus 512 px ≈ 4 mm per pixel.
 */
const S = 512

export interface PbrSet {
  map: THREE.CanvasTexture
  normal: THREE.CanvasTexture
  rough: THREE.CanvasTexture
  metalness: number
  normalScale: number
}

interface Layers {
  c: CanvasRenderingContext2D
  h: CanvasRenderingContext2D
  r: CanvasRenderingContext2D
  rng: Rng
}

type Painter = (l: Layers) => void

function canvas() {
  const el = document.createElement('canvas')
  el.width = el.height = S
  return el
}

/** Gladde, naadloze waarde-ruis (0..1) met `cells` roostercellen per texture. */
function noise(rng: Rng, cells: number) {
  const g = Array.from({ length: cells * cells }, () => rng.next())
  const at = (x: number, y: number) => g[((y % cells) + cells) % cells * cells + (((x % cells) + cells) % cells)]
  return (x: number, y: number) => {
    const fx = (x / S) * cells
    const fy = (y / S) * cells
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    let tx = fx - x0
    let ty = fy - y0
    tx = tx * tx * (3 - 2 * tx)
    ty = ty * ty * (3 - 2 * ty)
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx
    return a + (b - a) * ty
  }
}

/** Meerdere octaven ruis. */
function fbm(rng: Rng, base: number, octaves = 4) {
  const layers = Array.from({ length: octaves }, (_, i) => noise(rng, base << i))
  return (x: number, y: number) => {
    let v = 0
    let amp = 0.5
    let sum = 0
    for (const n of layers) {
      v += n(x, y) * amp
      sum += amp
      amp *= 0.5
    }
    return v / sum
  }
}

/** Per pixel bewerken van een laag. */
function perPixel(ctx: CanvasRenderingContext2D, fn: (x: number, y: number, rgb: [number, number, number]) => [number, number, number]) {
  const img = ctx.getImageData(0, 0, S, S)
  const d = img.data
  const px: [number, number, number] = [0, 0, 0]
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4
      px[0] = d[i]
      px[1] = d[i + 1]
      px[2] = d[i + 2]
      const o = fn(x, y, px)
      d[i] = o[0]
      d[i + 1] = o[1]
      d[i + 2] = o[2]
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

const fill = (ctx: CanvasRenderingContext2D, color: string) => {
  ctx.fillStyle = color
  ctx.fillRect(0, 0, S, S)
}

/** Wandtegels: geglazuurd (glanzend), afgeschuinde randen, grijze voegen, vergeeld en met roestvegen. */
const glazedTiles =
  (count: number, base: [number, number, number], grout: string): Painter =>
  ({ c, h, r, rng }) => {
    const t = S / count
    const g = 3
    fill(c, grout)
    fill(h, '#303030')
    fill(r, '#e0e0e0')
    for (let ty = 0; ty < count; ty++) {
      for (let tx = 0; tx < count; tx++) {
        const v = 0.93 + rng.next() * 0.08
        const x = tx * t + g / 2
        const y = ty * t + g / 2
        const w = t - g
        c.fillStyle = `rgb(${base[0] * v},${base[1] * v},${base[2] * v})`
        c.fillRect(x, y, w, w)
        // afgeronde rand in de hoogtekaart: van donker naar licht naar het midden
        for (let k = 0; k < 4; k++) {
          const lv = 120 + k * 35
          h.fillStyle = `rgb(${lv},${lv},${lv})`
          h.fillRect(x + k, y + k, w - 2 * k, w - 2 * k)
        }
        const rv = 40 + rng.next() * 25
        r.fillStyle = `rgb(${rv},${rv},${rv})`
        r.fillRect(x, y, w, w)
        // af en toe een gebarsten tegel
        if (rng.chance(0.06)) {
          c.strokeStyle = 'rgba(60,60,55,0.7)'
          h.strokeStyle = '#606060'
          for (const ctx of [c, h]) {
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(x + rng.next() * w, y)
            ctx.lineTo(x + rng.next() * w, y + w * (0.4 + rng.next() * 0.6))
            ctx.lineTo(x + rng.next() * w, y + w)
            ctx.stroke()
          }
        }
      }
    }
    // vergeling en vuil (ook op de voegen), plus roestige vegen die naar beneden lopen
    const grime = fbm(rng, 4)
    const streak = noise(rng, 64)
    perPixel(c, (x, y, p) => {
      const n = grime(x, y)
      const s = Math.max(0, streak(x, 0) - 0.72) * 3 * (0.6 + 0.4 * Math.sin(y * 0.01))
      const k = 1 - Math.max(0, n - 0.55) * 0.6
      return [p[0] * k * (1 - s * 0.25), p[1] * k * (1 - s * 0.35), p[2] * k * (1 - s * 0.5) * 0.98]
    })
    perPixel(r, (x, y, p) => {
      const n = grime(x, y)
      const v = Math.min(255, p[0] + Math.max(0, n - 0.5) * 220)
      return [v, v, v]
    })
  }

/** Vloertegels: grijsgroen, mat, met vuil in de voegen en slijtplekken. */
const floorTiles =
  (count: number, base: [number, number, number]): Painter =>
  ({ c, h, r, rng }) => {
    const t = S / count
    fill(c, '#3c403c')
    fill(h, '#404040')
    fill(r, '#f0f0f0')
    for (let ty = 0; ty < count; ty++) {
      for (let tx = 0; tx < count; tx++) {
        const v = 0.88 + rng.next() * 0.16
        c.fillStyle = `rgb(${base[0] * v},${base[1] * v},${base[2] * v})`
        c.fillRect(tx * t + 2, ty * t + 2, t - 4, t - 4)
        h.fillStyle = '#b0b0b0'
        h.fillRect(tx * t + 2, ty * t + 2, t - 4, t - 4)
        const rv = 120 + rng.next() * 40
        r.fillStyle = `rgb(${rv},${rv},${rv})`
        r.fillRect(tx * t + 2, ty * t + 2, t - 4, t - 4)
      }
    }
    const dirt = fbm(rng, 4)
    const fine = noise(rng, 128)
    perPixel(c, (x, y, p) => {
      const d = dirt(x, y)
      const k = (0.8 + fine(x, y) * 0.25) * (1 - Math.max(0, d - 0.5) * 0.7)
      return [p[0] * k, p[1] * k, p[2] * k]
    })
    perPixel(h, (x, y, p) => {
      const v = p[0] + (fine(x, y) - 0.5) * 25
      return [v, v, v]
    })
    perPixel(r, (x, y, p) => {
      // vochtige, gladder gelopen plekken
      const v = p[0] + (dirt(x, y) - 0.5) * 120
      return [v, v, v]
    })
  }

/** Systeemplafond: geperforeerde platen in een metalen rooster, met waterkringen. */
const ceilingTiles: Painter = ({ c, h, r, rng }) => {
  const count = 4
  const t = S / count
  fill(c, '#9a9e9a')
  fill(h, '#e0e0e0')
  fill(r, '#d0d0d0')
  for (let ty = 0; ty < count; ty++) {
    for (let tx = 0; tx < count; tx++) {
      const v = 0.92 + rng.next() * 0.08
      c.fillStyle = `rgb(${200 * v},${204 * v},${198 * v})`
      c.fillRect(tx * t + 4, ty * t + 4, t - 8, t - 8)
      h.fillStyle = '#909090'
      h.fillRect(tx * t + 4, ty * t + 4, t - 8, t - 8)
      // gaatjes
      for (let i = 0; i < 140; i++) {
        const x = tx * t + 8 + rng.next() * (t - 16)
        const y = ty * t + 8 + rng.next() * (t - 16)
        c.fillStyle = 'rgba(60,60,60,0.5)'
        c.fillRect(x, y, 2, 2)
        h.fillStyle = '#505050'
        h.fillRect(x, y, 2, 2)
      }
    }
  }
  // bruine waterkringen
  for (let i = 0; i < 3; i++) {
    const x = rng.next() * S
    const y = rng.next() * S
    const rad = 30 + rng.next() * 60
    const gr = c.createRadialGradient(x, y, rad * 0.4, x, y, rad)
    gr.addColorStop(0, 'rgba(150,120,70,0.15)')
    gr.addColorStop(0.85, 'rgba(120,90,50,0.35)')
    gr.addColorStop(1, 'rgba(120,90,50,0)')
    c.fillStyle = gr
    c.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }
}

/** Isoleercel: bolle, gecapitonneerde kussens met naden en knopen, vuile vegen. */
const padded: Painter = ({ c, h, r, rng }) => {
  const count = 8
  const t = S / count
  fill(r, '#f2f2f2')
  const img = h.createImageData(S, S)
  const col = c.createImageData(S, S)
  const smudge = fbm(rng, 4)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const lx = ((x % t) / t) * 2 - 1
      const ly = ((y % t) / t) * 2 - 1
      const d = Math.max(Math.abs(lx), Math.abs(ly))
      // bol kussen met zachte, ingesnoerde randen
      const bulge = Math.pow(Math.max(0, 1 - d * d), 0.6) * (1 - 0.25 * (lx * lx + ly * ly))
      const hv = 40 + bulge * 200
      const i = (y * S + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = hv
      img.data[i + 3] = 255
      const s = 1 - Math.max(0, smudge(x, y) - 0.55) * 0.8
      const shade = (0.8 + bulge * 0.2) * s
      col.data[i] = 228 * shade
      col.data[i + 1] = 224 * shade
      col.data[i + 2] = 212 * shade
      col.data[i + 3] = 255
    }
  }
  h.putImageData(img, 0, 0)
  c.putImageData(col, 0, 0)
  // knopen op de kruispunten
  for (let ty = 0; ty <= count; ty++) {
    for (let tx = 0; tx <= count; tx++) {
      for (const [ctx, color] of [
        [c, '#8a8478'],
        [h, '#101010'],
      ] as const) {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(tx * t, ty * t, 3.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
}

/** Gewit pleisterwerk: vochtplekken, afbladderende verf, barsten. */
const plaster: Painter = ({ c, h, r, rng }) => {
  fill(c, '#d8d3c6')
  fill(h, '#909090')
  fill(r, '#e6e6e6')
  const big = fbm(rng, 3)
  const fine = fbm(rng, 32, 3)
  const peel = fbm(rng, 6)
  perPixel(c, (x, y) => {
    // vochtplekken: zacht en geelbruin, nergens hard afgebakend
    const damp = Math.min(1, Math.max(0, big(x, y) - 0.5) * 1.6)
    const f = 0.92 + fine(x, y) * 0.1
    // hier en daar is de verf afgebladderd (alleen kleine plekjes)
    const pv = peel(x, y)
    const peeled = Math.min(1, Math.max(0, pv - 0.8) * 12)
    const r = (216 - damp * 30) * f
    const g = (211 - damp * 38) * f
    const b = (198 - damp * 56) * f
    return [r - peeled * 40, g - peeled * 42, b - peeled * 40]
  })
  perPixel(h, (x, y) => {
    const v = 128 + (fine(x, y) - 0.5) * 50 - Math.min(1, Math.max(0, peel(x, y) - 0.8) * 12) * 30
    return [v, v, v]
  })
  c.strokeStyle = 'rgba(70,64,56,0.55)'
  h.strokeStyle = '#303030'
  for (let i = 0; i < 6; i++) {
    let x = rng.next() * S
    let y = rng.next() * S
    for (const ctx of [c, h]) ctx.beginPath()
    for (const ctx of [c, h]) ctx.moveTo(x, y)
    for (let k = 0; k < 8; k++) {
      x += (rng.next() - 0.5) * 30
      y += rng.next() * 25
      for (const ctx of [c, h]) ctx.lineTo(x, y)
    }
    for (const ctx of [c, h]) {
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }
}

/** Oude, donkere houten vloerdelen met nerf en kieren. */
const planks: Painter = ({ c, h, r, rng }) => {
  const boards = 16
  const bw = S / boards
  const grain = noise(rng, 256)
  const knot = fbm(rng, 8)
  const tints = Array.from({ length: boards * 4 }, () => 0.8 + rng.next() * 0.35)
  perPixel(c, (x, y) => {
    const b = Math.floor(x / bw)
    const seg = Math.floor((y + b * 61) / (S / 2)) % 2
    const tint = tints[b * 2 + seg]
    const g = 0.85 + Math.sin((y + grain(x * 4, y) * 80) * 0.15 + b) * 0.07 + (knot(x, y) - 0.5) * 0.2
    const gap = x % bw < 1.5 || (y + b * 61) % (S / 2) < 1.5
    const k = gap ? 0.25 : tint * g
    return [78 * k, 56 * k, 40 * k]
  })
  perPixel(h, (x, y) => {
    const b = Math.floor(x / bw)
    const gap = x % bw < 1.5 || (y + b * 61) % (S / 2) < 1.5
    const v = gap ? 30 : 140 + Math.sin((y + grain(x * 4, y) * 80) * 0.15 + b) * 12
    return [v, v, v]
  })
  perPixel(r, (x, y) => {
    const v = 150 + (knot(x, y) - 0.5) * 80
    return [v, v, v]
  })
}

/** Zeshoekig metalen rooster (loopbrug), met donkere gaten. */
const hexGrate: Painter = ({ c, h, r, rng }) => {
  const rust = fbm(rng, 6)
  const size = 22
  const hexDist = (x: number, y: number) => {
    // afstand tot het midden van de dichtstbijzijnde zeshoek
    const w = size * Math.sqrt(3)
    const row = Math.floor(y / (size * 1.5))
    let best = 1e9
    for (let dr = -1; dr <= 1; dr++) {
      const rr = row + dr
      const o = rr % 2 ? w / 2 : 0
      const cy = rr * size * 1.5 + size * 0.75
      for (let k = -1; k <= 1; k++) {
        const cx = Math.floor((x - o) / w + k) * w + w / 2 + o
        const dx = Math.abs(x - cx)
        const dy = Math.abs(y - cy)
        const d = Math.max(dx * 0.866 + dy * 0.5, dy)
        if (d < best) best = d
      }
    }
    return best / size
  }
  const cache = new Float32Array(S * S)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) cache[y * S + x] = hexDist(x, y)
  perPixel(c, (x, y) => {
    const d = cache[y * S + x]
    if (d < 0.72) return [14, 15, 16]
    const k = 0.9 + (rust(x, y) - 0.5) * 0.5
    const rr = rust(x, y) > 0.66 ? 1 : 0
    return [150 * k + rr * 20, 156 * k - rr * 10, 160 * k - rr * 30]
  })
  perPixel(h, (x, y) => {
    const d = cache[y * S + x]
    const v = d < 0.72 ? 0 : 150 + Math.min(1, (d - 0.72) * 6) * 80
    return [v, v, v]
  })
  perPixel(r, (x, y) => {
    const v = 90 + rust(x, y) * 120
    return [v, v, v]
  })
}

interface Spec {
  paint: Painter
  metalness?: number
  normalScale?: number
  normalStrength?: number
}

const SPECS: Record<string, Spec> = {
  asylum_wall: { paint: glazedTiles(12, [222, 226, 218], '#8c928c'), normalStrength: 3 },
  asylum_floor: { paint: floorTiles(6, [128, 142, 134]), normalStrength: 2 },
  asylum_ceil: { paint: ceilingTiles, normalStrength: 2 },
  padded_wall: { paint: padded, normalStrength: 5, normalScale: 1.4 },
  padded_floor: { paint: floorTiles(6, [196, 198, 192]), normalStrength: 2 },
  padded_ceil: { paint: padded, normalStrength: 5, normalScale: 1.4 },
  oldward_wall: { paint: plaster, normalStrength: 3 },
  oldward_floor: { paint: planks, normalStrength: 3 },
  oldward_ceil: { paint: plaster, normalStrength: 2 },
  atrium_wall: { paint: glazedTiles(8, [200, 210, 206], '#7a8480'), normalStrength: 3 },
  atrium_floor: { paint: hexGrate, metalness: 0.7, normalStrength: 6, normalScale: 1.2 },
  atrium_ceil: { paint: ceilingTiles, normalStrength: 2 },
}

const cache = new Map<string, PbrSet>()

/** PBR-set voor een texturenaam, of null als er (nog) geen realistische versie van is. */
export function getPbr(name: string): PbrSet | null {
  const hit = cache.get(name)
  if (hit) return hit
  const spec = SPECS[name]
  if (!spec) return null
  const [ce, he, re] = [canvas(), canvas(), canvas()]
  const layers: Layers = {
    c: ce.getContext('2d', { willReadFrequently: true })!,
    h: he.getContext('2d', { willReadFrequently: true })!,
    r: re.getContext('2d', { willReadFrequently: true })!,
    rng: makeRng(`pbr:${name}`),
  }
  spec.paint(layers)
  const tex = (el: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(el)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 8
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    return t
  }
  const set: PbrSet = {
    map: tex(ce, true),
    normal: tex(heightToNormal(he, spec.normalStrength ?? 3), false),
    // three leest ruwheid uit het groene kanaal
    rough: tex(re, false),
    metalness: spec.metalness ?? 0,
    normalScale: spec.normalScale ?? 1,
  }
  cache.set(name, set)
  return set
}
