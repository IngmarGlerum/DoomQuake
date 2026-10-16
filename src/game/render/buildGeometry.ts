import * as THREE from 'three'
import { CELL, MAX_STEP, type Cell, type Level } from '../level/types'
import type { Lighting, RGB } from './lighting'
import type { TextureName } from './textures'

type V3 = [number, number, number]

interface Bucket {
  pos: number[]
  uv: number[]
  col: number[]
  idx: number[]
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/**
 * Zet het grid om naar meshes, één per texture. Elke open cel tekent zijn vloer,
 * plafond en de wanden die hij "ziet": volle muren naar massieve buren, en trede-
 * of bovenwanden naar buren met een andere vloer- of plafondhoogte.
 */
export function buildLevelGeometry(level: Level, lighting: Lighting): Map<TextureName, THREE.BufferGeometry> {
  const { width, height, cells } = level
  const buckets = new Map<TextureName, Bucket>()
  const bucket = (name: TextureName) => {
    let b = buckets.get(name)
    if (!b) buckets.set(name, (b = { pos: [], uv: [], col: [], idx: [] }))
    return b
  }
  const color: RGB = [0, 0, 0]

  const quad = (name: TextureName, corners: V3[], uvs: [number, number][], normal: V3) => {
    // zorg dat de driehoeken met de voorkant naar de normaal wijzen
    if (dot(cross(sub(corners[1], corners[0]), sub(corners[2], corners[0])), normal) < 0) {
      corners = [...corners].reverse()
      uvs = [...uvs].reverse()
    }
    const b = bucket(name)
    const base = b.pos.length / 3
    corners.forEach((p, i) => {
      b.pos.push(p[0], p[1], p[2])
      b.uv.push(uvs[i][0], uvs[i][1])
      lighting.sample(p[0] + normal[0] * 0.05, p[1] + normal[1] * 0.05, p[2] + normal[2] * 0.05, normal, color)
      b.col.push(color[0], color[1], color[2])
    })
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  /** Verticale wand langs rand (a → b), opgeknipt in stukken van max één cel hoog voor nettere belichting. */
  const wall = (name: TextureName, a: [number, number], b: [number, number], y0: number, y1: number, normal: V3) => {
    if (y1 - y0 < 1e-3) return
    const alongX = a[1] === b[1]
    const ua = (alongX ? a[0] : a[1]) / CELL
    const ub = (alongX ? b[0] : b[1]) / CELL
    for (let lo = y0; lo < y1 - 1e-6; ) {
      const hi = Math.min(y1, (Math.floor(lo / CELL + 1e-6) + 1) * CELL)
      quad(
        name,
        [
          [a[0], lo, a[1]],
          [b[0], lo, b[1]],
          [b[0], hi, b[1]],
          [a[0], hi, a[1]],
        ],
        [
          [ua, lo / CELL],
          [ub, lo / CELL],
          [ub, hi / CELL],
          [ua, hi / CELL],
        ],
        normal,
      )
      lo = hi
    }
  }

  const SOLID: Cell = { solid: true, floor: 0, ceil: 0, room: -1, corridor: -1, path: false, liquid: false, door: false, theme: 'tech' }
  const get = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? SOLID : cells[y * width + x])

  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const c = cells[cy * width + cx]
      if (c.solid) continue
      const x0 = cx * CELL
      const x1 = x0 + CELL
      const z0 = cy * CELL
      const z1 = z0 + CELL
      const wallTex = `${c.theme}_wall` as TextureName

      const flat = (y: number): V3[] => [
        [x0, y, z0],
        [x1, y, z0],
        [x1, y, z1],
        [x0, y, z1],
      ]
      const flatUv: [number, number][] = [
        [x0 / CELL, z0 / CELL],
        [x1 / CELL, z0 / CELL],
        [x1 / CELL, z1 / CELL],
        [x0 / CELL, z1 / CELL],
      ]
      quad(c.liquid ? 'liquid' : (`${c.theme}_floor` as TextureName), flat(c.floor), flatUv, [0, 1, 0])
      quad(`${c.theme}_ceil` as TextureName, flat(c.ceil), flatUv, [0, -1, 0])

      const sides: { n: Cell; a: [number, number]; b: [number, number]; normal: V3 }[] = [
        { n: get(cx + 1, cy), a: [x1, z0], b: [x1, z1], normal: [-1, 0, 0] },
        { n: get(cx - 1, cy), a: [x0, z0], b: [x0, z1], normal: [1, 0, 0] },
        { n: get(cx, cy + 1), a: [x0, z1], b: [x1, z1], normal: [0, 0, -1] },
        { n: get(cx, cy - 1), a: [x0, z0], b: [x1, z0], normal: [0, 0, 1] },
      ]
      for (const { n, a, b, normal } of sides) {
        if (n.solid) {
          wall(wallTex, a, b, c.floor, c.ceil, normal)
          continue
        }
        if (n.floor > c.floor) {
          const top = Math.min(n.floor, c.ceil)
          wall(n.floor - c.floor <= MAX_STEP + 1e-6 ? 'step' : wallTex, a, b, c.floor, top, normal)
        }
        if (n.ceil < c.ceil) wall(wallTex, a, b, Math.max(n.ceil, c.floor), c.ceil, normal)
      }
    }
  }

  const out = new Map<TextureName, THREE.BufferGeometry>()
  for (const [name, b] of buckets) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3))
    g.setIndex(b.idx)
    g.computeBoundingSphere()
    out.set(name, g)
  }
  return out
}
