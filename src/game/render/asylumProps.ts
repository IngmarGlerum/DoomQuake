import * as THREE from 'three'
import type { Prop } from '../level/types'
import type { Rng } from '../rng'
import type { Builder } from './props'

/**
 * Decor van het gesticht. Lokaal: voorkant = +z (de kamer in), oorsprong = vloer, midden;
 * bij plafondstukken (tv, lamp, cabine) is de oorsprong het plafond.
 */
type XProp = Extract<Prop, { x: number }>

const STEEL = 0xb4b9bc
const DARK_STEEL = 0x5c6266
const SHEET = 0xe6e6de
const ENAMEL = 0xe2e4de
const BLOOD = 0x7a0909

export function asylumProp(b: Builder, rng: Rng, p: XProp) {
  switch (p.kind) {
    case 'bed':
      return bed(b, rng, p.variant)
    case 'ironbed':
      return ironBed(b, rng)
    case 'screen':
      return screen(b, p.variant)
    case 'monitor':
      return monitor(b, p.variant)
    case 'examtable':
      return examTable(b)
    case 'trolley':
      return trolley(b, rng)
    case 'cabinet':
      return cabinet(b, rng)
    case 'mattress':
      return mattress(b, rng)
    case 'pot':
      return pot(b)
    case 'window':
      return windowFrame(b)
    case 'railing':
      return railing(b, p.len ?? 2)
    case 'pod':
      return pod(b)
    case 'wheelchair':
      return wheelchair(b)
    case 'chair':
      return chair(b)
    case 'strip':
      return b.glowBox(p.len ?? 2, 0.045, 0.035, new THREE.Color(0.5, 1.55, 1.45), [0, 0, 0])
    case 'ceillight':
      return ceilLight(b, p.variant === 1)
    case 'blood':
      return blood(b, rng, p.variant, p.len ?? 1)
  }
}

/** Ziekenhuisbed op wieltjes: buisframe, matras, kussen en een verfrommeld laken. */
function bed(b: Builder, rng: Rng, variant: number) {
  for (const x of [-0.42, 0.42]) {
    for (const z of [-0.9, 0.9]) {
      b.cyl(0.022, 0.42, STEEL, [x, 0.27, z])
      b.cyl(0.045, 0.04, 0x222222, [x, 0.045, z], [0, 0, Math.PI / 2])
    }
    b.box(0.04, 0.05, 1.9, STEEL, [x, 0.46, 0])
  }
  b.box(0.88, 0.03, 1.86, DARK_STEEL, [0, 0.47, 0])
  // hoofd- en voeteneinde: buizen
  b.box(0.9, 0.04, 0.04, STEEL, [0, 1.0, -0.95])
  b.box(0.9, 0.04, 0.04, STEEL, [0, 0.78, 0.95])
  for (const x of [-0.42, -0.14, 0.14, 0.42]) {
    b.cyl(0.015, 0.5, STEEL, [x, 0.75, -0.95])
    b.cyl(0.015, 0.3, STEEL, [x, 0.63, 0.95])
  }
  const stained = variant === 2
  b.box(0.84, 0.15, 1.86, stained ? 0xd8d0bc : SHEET, [0, 0.56, 0])
  b.box(0.6, 0.1, 0.34, 0xf0f0ea, [0, 0.68, -0.68], [0.15, 0, 0])
  // verfrommeld laken
  b.box(0.9, 0.06, 0.9, variant === 1 ? 0xc8d4d4 : 0xdcdcd2, [0.04, 0.66, 0.35], [0.05, rng.next() * 0.3 - 0.15, 0.04])
  b.box(0.3, 0.05, 0.6, 0xd4d4ca, [0.36, 0.69, 0.1], [0, 0.4, 0.3])
  if (stained) b.box(0.3, 0.005, 0.35, BLOOD, [0.1, 0.64, 0.1])
  b.collider([0.45, 0.4, 0.97], [0, 0.4, 0])
}

/** Oud ijzeren bed (wit geschilderde buizen), dun matras, kussen. */
function ironBed(b: Builder, rng: Rng) {
  const paint = 0xd2d0c6
  for (const x of [-0.45, 0.45]) {
    b.cyl(0.025, 1.05, paint, [x, 0.525, -0.95])
    b.cyl(0.025, 0.85, paint, [x, 0.425, 0.95])
    b.box(0.03, 0.04, 1.9, paint, [x, 0.42, 0])
  }
  for (const [z, top] of [
    [-0.95, 1.02],
    [0.95, 0.82],
  ] as const) {
    b.box(0.9, 0.035, 0.035, paint, [0, top, z])
    b.box(0.9, 0.03, 0.03, paint, [0, 0.45, z])
    for (const x of [-0.27, -0.09, 0.09, 0.27]) b.cyl(0.01, top - 0.45, paint, [x, (top + 0.45) / 2, z])
  }
  b.box(0.86, 0.02, 1.86, 0x6a6a64, [0, 0.43, 0])
  b.box(0.84, 0.1, 1.84, 0xe0ddd2, [0, 0.49, 0])
  b.box(0.55, 0.12, 0.32, 0xf2f0e8, [0, 0.6, -0.72], [0.18, 0, 0])
  b.box(0.86, 0.05, 1.1, 0xd8d6cc, [0, 0.56, 0.3], [0, rng.next() * 0.1, 0])
  b.collider([0.47, 0.35, 0.97], [0, 0.35, 0])
}

/** Kamerscherm met drie panelen in een zigzag. */
function screen(b: Builder, variant: number) {
  const cloth = [0xe4e6e0, 0xd8e2de, 0xdcd8cc][variant % 3]
  ;[-0.58, 0, 0.58].forEach((x, i) => {
    const r = i === 1 ? 0 : i === 0 ? 0.35 : -0.35
    const zOff = i === 1 ? 0 : 0.1
    b.box(0.56, 1.45, 0.015, cloth, [x, 1.0, zOff], [0, r, 0])
    b.box(0.6, 0.03, 0.03, STEEL, [x, 1.74, zOff], [0, r, 0])
    b.box(0.6, 0.03, 0.03, STEEL, [x, 0.27, zOff], [0, r, 0])
    b.cyl(0.015, 1.7, STEEL, [x - 0.29, 0.85, zOff])
    b.cyl(0.015, 1.7, STEEL, [x + 0.29, 0.85, zOff])
  })
  b.collider([0.88, 0.85, 0.12], [0, 0.85, 0.04])
}

/** Oude tv aan een stang aan het plafond, met een gloeiend scherm. */
function monitor(b: Builder, variant: number) {
  b.cyl(0.02, 0.55, DARK_STEEL, [0, -0.27, 0])
  b.box(0.12, 0.04, 0.12, DARK_STEEL, [0, -0.02, 0])
  b.box(0.58, 0.44, 0.42, 0xcfd2cc, [0, -0.78, 0])
  b.box(0.5, 0.36, 0.02, 0x202020, [0, -0.78, 0.205])
  const glow = [new THREE.Color(1.7, 1.25, 0.65), new THREE.Color(1.45, 1.5, 1.4), new THREE.Color(0.85, 1.25, 1.45)][variant % 3]
  b.glowBox(0.44, 0.31, 0.01, glow, [0, -0.78, 0.218])
}

/** Stalen onderzoekstafel met leren riemen. */
function examTable(b: Builder) {
  b.box(0.82, 0.06, 2.0, 0xd6dada, [0, 0.9, 0])
  b.box(0.76, 0.06, 1.9, 0x8a6e5a, [0, 0.95, 0])
  b.box(0.3, 0.86, 0.3, DARK_STEEL, [0, 0.43, 0])
  b.box(0.7, 0.05, 1.2, DARK_STEEL, [0, 0.03, 0])
  for (const z of [-0.6, 0.1, 0.7]) b.box(0.86, 0.015, 0.07, 0x2e2018, [0, 0.985, z])
  for (const z of [-0.6, 0.1, 0.7]) for (const x of [-0.43, 0.43]) b.box(0.02, 0.06, 0.05, 0x9a9a9a, [x, 0.97, z])
  b.collider([0.42, 0.5, 1.0], [0, 0.5, 0])
}

/** Instrumentenkarretje met schaal en gereedschap. */
function trolley(b: Builder, rng: Rng) {
  for (const x of [-0.24, 0.24]) for (const z of [-0.18, 0.18]) b.cyl(0.012, 0.9, STEEL, [x, 0.45, z])
  for (const y of [0.42, 0.88]) b.box(0.52, 0.02, 0.4, 0xc8cccc, [0, y, 0])
  b.cyl(0.11, 0.05, 0xd8dcdc, [-0.1, 0.92, 0], undefined, 12)
  for (let i = 0; i < 5; i++) b.box(0.14, 0.008, 0.012, 0xe0e4e8, [0.08 + rng.next() * 0.12, 0.895, -0.12 + i * 0.05], [0, rng.next() - 0.5, 0])
  b.box(0.2, 0.06, 0.12, 0xe8e8e0, [0.08, 0.46, 0])
  b.box(0.05, 0.004, 0.04, BLOOD, [0.12, 0.9, 0.08])
  b.collider([0.27, 0.45, 0.22], [0, 0.45, 0])
}

/** Hoge medicijnkast van wit email met glazen deuren en flesjes. */
function cabinet(b: Builder, rng: Rng) {
  b.box(0.8, 1.9, 0.45, ENAMEL, [0, 0.95, 0])
  b.box(0.7, 1.05, 0.02, 0x5c6c6e, [0, 1.3, 0.22])
  b.box(0.7, 0.55, 0.02, 0xd4d6d0, [0, 0.4, 0.22])
  for (const y of [1.0, 1.35, 1.65]) {
    b.box(0.7, 0.015, 0.3, 0xd0d2cc, [0, y, 0.05])
    for (let i = 0; i < 4; i++) {
      if (rng.chance(0.3)) continue
      b.cyl(0.03, 0.13, rng.pick([0x6a4020, 0xe8e8e0, 0x40607a]), [-0.28 + i * 0.18, y + 0.075, 0.1])
    }
  }
  b.box(0.02, 0.12, 0.02, 0x888888, [0.05, 1.3, 0.24])
  b.collider([0.4, 0.95, 0.23], [0, 0.95, 0])
}

/** Matras op de vloer van de isoleercel. */
function mattress(b: Builder, rng: Rng) {
  b.box(0.92, 0.2, 1.95, 0xe0ded4, [0, 0.1, 0])
  b.box(0.6, 0.1, 0.35, 0xf2f0ea, [0, 0.25, -0.72], [0.12, 0.1, 0])
  b.box(0.95, 0.04, 0.9, 0xd8d6cc, [0.05, 0.22, 0.35], [0.04, rng.next() * 0.4 - 0.2, -0.05])
}

/** Emaillen po. */
function pot(b: Builder) {
  const g = new THREE.CylinderGeometry(0.13, 0.11, 0.15, 14, 1, true)
  b.geo(g, 0xeeeee6, [0, 0.075, 0])
  b.cyl(0.11, 0.01, 0xd0d0c8, [0, 0.005, 0], undefined, 14)
  b.geo(new THREE.TorusGeometry(0.135, 0.012, 6, 16), 0x2a3a5a, [0, 0.15, 0], [Math.PI / 2, 0, 0])
  b.geo(new THREE.TorusGeometry(0.05, 0.01, 6, 10, Math.PI), 0xeeeee6, [0.15, 0.09, 0], [0, 0, -Math.PI / 2])
}

/** Hoog raam met een roedeverdeling, open luiken en een vensterbank; het licht valt naar binnen. */
function windowFrame(b: Builder) {
  const z = -0.02
  b.glowBox(1.0, 1.5, 0.01, new THREE.Color(1.55, 1.6, 1.65), [0, 1.75, z])
  const wood = 0xd8d4c8
  for (const x of [-0.5, -0.17, 0.17, 0.5]) b.box(0.04, 1.56, 0.04, wood, [x, 1.75, z + 0.02])
  for (const y of [1.0, 1.375, 1.75, 2.125, 2.5]) b.box(1.04, 0.04, 0.04, wood, [0, y, z + 0.02])
  b.box(1.2, 0.05, 0.2, 0xc8c4b8, [0, 0.97, 0.06])
  // open luiken
  for (const s of [-1, 1]) b.box(0.5, 1.55, 0.03, wood, [s * 0.72, 1.75, 0.16], [0, s * -1.1, 0])
}

/** Reling langs de schacht (met collider, zodat je er niet af valt). */
function railing(b: Builder, len: number) {
  const color = 0x8c9296
  b.box(len, 0.04, 0.04, color, [0, 1.05, 0])
  b.box(len, 0.03, 0.03, color, [0, 0.55, 0])
  b.box(len, 0.08, 0.02, color, [0, 0.04, 0])
  const n = Math.max(1, Math.round(len))
  for (let i = 0; i <= n; i++) b.cyl(0.02, 1.07, color, [-len / 2 + (i * len) / n, 0.535, 0])
  b.collider([len / 2, 0.6, 0.05], [0, 0.6, 0])
}

/** Hangende cabine aan kabels boven de schacht, met oranje lampjes onderaan. */
function pod(b: Builder) {
  const y = -3.7
  for (const x of [-0.15, 0.15]) b.cyl(0.02, 3.0, 0x2a2a2a, [x, -1.5, 0])
  b.box(0.5, 0.1, 0.5, DARK_STEEL, [0, -3.0, 0])
  b.cyl(0.45, 1.3, 0xe0e4e2, [0, y, 0], undefined, 16)
  b.geo(new THREE.SphereGeometry(0.45, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xe0e4e2, [0, y + 0.65, 0])
  b.geo(new THREE.SphereGeometry(0.45, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0xd0d4d2, [0, y - 0.65, 0])
  b.glowBox(0.3, 0.5, 0.02, new THREE.Color(1.5, 1.45, 1.3), [0, y + 0.1, 0.44])
  for (const x of [-0.15, 0.15]) b.glowBox(0.1, 0.1, 0.1, new THREE.Color(2.2, 1.0, 0.25), [x, y - 1.05, 0.1])
}

/** Oude rolstoel. */
function wheelchair(b: Builder) {
  const vinyl = 0x2a2a30
  b.box(0.46, 0.05, 0.44, vinyl, [0, 0.5, 0])
  b.box(0.46, 0.45, 0.04, vinyl, [0, 0.78, -0.22], [-0.12, 0, 0])
  for (const s of [-1, 1]) {
    b.geo(new THREE.TorusGeometry(0.3, 0.02, 6, 20), DARK_STEEL, [s * 0.29, 0.3, -0.05], [0, Math.PI / 2, 0])
    b.cyl(0.006, 0.58, STEEL, [s * 0.29, 0.3, -0.05], [0, 0, Math.PI / 2])
    b.cyl(0.05, 0.03, 0x222222, [s * 0.2, 0.05, 0.28], [0, 0, Math.PI / 2])
    b.box(0.03, 0.03, 0.5, STEEL, [s * 0.24, 0.66, 0.02])
    b.cyl(0.012, 0.5, STEEL, [s * 0.22, 0.95, -0.27], [0.15, 0, 0])
    b.box(0.03, 0.03, 0.12, 0x222222, [s * 0.22, 1.18, -0.33])
  }
  b.box(0.3, 0.02, 0.12, STEEL, [0, 0.12, 0.33])
  b.collider([0.33, 0.45, 0.33], [0, 0.45, 0])
}

function chair(b: Builder) {
  for (const x of [-0.2, 0.2]) for (const z of [-0.2, 0.2]) b.cyl(0.012, 0.45, STEEL, [x, 0.225, z])
  b.box(0.44, 0.04, 0.44, 0x4a5a5a, [0, 0.46, 0])
  b.box(0.44, 0.35, 0.03, 0x4a5a5a, [0, 0.72, -0.21])
}

/** Tl-paneel in het plafond; een kapotte hangt scheef en geeft geen licht. */
function ceilLight(b: Builder, broken: boolean) {
  if (broken) {
    b.box(1.2, 0.06, 0.32, 0x9a9e9c, [0.1, -0.25, 0], [0, 0.2, 0.35])
    b.box(1.1, 0.02, 0.24, 0x3a3e3e, [0.1, -0.28, 0], [0, 0.2, 0.35])
    b.cyl(0.004, 0.3, 0x111111, [-0.45, -0.12, 0])
    return
  }
  b.box(1.2, 0.05, 0.32, 0xb0b4b2, [0, -0.025, 0])
  b.glowBox(1.1, 0.02, 0.24, new THREE.Color(1.45, 1.65, 1.6), [0, -0.055, 0])
}

/** Bloed: een plas, een sleepspoor of een veeg op de muur. */
function blood(b: Builder, rng: Rng, variant: number, size: number) {
  const blob = (r: number, stretch = 1) => {
    const shape = new THREE.Shape()
    const n = 14
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2
      const rr = r * (0.65 + rng.next() * 0.5)
      const x = Math.cos(a) * rr * stretch
      const y = Math.sin(a) * rr
      if (i === 0) shape.moveTo(x, y)
      else shape.lineTo(x, y)
    }
    return new THREE.ShapeGeometry(shape)
  }
  if (variant === 2) {
    // veeg op de muur (achter = -z), met druppels
    b.geo(blob(0.35 * size, 1.6), BLOOD, [0, 1.15, -0.04])
    for (let i = 0; i < 4; i++) b.box(0.025, 0.3 + rng.next() * 0.4, 0.004, BLOOD, [(rng.next() - 0.5) * 0.6 * size, 0.8, -0.04])
    return
  }
  const flat: [number, number, number] = [-Math.PI / 2, 0, 0]
  if (variant === 1) {
    // sleepspoor: een reeks vegen
    for (let i = 0; i < 5; i++) b.geo(blob(0.16 * size, 2.2), BLOOD, [0, 0.012 + i * 0.001, -0.6 * size + i * 0.3 * size], [flat[0], 0, (rng.next() - 0.5) * 0.4])
    return
  }
  b.geo(blob(0.45 * size), BLOOD, [0, 0.012, 0], flat)
  for (let i = 0; i < 5; i++) {
    const a = rng.next() * Math.PI * 2
    const d = 0.5 * size + rng.next() * 0.4 * size
    b.geo(blob(0.06 + rng.next() * 0.06), BLOOD, [Math.cos(a) * d, 0.013, Math.sin(a) * d], flat)
  }
}
