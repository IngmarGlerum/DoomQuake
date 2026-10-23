import * as THREE from 'three'
import { makeRng, type Rng } from '../rng'
import { CELL, type Level, type Prop } from '../level/types'
import type { Lighting, RGB } from './lighting'
import { shaded } from './models'

/**
 * Bouwt al het decor van de grotbasis:
 * - één samengevoegde mesh met vertexkleuren en ingebakken belichting (kasten, kooien, pijpen...)
 * - een "glow"-mesh voor lampen die zelf licht geven
 * - schermen met een geanimeerde terminaltextuur
 * - knipperende ledjes (serverkasten, schakelborden, consoles)
 * - colliders voor de grote stukken
 */
export interface LedSpec {
  pos: THREE.Vector3
  color: THREE.Color
  /** knipperfrequentie in Hz (0 = brandt continu) */
  rate: number
  phase: number
  /** fractie van de tijd dat hij aan is */
  duty: number
}

export interface ColliderSpec {
  pos: [number, number, number]
  half: [number, number, number]
  rot: number
}

export interface PropBuild {
  solid: THREE.BufferGeometry | null
  glow: THREE.BufferGeometry | null
  screens: THREE.BufferGeometry | null
  leds: LedSpec[]
  colliders: ColliderSpec[]
}

type V3 = [number, number, number]

const LED_COLORS = [0x30ff60, 0x30ff60, 0x30ff60, 0xffb020, 0x40a0ff, 0xff3020]

class Builder {
  solid: THREE.BufferGeometry[] = []
  glow: THREE.BufferGeometry[] = []
  screens: THREE.BufferGeometry[] = []
  leds: LedSpec[] = []
  colliders: ColliderSpec[] = []
  /** transformatie van het huidige decorstuk (lokaal → wereld) */
  m = new THREE.Matrix4()
  rot = 0

  begin(x: number, y: number, z: number, rot: number) {
    this.m.makeRotationY(rot).setPosition(x, y, z)
    this.rot = rot
  }

  private place(geo: THREE.BufferGeometry, pos: V3, rot?: V3) {
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot ?? [0, 0, 0]))),
      new THREE.Vector3(1, 1, 1),
    )
    geo.applyMatrix4(local)
    geo.applyMatrix4(this.m)
    return geo
  }

  box(w: number, h: number, d: number, color: number, pos: V3, rot?: V3) {
    this.solid.push(this.place(shaded(new THREE.BoxGeometry(w, h, d), color), pos, rot))
  }

  cyl(r: number, h: number, color: number, pos: V3, rot?: V3, segments = 8) {
    this.solid.push(this.place(shaded(new THREE.CylinderGeometry(r, r, h, segments), color), pos, rot))
  }

  /** Staaf tussen twee lokale punten. */
  rod(a: V3, b: V3, r: number, color: number) {
    const va = new THREE.Vector3(...a)
    const vb = new THREE.Vector3(...b)
    const dir = vb.clone().sub(va)
    const len = dir.length()
    const g = new THREE.CylinderGeometry(r, r, len, 6)
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()))
    g.translate((va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2)
    this.solid.push(this.place(shaded(g, color), [0, 0, 0]))
  }

  glowBox(w: number, h: number, d: number, color: THREE.Color, pos: V3) {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed()
    const n = g.getAttribute('position').count
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) col.set([color.r, color.g, color.b], i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    this.glow.push(this.place(g, pos))
  }

  /** Scherm (vlak, kijkt naar lokaal +z) met een eigen stukje van de terminaltextuur. */
  screen(w: number, h: number, pos: V3, rot: V3 | undefined, rng: Rng) {
    const g = new THREE.PlaneGeometry(w, h)
    const uv = g.getAttribute('uv') as THREE.BufferAttribute
    const u0 = rng.next() * 0.6
    const v0 = rng.next()
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.4, v0 + uv.getY(i) * 0.5)
    this.screens.push(this.place(g, pos, rot))
  }

  led(pos: V3, rng: Rng, steady = false) {
    const p = new THREE.Vector3(...pos).applyMatrix4(this.m)
    this.leds.push({
      pos: p,
      color: new THREE.Color(rng.pick(LED_COLORS)),
      rate: steady || rng.chance(0.35) ? 0 : 0.5 + rng.next() * 9,
      phase: rng.next(),
      duty: 0.3 + rng.next() * 0.5,
    })
  }

  collider(half: V3, pos: V3) {
    const p = new THREE.Vector3(...pos).applyMatrix4(this.m)
    this.colliders.push({ pos: [p.x, p.y, p.z], half, rot: this.rot })
  }
}

// ---------- decorstukken (lokaal: voorkant = +z, oorsprong = vloer, midden) ----------

function rack(b: Builder, rng: Rng, variant: number) {
  const body = [0x22252a, 0x1c2026, 0x2a2a2e, 0x202830][variant % 4]
  for (const k of [-0.46, 0.46]) {
    b.box(0.88, 2.2, 1.0, body, [k, 1.1, 0])
    b.box(0.8, 2.06, 0.04, 0x14161a, [k, 1.1, 0.51])
    b.box(0.82, 0.03, 0.9, 0x0e0e10, [k, 2.215, 0])
    for (let u = 0; u < 10; u++) {
      const y = 0.32 + u * 0.18
      b.box(0.72, 0.13, 0.03, u % 2 ? 0x30353c : 0x272b31, [k, y, 0.53])
      const n = rng.int(2, 5)
      for (let j = 0; j < n; j++) b.led([k - 0.3 + j * 0.055, y + 0.025, 0.552], rng)
    }
    b.box(0.02, 0.45, 0.03, 0x808890, [k + 0.36, 1.2, 0.54])
  }
  b.collider([0.92, 1.1, 0.5], [0, 1.1, 0])
}

function terminal(b: Builder, rng: Rng) {
  b.box(1.2, 0.75, 0.6, 0x3a3f46, [0, 0.375, -0.05])
  b.box(1.22, 0.06, 0.46, 0x2c3036, [0, 0.82, 0.08], [-0.35, 0, 0])
  b.box(0.62, 0.03, 0.18, 0x1a1c20, [0, 0.86, 0.14], [-0.35, 0, 0])
  for (let j = 0; j < 5; j++) b.led([-0.45 + j * 0.05, 0.86, 0.02], rng)
  for (let j = 0; j < 4; j++) b.led([0.36 + (j % 2) * 0.06, 0.85 + Math.floor(j / 2) * 0.03, 0.04], rng)
  b.box(0.1, 0.3, 0.1, 0x202328, [0, 0.98, -0.24])
  b.box(0.82, 0.62, 0.12, 0x25282d, [0, 1.3, -0.24], [-0.12, 0, 0])
  b.screen(0.7, 0.5, [0, 1.3, -0.172], [-0.12, 0, 0], rng)
  b.collider([0.62, 0.62, 0.36], [0, 0.62, -0.05])
}

function switchboard(b: Builder, rng: Rng, ceilAbove: number) {
  b.box(1.5, 1.7, 0.22, 0x4a5048, [0, 1.3, 0])
  b.box(1.44, 1.64, 0.02, 0x3c4238, [0, 1.3, 0.115])
  // schakelaars
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      const x = -0.55 + c * 0.16
      const y = 0.75 + r * 0.2
      b.box(0.07, 0.1, 0.02, 0x16181a, [x, y, 0.13])
      b.box(0.02, 0.06, 0.05, 0xb8bcc0, [x, y + (rng.chance(0.5) ? 0.02 : -0.02), 0.16], [rng.chance(0.5) ? 0.5 : -0.5, 0, 0])
    }
  }
  // meters
  for (let i = 0; i < 3; i++) {
    b.cyl(0.075, 0.03, 0x1a1a1a, [0.25 + i * 0.18, 1.88, 0.125], [Math.PI / 2, 0, 0], 12)
    b.cyl(0.06, 0.035, 0xd8d4c0, [0.25 + i * 0.18, 1.88, 0.13], [Math.PI / 2, 0, 0], 12)
    b.box(0.006, 0.05, 0.005, 0xc02010, [0.25 + i * 0.18, 1.89, 0.15], [0, 0, rng.next() * 2 - 1])
  }
  b.box(0.3, 0.12, 0.005, 0xe0b818, [0.55, 2.02, 0.126])
  for (let j = 0; j < 8; j++) b.led([-0.6 + j * 0.09, 2.05, 0.13], rng)
  b.screen(0.42, 0.26, [-0.42, 1.9, 0.127], undefined, rng)
  // leiding naar het plafond
  const top = 2.15
  const h = Math.max(0.1, ceilAbove - top)
  b.cyl(0.05, h, 0x5a5e62, [0.6, top + h / 2, -0.02])
  b.cyl(0.035, h, 0x2a2a2a, [-0.6, top + h / 2, -0.02])
}

function cage(b: Builder, rng: Rng) {
  const s = 0.86
  const frame = 0x3a3d40
  const bar = 0x5c6064
  b.box(1.8, 0.08, 1.8, 0x2a2c2e, [0, 0.04, 0])
  for (const [x, z] of [
    [-s, -s],
    [s, -s],
    [-s, s],
    [s, s],
  ]) {
    b.box(0.09, 2.2, 0.09, frame, [x, 1.1, z])
  }
  b.box(1.8, 0.08, 0.09, frame, [0, 2.2, -s])
  b.box(1.8, 0.08, 0.09, frame, [0, 2.2, s])
  b.box(0.09, 0.08, 1.8, frame, [-s, 2.2, 0])
  b.box(0.09, 0.08, 1.8, frame, [s, 2.2, 0])
  // achterkant en zijkanten: rechte tralies
  for (let t = -0.72; t <= 0.73; t += 0.16) {
    b.rod([t, 0.08, -s], [t, 2.16, -s], 0.022, bar)
    b.rod([-s, 0.08, t], [-s, 2.16, t], 0.022, bar)
    b.rod([s, 0.08, t], [s, 2.16, t], 0.022, bar)
  }
  // voorkant: opengewrongen. Middelste tralies buigen naar buiten en opzij, één is afgebroken.
  for (let t = -0.72; t <= 0.73; t += 0.16) {
    const mid = Math.abs(t) < 0.3
    if (!mid) {
      b.rod([t, 0.08, s], [t, 2.16, s], 0.022, bar)
      continue
    }
    if (Math.abs(t) < 0.05 && rng.chance(0.7)) {
      // afgebroken: stompjes onder en boven
      b.rod([t, 0.08, s], [t + 0.04, 0.55, s + 0.12], 0.022, bar)
      b.rod([t, 2.16, s], [t - 0.03, 1.75, s + 0.1], 0.022, bar)
      continue
    }
    const side = t < 0 ? -1 : 1
    const bend = 0.32 + rng.next() * 0.12
    const out = 0.35 + rng.next() * 0.2
    const p1: V3 = [t, 0.08, s]
    const p2: V3 = [t + side * bend * 0.6, 0.7, s + out * 0.7]
    const p3: V3 = [t + side * bend, 1.25, s + out]
    const p4: V3 = [t + side * bend * 0.5, 1.8, s + out * 0.5]
    const p5: V3 = [t, 2.16, s]
    b.rod(p1, p2, 0.022, bar)
    b.rod(p2, p3, 0.022, bar)
    b.rod(p3, p4, 0.022, bar)
    b.rod(p4, p5, 0.022, bar)
  }
  // vieze vlek op de bodem en krassen
  b.box(1.3, 0.01, 1.2, 0x2c3a18, [0, 0.085, -0.05])
  b.box(0.5, 0.012, 0.35, 0x4a0e0a, [0.2, 0.087, 0.15])
  for (let i = 0; i < 3; i++) b.box(0.02, 0.6, 0.012, 0x1a1a1a, [-0.4 + i * 0.08, 1.2, -s + 0.04], [0, 0, 0.3])
  // waarschuwingsbord
  b.box(0.45, 0.22, 0.02, 0xe0b818, [0, 2.0, s + 0.03])
  b.box(0.3, 0.06, 0.022, 0x111111, [0, 2.0, s + 0.035])
  // colliders: achter en zijkanten (voorkant is open)
  b.collider([0.9, 1.1, 0.06], [0, 1.1, -s])
  b.collider([0.06, 1.1, 0.9], [-s, 1.1, 0])
  b.collider([0.06, 1.1, 0.9], [s, 1.1, 0])
}

function crate(b: Builder, rng: Rng, variant: number) {
  const metal = variant % 2 === 1
  const body = metal ? 0x4a5560 : 0x6a5030
  const edge = metal ? 0x2c333a : 0x3e2c18
  const one = (size: number, pos: V3, yaw: number) => {
    b.box(size, size, size, body, pos, [0, yaw, 0])
    const e = size * 0.08
    for (const [dx, dz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const off = new THREE.Vector3(dx * (size / 2 - e / 2), 0, dz * (size / 2 - e / 2)).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      b.box(e * 1.1, size * 1.01, e * 1.1, edge, [pos[0] + off.x, pos[1], pos[2] + off.z], [0, yaw, 0])
    }
    if (metal) b.box(size * 1.01, size * 0.1, size * 1.01, 0xd0a818, [pos[0], pos[1] + size * 0.25, pos[2]], [0, yaw, 0])
  }
  one(1.0, [0, 0.5, 0], 0)
  b.collider([0.5, 0.5, 0.5], [0, 0.5, 0])
  if (variant >= 1) {
    const yaw = (rng.next() - 0.5) * 0.6
    one(0.75, [0.05, 1.375, 0.02], yaw)
    b.collider([0.38, 0.38, 0.38], [0.05, 1.375, 0.02])
  }
}

function lamp(b: Builder) {
  // hangt aan het plafond: prop.y = plafondhoogte
  b.cyl(0.015, 0.22, 0x222222, [0, -0.11, 0])
  b.box(0.55, 0.1, 0.26, 0x26282a, [0, -0.26, 0])
  b.glowBox(0.44, 0.05, 0.16, new THREE.Color(2.2, 1.7, 0.95), [0, -0.33, 0])
  for (const x of [-0.18, 0, 0.18]) b.box(0.012, 0.012, 0.22, 0x111111, [x, -0.37, 0])
}

/** Pijp of kabel langs een reeks punten (wereld), met flenzen/beugels. */
function tube(b: Builder, p: Extract<Prop, { points: unknown }>) {
  b.begin(0, 0, 0, 0)
  const pts = p.points.map((q) => new THREE.Vector3(...q))
  if (pts.length < 2) return
  const curve: THREE.Curve<THREE.Vector3> =
    pts.length === 2 ? new THREE.LineCurve3(pts[0], pts[1]) : new THREE.CatmullRomCurve3(pts, false, 'catmullrom', p.kind === 'cable' ? 0.5 : 0.2)
  const length = curve.getLength()
  const segments = Math.max(2, Math.ceil(length / (p.kind === 'cable' ? 0.35 : 0.6)))
  b.solid.push(shaded(new THREE.TubeGeometry(curve, segments, p.radius, 6, false), p.color))

  // flenzen (pijp) of beugels (kabel) om de zoveel meter
  const every = p.kind === 'pipe' ? 3.2 : 2.6
  const count = Math.floor(length / every)
  for (let i = 1; i <= count; i++) {
    const t = Math.min(1, (i * every) / length)
    const pos = curve.getPointAt(t)
    const tan = curve.getTangentAt(t)
    if (p.kind === 'pipe') {
      const g = shaded(new THREE.CylinderGeometry(p.radius * 1.35, p.radius * 1.35, 0.07, 8), 0x2a2a2a)
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan))
      g.translate(pos.x, pos.y, pos.z)
      b.solid.push(g)
    }
    const bracket = shaded(new THREE.BoxGeometry(0.06, 0.32, 0.06), 0x202020)
    bracket.translate(pos.x, pos.y + p.radius + 0.16, pos.z)
    b.solid.push(bracket)
  }
}

/** Voeg geometrieën met dezelfde attributen samen tot één buffer. */
function mergeGeometries(geos: THREE.BufferGeometry[], withUv: boolean): THREE.BufferGeometry | null {
  if (!geos.length) return null
  const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g))
  const total = flat.reduce((n, g) => n + g.getAttribute('position').count, 0)
  const pos = new Float32Array(total * 3)
  const col = withUv ? null : new Float32Array(total * 3)
  const uv = withUv ? new Float32Array(total * 2) : null
  let o = 0
  for (const g of flat) {
    const n = g.getAttribute('position').count
    pos.set(g.getAttribute('position').array as Float32Array, o * 3)
    if (col) col.set(g.getAttribute('color').array as Float32Array, o * 3)
    if (uv) uv.set(g.getAttribute('uv').array as Float32Array, o * 2)
    o += n
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3))
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  out.computeBoundingSphere()
  return out
}

export function buildProps(level: Level, lighting: Lighting): PropBuild {
  const b = new Builder()
  const rng = makeRng(`props:${level.seed}`)
  const ceilAt = (x: number, z: number) => {
    const cx = Math.floor(x / CELL)
    const cz = Math.floor(z / CELL)
    return level.cells[cz * level.width + cx]?.ceil ?? 4
  }

  for (const p of level.props ?? []) {
    if ('points' in p) {
      tube(b, p)
      continue
    }
    b.begin(p.x, p.y, p.z, p.rot)
    if (p.kind === 'rack') rack(b, rng, p.variant)
    else if (p.kind === 'terminal') terminal(b, rng)
    else if (p.kind === 'switchboard') switchboard(b, rng, ceilAt(p.x, p.z) - p.y)
    else if (p.kind === 'cage') cage(b, rng)
    else if (p.kind === 'crate') crate(b, rng, p.variant)
    else if (p.kind === 'lamp') lamp(b)
  }

  // ingebakken belichting op de vertexkleuren (zelfde licht als de muren)
  const solid = mergeGeometries(b.solid, false)
  if (solid) {
    const pos = solid.getAttribute('position')
    const col = solid.getAttribute('color')
    const light: RGB = [0, 0, 0]
    for (let i = 0; i < pos.count; i++) {
      lighting.sample(pos.getX(i), pos.getY(i), pos.getZ(i), undefined, light)
      col.setXYZ(i, col.getX(i) * (light[0] + 0.06), col.getY(i) * (light[1] + 0.06), col.getZ(i) * (light[2] + 0.06))
    }
  }

  return {
    solid,
    glow: mergeGeometries(b.glow, false),
    screens: mergeGeometries(b.screens, true),
    leds: b.leds,
    colliders: b.colliders,
  }
}
