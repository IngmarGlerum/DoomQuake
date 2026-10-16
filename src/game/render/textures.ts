import * as THREE from 'three'
import { makeRng, type Rng } from '../rng'

/**
 * Procedurele 64×64 pixel-art textures. Geen externe assets nodig; alles wordt
 * bij het opstarten op een canvas getekend en met NearestFilter gebruikt.
 */
const SIZE = 64

type RGB = [number, number, number]
type Painter = (px: (x: number, y: number, c: RGB) => void, rng: Rng) => void

const shade = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f]
const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255]

function makeTexture(name: string, paint: Painter): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(SIZE, SIZE)
  const rng = makeRng(name)
  // posterize naar 32 niveaus per kanaal voor een beperkt palet
  const q = (v: number) => Math.max(0, Math.min(255, Math.round(v / 8) * 8))
  paint((x, y, [r, g, b]) => {
    const i = (((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)) * 4
    img.data[i] = q(r)
    img.data[i + 1] = q(g)
    img.data[i + 2] = q(b)
    img.data[i + 3] = 255
  }, rng)
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestMipmapNearestFilter
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.name = name
  return tex
}

/** Waarde-ruis op een grof raster, bilineair geïnterpoleerd en naadloos. */
function valueNoise(rng: Rng, cells: number) {
  const grid = Array.from({ length: cells * cells }, () => rng.next())
  const g = (x: number, y: number) => grid[((y + cells) % cells) * cells + ((x + cells) % cells)]
  return (x: number, y: number) => {
    const fx = (x / SIZE) * cells
    const fy = (y / SIZE) * cells
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * tx
    const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * tx
    return a + (b - a) * ty
  }
}

const bricks =
  (base: RGB, mortar: RGB, bw = 16, bh = 8): Painter =>
  (px, rng) => {
    const n = valueNoise(rng, 8)
    const tint = new Map<string, number>()
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const row = Math.floor(y / bh)
        const ox = row % 2 ? bw / 2 : 0
        const bx = Math.floor((x + ox) / bw)
        const key = `${bx},${row}`
        if (!tint.has(key)) tint.set(key, 0.8 + rng.next() * 0.3)
        const lx = (x + ox) % bw
        const ly = y % bh
        const grain = 0.85 + n(x, y) * 0.25 + rng.next() * 0.08
        if (lx === 0 || ly === 0) px(x, y, shade(mortar, grain))
        else if (ly === 1 || lx === 1) px(x, y, shade(base, tint.get(key)! * grain * 1.15))
        else if (ly === bh - 1) px(x, y, shade(base, tint.get(key)! * grain * 0.7))
        else px(x, y, shade(base, tint.get(key)! * grain))
      }
    }
  }

const panels =
  (base: RGB, accent: RGB, tile = 32): Painter =>
  (px, rng) => {
    const n = valueNoise(rng, 16)
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const lx = x % tile
        const ly = y % tile
        let c = shade(base, 0.85 + n(x, y) * 0.25 + rng.next() * 0.06)
        if (lx === 0 || ly === 0) c = shade(base, 0.45)
        else if (lx === 1 || ly === 1) c = shade(base, 1.3)
        else if (lx === tile - 1 || ly === tile - 1) c = shade(base, 0.6)
        // klinknagels
        if ((lx === 4 || lx === tile - 4) && (ly === 4 || ly === tile - 4)) c = shade(base, 1.5)
        // horizontale accentstreep in het midden van elke tegel
        if (ly >= tile / 2 - 2 && ly <= tile / 2 + 1 && lx > 6 && lx < tile - 6) c = shade(accent, 0.9 + rng.next() * 0.2)
        px(x, y, c)
      }
    }
  }

const tiles =
  (base: RGB, tile = 16): Painter =>
  (px, rng) => {
    const n = valueNoise(rng, 8)
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const lx = x % tile
        const ly = y % tile
        const t = (Math.floor(x / tile) + Math.floor(y / tile)) % 2 ? 0.92 : 1.05
        let c = shade(base, t * (0.8 + n(x, y) * 0.3 + rng.next() * 0.08))
        if (lx === 0 || ly === 0) c = shade(base, 0.5)
        else if (lx === 1 || ly === 1) c = shade(base, 1.2)
        px(x, y, c)
      }
    }
  }

const rock =
  (base: RGB, dark: RGB): Painter =>
  (px, rng) => {
    const big = valueNoise(rng, 4)
    const mid = valueNoise(rng, 8)
    const fine = valueNoise(rng, 32)
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const v = big(x, y) * 0.5 + mid(x, y) * 0.35 + fine(x, y) * 0.15
        const cracks = Math.abs(mid(x, y) - 0.5) < 0.03
        const c: RGB = cracks ? dark : shade(base, 0.55 + v * 0.8)
        px(x, y, c)
      }
    }
  }

const treadPlate =
  (base: RGB): Painter =>
  (px, rng) => {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const d = ((x + y * 2) % 16) - 8
        const bump = Math.abs(d) < 2 && y % 8 < 4
        let c = shade(base, 0.8 + rng.next() * 0.15)
        if (bump) c = shade(base, 1.35)
        if (y % 32 < 3) c = shade(hex(0xd8b020), y % 32 === 0 ? 0.6 : 1)
        px(x, y, c)
      }
    }
  }

const liquid: Painter = (px, rng) => {
  const a = valueNoise(rng, 4)
  const b = valueNoise(rng, 8)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = a(x, y) * 0.6 + b(x, y) * 0.4
      const band = Math.floor(v * 6) / 6
      px(x, y, [40 + band * 90, 150 + band * 105, 20 + band * 40])
    }
  }
}

const door =
  (base: RGB, keyColor: RGB): Painter =>
  (px, rng) => {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        let c = shade(base, 0.85 + rng.next() * 0.12)
        if (x % 16 === 0) c = shade(base, 0.5)
        // gevarenstrepen boven en onder
        if (y < 6 || y > SIZE - 7) c = (x + y) % 12 < 6 ? hex(0xe0c020) : hex(0x202020)
        // gekleurde sleutelstrook in het midden
        if (y > 26 && y < 38 && x > 10 && x < SIZE - 10) c = shade(keyColor, y === 27 || y === 37 ? 0.6 : 1)
        px(x, y, c)
      }
    }
  }

const exitSign: Painter = (px) => {
  const font: Record<string, string[]> = {
    E: ['111', '100', '110', '100', '111'],
    X: ['101', '101', '010', '101', '101'],
    I: ['111', '010', '010', '010', '111'],
    T: ['111', '010', '010', '010', '010'],
  }
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) px(x, y, (x + y) % 8 < 4 ? [30, 30, 30] : [50, 50, 50])
  'EXIT'.split('').forEach((ch, i) => {
    font[ch].forEach((row, ry) =>
      row.split('').forEach((bit, rx) => {
        if (bit !== '1') return
        for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) px(6 + i * 14 + rx * 3 + sx, 24 + ry * 3 + sy, [230, 40, 30])
      }),
    )
  })
}

export type TextureName =
  | 'tech_wall'
  | 'tech_floor'
  | 'tech_ceil'
  | 'brick_wall'
  | 'brick_floor'
  | 'brick_ceil'
  | 'hell_wall'
  | 'hell_floor'
  | 'hell_ceil'
  | 'step'
  | 'liquid'
  | 'door'
  | 'exit'

const PAINTERS: Record<TextureName, Painter> = {
  tech_wall: panels(hex(0x7a7f88), hex(0x3a6fb0)),
  tech_floor: tiles(hex(0x6a6a6a)),
  tech_ceil: panels(hex(0x4c4f55), hex(0xd8d8c0), 16),
  brick_wall: bricks(hex(0x8a5a3a), hex(0x3a3028)),
  brick_floor: tiles(hex(0x6a5038), 32),
  brick_ceil: bricks(hex(0x4a3a2c), hex(0x221a14), 32, 16),
  hell_wall: rock(hex(0x9a3020), hex(0x200806)),
  hell_floor: rock(hex(0x5a2a1c), hex(0x100404)),
  hell_ceil: rock(hex(0x4a1a12), hex(0x080202)),
  step: treadPlate(hex(0x707070)),
  liquid,
  door: door(hex(0x6a6e78), hex(0xd02020)),
  exit: exitSign,
}

let cache: Record<TextureName, THREE.CanvasTexture> | null = null

export function getTextures() {
  if (!cache) {
    cache = Object.fromEntries(
      Object.entries(PAINTERS).map(([name, paint]) => [name, makeTexture(name, paint)]),
    ) as Record<TextureName, THREE.CanvasTexture>
  }
  return cache
}
