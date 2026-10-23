import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { makeRng, type Rng } from '../rng'
import { heightToNormal } from './beretta'

/**
 * Gelede, geanimeerde wezens voor het grot-level, volledig procedureel opgebouwd:
 * - een skelet van gewrichten (Object3D's) dat in code geanimeerd wordt
 * - organische vormen: spieren als gedraaide profielen, hobbelige blobs, taps toelopende hoorns en klauwen
 * - zelf gegenereerde huid-, stof-, metaal- en hoorntextures met normal maps
 *
 * Coördinaten: meters, oorsprong tussen de voeten, het wezen kijkt naar -z, rechts = +x.
 */
export type CreatureKind = 'mutant' | 'clawbeast'

export interface Rig {
  kind: CreatureKind
  /** positie + kijkrichting in de wereld */
  root: THREE.Group
  /** draait om de voeten (vallen bij de dood) */
  body: THREE.Group
  hips: THREE.Object3D
  spine: THREE.Object3D
  chest: THREE.Object3D
  neck: THREE.Object3D
  head: THREE.Object3D
  jaw: THREE.Object3D
  shoulderL: THREE.Object3D
  elbowL: THREE.Object3D
  shoulderR: THREE.Object3D
  elbowR: THREE.Object3D
  hipL: THREE.Object3D
  kneeL: THREE.Object3D
  ankleL: THREE.Object3D
  hipR: THREE.Object3D
  kneeR: THREE.Object3D
  ankleR: THREE.Object3D
  /** monding van het kanon (mutant) */
  muzzle: THREE.Object3D | null
  flames: THREE.Mesh[]
  /** materialen die met het licht in de wereld meekleuren */
  lit: { mat: THREE.MeshStandardMaterial; base: THREE.Color }[]
  /** rusthoeken van de gewrichten (voor de animatie) */
  rest: Map<THREE.Object3D, THREE.Euler>
}

// ---------- textures ----------

type Paint = (ctx: CanvasRenderingContext2D, h: CanvasRenderingContext2D, size: number, rng: Rng) => void

interface TexSet {
  map: THREE.CanvasTexture
  normal: THREE.CanvasTexture
  emissive?: THREE.CanvasTexture
}

const texCache = new Map<string, TexSet>()

function paintTexture(name: string, size: number, paint: Paint, normalStrength = 3, emissive?: Paint): TexSet {
  const hit = texCache.get(name)
  if (hit) return hit
  const make = () => {
    const c = document.createElement('canvas')
    c.width = c.height = size
    return c
  }
  const color = make()
  const height = make()
  const cx = color.getContext('2d')!
  const hx = height.getContext('2d', { willReadFrequently: true })!
  hx.fillStyle = '#808080'
  hx.fillRect(0, 0, size, size)
  const rng = makeRng(name)
  paint(cx, hx, size, rng)
  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 4
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    return t
  }
  const set: TexSet = { map: tex(color, true), normal: tex(heightToNormal(height, normalStrength), false) }
  if (emissive) {
    const e = make()
    const ex = e.getContext('2d')!
    ex.fillStyle = '#000'
    ex.fillRect(0, 0, size, size)
    emissive(ex, hx, size, rng)
    set.emissive = tex(e, true)
  }
  texCache.set(name, set)
  return set
}

/** Blobs van kleur/hoogte (grove ruis) */
function blotches(ctx: CanvasRenderingContext2D, size: number, rng: Rng, colors: string[], count: number, rMin: number, rMax: number) {
  for (let i = 0; i < count; i++) {
    const x = rng.next() * size
    const y = rng.next() * size
    const r = rMin + rng.next() * (rMax - rMin)
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, rng.pick(colors))
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
}

/** Kronkelende lijn (aders, scheuren) op kleur- en hoogtekaart. */
function squiggle(ctxs: [CanvasRenderingContext2D, string][], size: number, rng: Rng, len: number, width: number) {
  let x = rng.next() * size
  let y = rng.next() * size
  let a = rng.next() * Math.PI * 2
  const pts: [number, number][] = [[x, y]]
  for (let i = 0; i < len; i++) {
    a += (rng.next() - 0.5) * 0.8
    x += Math.cos(a) * 4
    y += Math.sin(a) * 4
    pts.push([x, y])
  }
  for (const [ctx, style] of ctxs) {
    ctx.strokeStyle = style
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.beginPath()
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)))
    ctx.stroke()
  }
}

/** Huid met spiervezels (lengterichting), aders en littekens. */
const skin =
  (base: string, shadow: string, highlight: string, vein: string): Paint =>
  (ctx, h, size, rng) => {
    ctx.fillStyle = base
    ctx.fillRect(0, 0, size, size)
    blotches(ctx, size, rng, [shadow, highlight, shadow], 40, 10, 40)
    // spiervezels: lange lichte en donkere strepen langs v
    for (let i = 0; i < 260; i++) {
      const x = rng.next() * size
      const y = rng.next() * size
      const l = 20 + rng.next() * 60
      const dark = rng.chance(0.5)
      ctx.strokeStyle = dark ? 'rgba(0,0,0,0.18)' : 'rgba(255,230,210,0.12)'
      ctx.lineWidth = 1 + rng.next() * 2
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + (rng.next() - 0.5) * 8, y + l)
      ctx.stroke()
      h.strokeStyle = dark ? 'rgba(40,40,40,0.35)' : 'rgba(220,220,220,0.3)'
      h.lineWidth = ctx.lineWidth + 1
      h.beginPath()
      h.moveTo(x, y)
      h.lineTo(x + (rng.next() - 0.5) * 8, y + l)
      h.stroke()
    }
    // aders (licht verhoogd)
    for (let i = 0; i < 14; i++) squiggle([[ctx, vein], [h, 'rgba(200,200,200,0.8)']], size, rng, 30, 2)
    // poriën
    for (let i = 0; i < 1600; i++) {
      const x = rng.next() * size
      const y = rng.next() * size
      ctx.fillStyle = 'rgba(0,0,0,0.12)'
      ctx.fillRect(x, y, 1, 1)
      h.fillStyle = 'rgba(60,60,60,0.5)'
      h.fillRect(x, y, 1, 1)
    }
  }

const fabric: Paint = (ctx, h, size, rng) => {
  ctx.fillStyle = '#6e4a2c'
  ctx.fillRect(0, 0, size, size)
  blotches(ctx, size, rng, ['rgba(40,24,12,0.5)', 'rgba(140,100,60,0.4)'], 30, 12, 40)
  for (let y = 0; y < size; y += 3) {
    ctx.fillStyle = 'rgba(0,0,0,0.12)'
    ctx.fillRect(0, y, size, 1)
    h.fillStyle = 'rgba(70,70,70,0.6)'
    h.fillRect(0, y, size, 1)
  }
  // vouwen
  for (let i = 0; i < 10; i++) squiggle([[ctx, 'rgba(30,18,8,0.4)'], [h, 'rgba(40,40,40,0.8)']], size, rng, 12, 4)
}

const metal: Paint = (ctx, h, size, rng) => {
  ctx.fillStyle = '#5c6066'
  ctx.fillRect(0, 0, size, size)
  blotches(ctx, size, rng, ['rgba(120,60,30,0.45)', 'rgba(30,30,32,0.5)', 'rgba(150,154,160,0.3)'], 30, 8, 30)
  for (let i = 0; i < 120; i++) {
    const x = rng.next() * size
    const y = rng.next() * size
    ctx.strokeStyle = 'rgba(200,205,210,0.25)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + (rng.next() - 0.5) * 30, y + (rng.next() - 0.5) * 6)
    ctx.stroke()
  }
  for (let y = 0; y < size; y += 32) {
    ctx.fillStyle = '#2a2c30'
    ctx.fillRect(0, y, size, 3)
    h.fillStyle = '#404040'
    h.fillRect(0, y, size, 3)
  }
}

const horn = (base: string): Paint => (ctx, h, size, rng) => {
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  // ringen dwars op de hoorn
  for (let y = 0; y < size; y += 6 + Math.floor(rng.next() * 6)) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fillRect(0, y, size, 2)
    ctx.fillStyle = 'rgba(255,240,220,0.08)'
    ctx.fillRect(0, y + 2, size, 2)
    h.fillStyle = '#3a3a3a'
    h.fillRect(0, y, size, 2)
  }
  blotches(ctx, size, rng, ['rgba(255,230,200,0.08)', 'rgba(0,0,0,0.3)'], 20, 10, 30)
}

/** Verkoolde huid met gloeiende scheuren (emissive). */
const charred: Paint = (ctx, h, size, rng) => {
  ctx.fillStyle = '#2a1812'
  ctx.fillRect(0, 0, size, size)
  blotches(ctx, size, rng, ['rgba(80,40,24,0.6)', 'rgba(10,6,4,0.6)'], 40, 10, 40)
  for (let i = 0; i < 20; i++) squiggle([[ctx, 'rgba(140,40,10,0.9)'], [h, 'rgba(40,40,40,1)']], size, rng, 22, 3)
}
const charredGlow: Paint = (ctx, _h, size, rng) => {
  for (let i = 0; i < 20; i++) squiggle([[ctx, 'rgba(255,120,30,1)']], size, rng, 22, 2)
}

// ---------- geometrie ----------

/** Spier/ledemaat als gedraaid profiel van y=0 naar y=-len, met bolling in het midden. */
function limb(r1: number, r2: number, len: number, bulge: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0.001, r1 * 0.5)]
  const n = 12
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const r = r1 + (r2 - r1) * t + bulge * Math.sin(Math.PI * t)
    pts.push(new THREE.Vector2(r, -len * t))
  }
  pts.push(new THREE.Vector2(0.001, -len - r2 * 0.5))
  const g = new THREE.LatheGeometry(pts, 14)
  g.computeVertexNormals()
  return g
}

/** Organische blob: bol met hobbels, niet-uniform geschaald. */
function blob(rx: number, ry: number, rz: number, lumps = 0.06, seed = 1): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 20, 14)
  const p = g.getAttribute('position') as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const n = Math.sin(v.x * 5.1 + seed) * Math.sin(v.y * 4.3 + seed * 2) * Math.sin(v.z * 6.7 + seed * 3)
    v.multiplyScalar(1 + n * lumps)
    p.setXYZ(i, v.x * rx, v.y * ry, v.z * rz)
  }
  g.computeVertexNormals()
  return g
}

/** Taps toelopende buis langs een curve (hoorns, klauwen, kabels). */
function taper(points: [number, number, number][], r0: number, r1: number, segments = 24, radial = 10): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)))
  const g = new THREE.TubeGeometry(curve, segments, 1, radial, false)
  const p = g.getAttribute('position') as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i <= segments; i++) {
    const c = curve.getPointAt(i / segments)
    const r = r0 + (r1 - r0) * Math.pow(i / segments, 0.8)
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j
      v.fromBufferAttribute(p, k).sub(c).multiplyScalar(r).add(c)
      p.setXYZ(k, v.x, v.y, v.z)
    }
  }
  g.computeVertexNormals()
  return g
}

type Mat = THREE.Material

/** Verzamelt onderdelen per gewricht en voegt ze per materiaal samen (minder draw calls). */
class Joint {
  node: THREE.Object3D
  parts = new Map<Mat, THREE.BufferGeometry[]>()
  constructor(name: string, parent: THREE.Object3D | null, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0]) {
    this.node = new THREE.Object3D()
    this.node.name = name
    this.node.position.set(...pos)
    this.node.rotation.set(...rot)
    parent?.add(this.node)
  }
  add(geo: THREE.BufferGeometry, mat: Mat, pos: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0], scale = 1) {
    const g = geo.index ? geo : geo
    g.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(...pos),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
        new THREE.Vector3(scale, scale, scale),
      ),
    )
    // alles naar dezelfde attributenset brengen
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name)
    const list = this.parts.get(mat) ?? []
    list.push(g.index ? g.toNonIndexed() : g)
    this.parts.set(mat, list)
    return this
  }
  finish() {
    for (const [mat, geos] of this.parts) {
      const merged = mergeGeometries(geos, false)
      if (!merged) continue
      const mesh = new THREE.Mesh(merged, mat)
      mesh.name = `${this.node.name}-mesh`
      this.node.add(mesh)
    }
  }
}

function standard(tex: TexSet, opts: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normal, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.65, ...opts })
}

const glowMat = (r: number, g: number, b: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false })

// ---------- de mutant ----------

function buildMutant(): THREE.Group {
  const skinTex = paintTexture('mutant-skin', 256, skin('#b98c66', 'rgba(90,50,30,0.55)', 'rgba(230,190,150,0.35)', 'rgba(110,50,40,0.55)'))
  const skinMat = standard(skinTex, { roughness: 0.6 })
  const pants = standard(paintTexture('mutant-pants', 128, fabric), { roughness: 0.92 })
  const steel = standard(paintTexture('mutant-metal', 128, metal), { roughness: 0.45, metalness: 0.45 })
  const hornMat = standard(paintTexture('mutant-horn', 128, horn('#3a302a')), { roughness: 0.4 })
  const bone = new THREE.MeshStandardMaterial({ color: 0xd8c8a0, roughness: 0.5 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x1e1a18, roughness: 0.8 })
  const cable = new THREE.MeshStandardMaterial({ color: 0x8a1810, roughness: 0.5 })
  const eyes = glowMat(2.2, 1.2, 0.2)
  const muzzleGlow = glowMat(2.4, 1.0, 0.2)

  const group = new THREE.Group()
  const body = new THREE.Group()
  body.name = 'body'
  group.add(body)

  const hips = new Joint('hips', body, [0, 1.12, 0])
  hips.add(blob(0.36, 0.24, 0.27, 0.05, 2), pants, [0, 0.02, 0])
  hips.add(new THREE.CylinderGeometry(0.38, 0.37, 0.09, 18), dark, [0, 0.16, 0])
  hips.add(new THREE.BoxGeometry(0.16, 0.12, 0.05), steel, [0, 0.16, -0.36])
  // flarden vlees aan de riem (zoals bij de referentie)
  for (let i = 0; i < 7; i++) {
    const x = -0.24 + i * 0.08
    hips.add(limb(0.025, 0.012, 0.14 + (i % 3) * 0.05, 0.005), cable, [x, 0.12, -0.33 + Math.abs(x) * 0.1], [0.15, 0, 0])
  }

  // benen: links vlees + broek, rechts mechanisch
  const hipL = new Joint('hipL', hips.node, [-0.2, -0.04, 0])
  hipL.add(limb(0.18, 0.13, 0.5, 0.035), pants)
  const kneeL = new Joint('kneeL', hipL.node, [0, -0.5, 0])
  kneeL.add(limb(0.13, 0.1, 0.46, 0.02), pants)
  const ankleL = new Joint('ankleL', kneeL.node, [0, -0.48, 0])
  ankleL.add(blob(0.13, 0.09, 0.2, 0.03, 3), dark, [0, -0.05, -0.07])

  const hipR = new Joint('hipR', hips.node, [0.2, -0.04, 0])
  hipR.add(limb(0.18, 0.13, 0.5, 0.035), pants)
  const kneeR = new Joint('kneeR', hipR.node, [0, -0.5, 0])
  kneeR.add(new THREE.CylinderGeometry(0.09, 0.07, 0.46, 12), steel, [0, -0.23, 0])
  kneeR.add(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 8), steel, [0.08, -0.22, 0.05])
  kneeR.add(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 8), steel, [-0.08, -0.22, 0.05])
  kneeR.add(new THREE.SphereGeometry(0.1, 12, 8), steel, [0, 0, 0])
  kneeR.add(taper([[0.06, -0.05, 0.05], [0.12, -0.2, 0.08], [0.05, -0.4, 0.06]], 0.018, 0.012, 10, 6), cable)
  const ankleR = new Joint('ankleR', kneeR.node, [0, -0.48, 0])
  ankleR.add(new THREE.BoxGeometry(0.22, 0.1, 0.34), steel, [0, -0.05, -0.06])
  ankleR.add(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 10), dark, [0, 0.02, 0], [Math.PI / 2, 0, 0])

  // romp
  const spine = new Joint('spine', hips.node, [0, 0.15, 0])
  spine.add(blob(0.31, 0.26, 0.25, 0.04, 4), skinMat, [0, 0.12, 0])
  // buikspieren
  for (let r = 0; r < 3; r++) for (const s of [-1, 1]) spine.add(blob(0.075, 0.06, 0.05, 0.05, r + s), skinMat, [s * 0.075, 0.03 + r * 0.11, -0.21])

  const chest = new Joint('chest', spine.node, [0, 0.32, 0])
  chest.add(blob(0.52, 0.36, 0.33, 0.05, 5), skinMat, [0, 0.2, 0])
  for (const s of [-1, 1]) {
    chest.add(blob(0.21, 0.15, 0.11, 0.06, 6 + s), skinMat, [s * 0.16, 0.27, -0.25]) // borst
    chest.add(blob(0.19, 0.13, 0.15, 0.05, 8 + s), skinMat, [s * 0.21, 0.5, 0.04]) // trapezius
    chest.add(blob(0.16, 0.26, 0.18, 0.05, 9 + s), skinMat, [s * 0.36, 0.12, 0.03]) // lats
  }
  // rode kabels van de kanonarm naar de rug
  chest.add(taper([[-0.5, 0.42, 0.05], [-0.35, 0.55, 0.22], [-0.05, 0.4, 0.3], [0.15, 0.1, 0.26]], 0.03, 0.022, 20, 6), cable)
  chest.add(taper([[-0.52, 0.35, 0.1], [-0.42, 0.2, 0.3], [-0.2, -0.05, 0.28]], 0.025, 0.02, 16, 6), cable)

  const neck = new Joint('neck', chest.node, [0, 0.55, -0.03])
  neck.add(blob(0.15, 0.13, 0.15, 0.04, 11), skinMat, [0, 0.05, 0])

  // stierachtige kop met hoorns
  const head = new Joint('head', neck.node, [0, 0.13, -0.04])
  head.add(blob(0.2, 0.21, 0.22, 0.05, 12), skinMat, [0, 0.12, 0])
  head.add(blob(0.13, 0.11, 0.16, 0.05, 13), skinMat, [0, 0.04, -0.17])
  head.add(blob(0.21, 0.05, 0.08, 0.05, 14), skinMat, [0, 0.18, -0.14])
  head.add(new THREE.SphereGeometry(0.022, 8, 6), dark, [-0.045, 0.03, -0.32])
  head.add(new THREE.SphereGeometry(0.022, 8, 6), dark, [0.045, 0.03, -0.32])
  head.add(new THREE.SphereGeometry(0.03, 10, 8), eyes, [-0.085, 0.15, -0.2])
  head.add(new THREE.SphereGeometry(0.03, 10, 8), eyes, [0.085, 0.15, -0.2])
  for (const s of [-1, 1]) {
    head.add(taper([[s * 0.15, 0.22, 0], [s * 0.3, 0.3, 0.03], [s * 0.42, 0.45, -0.04], [s * 0.45, 0.6, -0.14]], 0.055, 0.008), hornMat)
    head.add(blob(0.05, 0.08, 0.03, 0.04, 15), skinMat, [s * 0.2, 0.1, 0.02], [0, 0, s * 0.6])
  }
  const jaw = new Joint('jaw', head.node, [0, 0.0, -0.06])
  jaw.add(blob(0.12, 0.05, 0.13, 0.04, 16), skinMat, [0, -0.03, -0.08])
  for (let i = 0; i < 6; i++) jaw.add(new THREE.ConeGeometry(0.012, 0.04, 5), bone, [-0.06 + i * 0.024, 0.02, -0.18])

  // rechterarm: vlees met klauwhand
  const shoulderR = new Joint('shoulderR', chest.node, [0.52, 0.42, 0])
  shoulderR.add(blob(0.18, 0.16, 0.18, 0.05, 17), skinMat)
  shoulderR.add(limb(0.15, 0.11, 0.42, 0.035), skinMat, [0, -0.05, 0])
  const elbowR = new Joint('elbowR', shoulderR.node, [0, -0.46, 0])
  elbowR.add(limb(0.12, 0.09, 0.4, 0.03), skinMat)
  elbowR.add(blob(0.09, 0.1, 0.07, 0.05, 18), skinMat, [0, -0.46, 0])
  for (let i = 0; i < 4; i++) {
    const x = -0.045 + i * 0.03
    elbowR.add(taper([[x, -0.52, -0.02], [x, -0.6, -0.05], [x, -0.64, -0.1]], 0.016, 0.003, 8, 6), bone)
  }

  // linkerarm: kanon
  const shoulderL = new Joint('shoulderL', chest.node, [-0.52, 0.42, 0])
  shoulderL.add(blob(0.18, 0.16, 0.18, 0.05, 19), skinMat)
  shoulderL.add(blob(0.2, 0.12, 0.2, 0.03, 20), steel, [0, 0.08, 0])
  shoulderL.add(limb(0.15, 0.12, 0.38, 0.03), skinMat, [0, -0.05, 0])
  const elbowL = new Joint('elbowL', shoulderL.node, [0, -0.43, 0])
  elbowL.add(new THREE.CylinderGeometry(0.16, 0.13, 0.12, 14), steel, [0, -0.02, 0])
  elbowL.add(new THREE.CylinderGeometry(0.12, 0.12, 0.72, 16), steel, [0, -0.42, 0])
  for (let i = 0; i < 4; i++) elbowL.add(new THREE.CylinderGeometry(0.135, 0.135, 0.04, 16), dark, [0, -0.15 - i * 0.16, 0])
  elbowL.add(new THREE.CylinderGeometry(0.14, 0.12, 0.08, 16), dark, [0, -0.8, 0])
  elbowL.add(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 14), muzzleGlow, [0, -0.845, 0])
  elbowL.add(taper([[0.12, -0.2, 0.05], [0.2, -0.05, 0.12], [0.12, 0.25, 0.15]], 0.035, 0.03, 12, 6), cable)
  const muzzle = new THREE.Object3D()
  muzzle.name = 'muzzle'
  muzzle.position.set(0, -0.9, 0)
  elbowL.node.add(muzzle)

  for (const j of [hips, hipL, kneeL, ankleL, hipR, kneeR, ankleR, spine, chest, neck, head, jaw, shoulderR, elbowR, shoulderL, elbowL]) j.finish()
  // rusthouding: armen iets naar buiten, kanon licht naar voren
  shoulderR.node.rotation.set(0.1, 0, 0.18)
  elbowR.node.rotation.set(0.35, 0, 0)
  shoulderL.node.rotation.set(0.15, 0, -0.16)
  elbowL.node.rotation.set(0.5, 0, 0)
  return group
}

// ---------- het klauwbeest ----------

function buildClawbeast(): THREE.Group {
  const fleshTex = paintTexture('claw-skin', 256, skin('#b89aa6', 'rgba(70,30,60,0.55)', 'rgba(240,220,230,0.35)', 'rgba(90,20,60,0.7)'))
  const flesh = standard(fleshTex, { roughness: 0.55 })
  const headTex = paintTexture('claw-head', 256, charred, 3, charredGlow)
  const headMat = standard(headTex, { roughness: 0.7, emissiveMap: headTex.emissive, emissive: new THREE.Color(1.8, 0.7, 0.2) })
  const hornMat = standard(paintTexture('claw-horn', 128, horn('#161210')), { roughness: 0.3 })
  const bone = new THREE.MeshStandardMaterial({ color: 0xe0cc90, roughness: 0.4 })
  const eyes = glowMat(2.6, 1.6, 0.4)
  const maw = glowMat(2.6, 1.0, 0.15)

  const group = new THREE.Group()
  const body = new THREE.Group()
  body.name = 'body'
  group.add(body)

  const hips = new Joint('hips', body, [0, 1.38, 0])
  hips.add(blob(0.36, 0.26, 0.3, 0.06, 2), flesh)

  // digitigrade poten met lange klauwtenen
  const legs: Joint[] = []
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R'
    const hip = new Joint(`hip${side}`, hips.node, [s * 0.26, -0.05, 0])
    hip.add(limb(0.21, 0.14, 0.62, 0.06), flesh)
    const knee = new Joint(`knee${side}`, hip.node, [0, -0.62, 0])
    knee.add(limb(0.13, 0.09, 0.56, 0.03), flesh)
    const ankle = new Joint(`ankle${side}`, knee.node, [0, -0.56, 0])
    ankle.add(limb(0.09, 0.07, 0.3, 0.02), flesh)
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.07
      ankle.add(taper([[x, -0.3, -0.02], [x * 1.4, -0.34, -0.14], [x * 1.6, -0.36, -0.28]], 0.035, 0.004, 10, 8), bone)
    }
    ankle.add(taper([[0, -0.26, 0.04], [0, -0.3, 0.12]], 0.025, 0.004, 6, 6), bone)
    legs.push(hip, knee, ankle)
  }

  const spine = new Joint('spine', hips.node, [0, 0.14, 0])
  spine.add(blob(0.32, 0.3, 0.28, 0.05, 3), flesh, [0, 0.15, 0])
  const chest = new Joint('chest', spine.node, [0, 0.4, 0])
  chest.add(blob(0.62, 0.42, 0.44, 0.06, 4), flesh, [0, 0.25, 0])
  for (const s of [-1, 1]) {
    chest.add(blob(0.26, 0.2, 0.25, 0.06, 5 + s), flesh, [s * 0.46, 0.5, 0.06])
    chest.add(blob(0.22, 0.16, 0.12, 0.06, 7 + s), flesh, [s * 0.18, 0.3, -0.34])
  }
  // botstekels over de rug
  for (let i = 0; i < 5; i++) chest.add(new THREE.ConeGeometry(0.04, 0.16, 6), bone, [0, 0.55 - i * 0.14, 0.36 + i * 0.02], [1.2, 0, 0])

  const neck = new Joint('neck', chest.node, [0, 0.62, -0.2])
  neck.add(blob(0.18, 0.18, 0.18, 0.05, 9), flesh, [0, 0.06, 0])

  // kop: verkoolde schedel met uilachtig gezicht, gloeiende ogen en muil, ramshoorns en vlammen
  const head = new Joint('head', neck.node, [0, 0.2, -0.08])
  head.add(blob(0.25, 0.25, 0.28, 0.07, 10), headMat, [0, 0.06, 0])
  for (const s of [-1, 1]) {
    head.add(blob(0.13, 0.045, 0.09, 0.05, 11 + s), headMat, [s * 0.1, 0.14, -0.22], [0, 0, s * 0.4])
    head.add(new THREE.SphereGeometry(0.045, 12, 10), eyes, [s * 0.095, 0.07, -0.24])
    head.add(
      taper([[s * 0.19, 0.12, 0.02], [s * 0.44, 0.25, 0.12], [s * 0.7, 0.18, 0.12], [s * 0.84, -0.05, 0.0], [s * 0.8, -0.28, -0.18], [s * 0.63, -0.38, -0.3]], 0.11, 0.015, 32, 12),
      hornMat,
    )
  }
  head.add(new THREE.ConeGeometry(0.05, 0.16, 6), headMat, [0, -0.02, -0.29], [-2.6, 0, 0])
  head.add(new THREE.SphereGeometry(0.085, 12, 10), maw, [0, -0.1, -0.18])
  const jaw = new Joint('jaw', head.node, [0, -0.06, -0.06])
  jaw.add(blob(0.15, 0.06, 0.16, 0.05, 13), headMat, [0, -0.06, -0.1])
  for (let i = 0; i < 7; i++) jaw.add(new THREE.ConeGeometry(0.014, 0.06, 5), bone, [-0.09 + i * 0.03, -0.01, -0.22])

  // lange armen met enorme klauwen
  const arms: Joint[] = []
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R'
    const shoulder = new Joint(`shoulder${side}`, chest.node, [s * 0.58, 0.42, 0.02])
    shoulder.add(limb(0.17, 0.12, 0.72, 0.06), flesh)
    const elbow = new Joint(`elbow${side}`, shoulder.node, [0, -0.72, 0])
    elbow.add(limb(0.13, 0.1, 0.62, 0.05), flesh)
    elbow.add(blob(0.12, 0.1, 0.09, 0.05, 14 + s), flesh, [0, -0.66, 0])
    for (let i = 0; i < 4; i++) {
      const x = -0.075 + i * 0.05
      elbow.add(taper([[x, -0.72, -0.02], [x * 1.3, -0.9, -0.1], [x * 1.4, -1.02, -0.26]], 0.035, 0.004, 12, 8), bone)
    }
    arms.push(shoulder, elbow)
  }

  // vlammende manen: kegels met additief licht, worden geanimeerd
  const fire = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.9, 0.2), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  const flames = new THREE.Group()
  flames.name = 'flames'
  for (let i = 0; i < 9; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.09 + (i % 3) * 0.03, 0.42 + (i % 4) * 0.08, 8), fire)
    f.name = 'flame'
    const a = (i / 8 - 0.5) * 2.2
    f.position.set(Math.sin(a) * 0.18, 0.3 + Math.cos(a) * 0.06, 0.06 + Math.abs(a) * 0.05)
    f.rotation.set(-0.6 + Math.abs(a) * 0.2, 0, -a * 0.5)
    flames.add(f)
  }
  head.node.add(flames)

  for (const j of [hips, ...legs, spine, chest, neck, head, jaw, ...arms]) j.finish()

  // rusthouding: gebogen, voorovergebogen, armen hangend naar voren
  const get = (n: string) => group.getObjectByName(n)!
  for (const s of ['L', 'R']) {
    get(`hip${s}`).rotation.set(0.35, 0, 0)
    get(`knee${s}`).rotation.set(-0.95, 0, 0)
    get(`ankle${s}`).rotation.set(0.62, 0, 0)
    get(`shoulder${s}`).rotation.set(0.25, 0, s === 'L' ? -0.18 : 0.18)
    get(`elbow${s}`).rotation.set(0.45, 0, 0)
  }
  get('spine').rotation.set(-0.42, 0, 0)
  get('neck').rotation.set(0.4, 0, 0)
  return group
}

// ---------- instanties ----------

const templates = new Map<CreatureKind, THREE.Group>()

export function createCreature(kind: CreatureKind, variant: number): Rig {
  let tpl = templates.get(kind)
  if (!tpl) {
    tpl = kind === 'mutant' ? buildMutant() : buildClawbeast()
    templates.set(kind, tpl)
  }
  const root = new THREE.Group()
  const model = tpl.clone(true)
  root.add(model)

  // eigen materialen per exemplaar, zodat ze met het licht op hun plek kunnen meekleuren
  const lit: Rig['lit'] = []
  const cloned = new Map<THREE.Material, THREE.Material>()
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const m = o.material as THREE.Material
    if (!(m instanceof THREE.MeshStandardMaterial)) return
    let c = cloned.get(m) as THREE.MeshStandardMaterial | undefined
    if (!c) {
      c = m.clone()
      // variant: de mutant bestaat ook in een roodbruine versie (zoals bij de referentie)
      if (kind === 'mutant' && variant % 2 === 1 && c.map?.image && (c.map.image as HTMLCanvasElement).width === 256) c.color.setRGB(1.15, 0.55, 0.48)
      cloned.set(m, c)
      lit.push({ mat: c, base: c.color.clone() })
    }
    o.material = c
  })

  // schaduwvlek onder de voeten (draait niet mee bij het vallen)
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(kind === 'clawbeast' ? 0.95 : 0.65, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.02
  root.add(shadow)

  const get = (n: string) => model.getObjectByName(n)!
  const rig: Rig = {
    kind,
    root,
    body: get('body') as THREE.Group,
    hips: get('hips'),
    spine: get('spine'),
    chest: get('chest'),
    neck: get('neck'),
    head: get('head'),
    jaw: get('jaw'),
    shoulderL: get('shoulderL'),
    elbowL: get('elbowL'),
    shoulderR: get('shoulderR'),
    elbowR: get('elbowR'),
    hipL: get('hipL'),
    kneeL: get('kneeL'),
    ankleL: get('ankleL'),
    hipR: get('hipR'),
    kneeR: get('kneeR'),
    ankleR: get('ankleR'),
    muzzle: model.getObjectByName('muzzle') ?? null,
    flames: [],
    lit,
    rest: new Map(),
  }
  model.getObjectByName('flames')?.children.forEach((f) => rig.flames.push(f as THREE.Mesh))
  for (const j of [rig.hips, rig.spine, rig.chest, rig.neck, rig.head, rig.jaw, rig.shoulderL, rig.elbowL, rig.shoulderR, rig.elbowR, rig.hipL, rig.kneeL, rig.ankleL, rig.hipR, rig.kneeR, rig.ankleR]) {
    rig.rest.set(j, j.rotation.clone())
  }
  rig.root.userData.restHipsY = rig.hips.position.y
  return rig
}

// ---------- animatie ----------

export interface CreatureAnim {
  phase: number
  walk: number
  last: THREE.Vector3
  stepSide: number
}

export interface CreaturePose {
  state: 'idle' | 'chase' | 'attack' | 'pain' | 'dead'
  stateTime: number
  windup: number
  fired: boolean
  /** werkelijke loopsnelheid (m/s) */
  speed: number
  maxSpeed: number
  hitFlash: number
}

const ease = (k: number) => k * k * (3 - 2 * k)

/**
 * Zet alle gewrichten voor dit frame: looppas, ademhaling, aanval, pijn en dood.
 * Geeft `true` terug op het moment dat een voet de grond raakt (voor voetstappen).
 */
export function animateCreature(rig: Rig, a: CreatureAnim, p: CreaturePose, t: number, dt: number): boolean {
  const r = (j: THREE.Object3D) => rig.rest.get(j)!
  const set = (j: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const e = r(j)
    j.rotation.set(e.x + x, e.y + y, e.z + z)
  }
  const claw = rig.kind === 'clawbeast'

  // looppas: fase loopt mee met de werkelijke snelheid
  const targetWalk = p.state === 'dead' ? 0 : Math.min(1, p.speed / Math.max(0.1, p.maxSpeed * 0.6))
  a.walk += (targetWalk - a.walk) * Math.min(1, dt * 6)
  const before = a.phase
  a.phase += dt * p.speed * (claw ? 1.9 : 2.5)
  const w = a.walk
  const s = Math.sin(a.phase)
  const c = Math.cos(a.phase)
  const stepped = Math.floor(before / Math.PI) !== Math.floor(a.phase / Math.PI) && w > 0.3

  const legSwing = claw ? 0.42 : 0.55
  set(rig.hipL, s * legSwing * w)
  set(rig.hipR, -s * legSwing * w)
  set(rig.kneeL, -Math.max(0, -c) * (claw ? 0.6 : 0.95) * w)
  set(rig.kneeR, -Math.max(0, c) * (claw ? 0.6 : 0.95) * w)
  set(rig.ankleL, Math.max(0, -c) * 0.35 * w)
  set(rig.ankleR, Math.max(0, c) * 0.35 * w)

  const restY = rig.root.userData.restHipsY as number
  rig.hips.position.y = restY + Math.abs(s) * (claw ? 0.07 : 0.05) * w - (claw ? 0.04 : 0.02) * w
  set(rig.hips, 0, 0, s * 0.05 * w)
  set(rig.spine, 0, s * 0.12 * w, 0)

  // ademhaling
  const breath = Math.sin(t * (claw ? 1.4 : 1.9)) * 0.02
  rig.chest.scale.setScalar(1 + breath)
  set(rig.chest, breath)

  // armen zwaaien tegengesteld aan de benen
  set(rig.shoulderR, -s * (claw ? 0.35 : 0.45) * w)
  set(rig.elbowR, Math.max(0, s) * 0.3 * w)
  set(rig.shoulderL, s * (claw ? 0.35 : 0.15) * w)
  set(rig.elbowL, claw ? Math.max(0, -s) * 0.3 * w : 0)

  // kop: zoekt rond als hij stilstaat, wiegt mee bij het lopen
  set(rig.neck, claw ? Math.sin(t * 0.7) * 0.06 : 0)
  set(rig.head, Math.sin(t * 0.9) * 0.05, Math.sin(t * 0.5) * 0.25 * (1 - w) + s * 0.08 * w)
  set(rig.jaw, (claw ? 0.12 : 0.05) + Math.max(0, Math.sin(t * 1.3)) * 0.06)

  // aanval
  if (p.state === 'attack') {
    const k = ease(Math.min(1, p.stateTime / p.windup))
    const after = Math.max(0, p.stateTime - p.windup)
    if (!claw) {
      // kanon heffen en richten, terugslag bij het schot
      const recoil = p.fired ? Math.exp(-after * 9) : 0
      set(rig.shoulderL, k * 1.45 - recoil * 0.45, 0, k * 0.15)
      set(rig.elbowL, -k * 0.5 + recoil * 0.2)
      set(rig.spine, -recoil * 0.15, -k * 0.25)
      set(rig.head, 0, -k * 0.2)
      set(rig.jaw, 0.05 + k * 0.25)
    } else if (!p.fired) {
      // uithalen: rechterklauw hoog en naar achteren, romp draait mee, muil open
      set(rig.shoulderR, k * 2.5, 0, k * 0.35)
      set(rig.elbowR, k * 0.9)
      set(rig.spine, k * 0.12, k * 0.35)
      set(rig.head, -k * 0.25)
      set(rig.jaw, 0.12 + k * 0.45)
    } else {
      // de klap: snel schuin naar beneden, daarna terug
      const swing = Math.min(1, after / 0.12)
      const back = Math.min(1, Math.max(0, (after - 0.12) / 0.3))
      set(rig.shoulderR, (2.5 - swing * 2.2) * (1 - back), 0, 0.35 * (1 - swing))
      set(rig.elbowR, 0.9 * (1 - swing) * (1 - back))
      set(rig.spine, 0.1 * (1 - back), (0.35 - swing * 0.7) * (1 - back))
      set(rig.jaw, 0.5 * (1 - back) + 0.12)
    }
  }

  // pijn: schok naar achteren
  if (p.state === 'pain') {
    const k = 1 - Math.min(1, p.stateTime / 0.3)
    set(rig.spine, -0.3 * k, 0, 0.12 * k)
    set(rig.head, -0.4 * k)
    set(rig.jaw, 0.4 * k)
  }

  // dood: knieën knikken, dan valt hij om (mutant achterover, klauwbeest voorover)
  rig.body.rotation.set(0, 0, 0)
  rig.body.position.set(0, 0, 0)
  if (p.state === 'dead') {
    const k = Math.min(1, p.stateTime / 0.9)
    const kn = Math.min(1, p.stateTime / 0.35)
    set(rig.kneeL, -kn * 1.1)
    set(rig.kneeR, -kn * 0.9)
    set(rig.shoulderR, -kn * 0.6)
    set(rig.shoulderL, -kn * 0.4)
    set(rig.head, claw ? 0.3 : -0.5)
    set(rig.jaw, 0.5)
    rig.hips.position.y = restY - kn * 0.25
    const fall = ease(k) * (Math.PI / 2) * 0.92
    rig.body.rotation.x = claw ? -fall : fall
    rig.body.position.y = -ease(k) * 0.15
  }

  // vlammen flakkeren
  rig.flames.forEach((f, i) => {
    const flick = 0.75 + 0.35 * Math.sin(t * (11 + i * 1.7) + i) + 0.15 * Math.sin(t * 23 + i * 3)
    f.scale.set(1, p.state === 'dead' ? Math.max(0.05, 1 - p.stateTime) : flick, 1)
  })

  // geraakt: kort oplichten
  for (const l of rig.lit) l.mat.emissiveIntensity = 1
  if (p.hitFlash > 0) for (const l of rig.lit) if (!l.mat.emissiveMap) l.mat.emissive.setScalar(p.hitFlash * 0.5)
  else for (const l of rig.lit) if (!l.mat.emissiveMap) l.mat.emissive.setScalar(0)

  return stepped
}

/** Laat het wezen meekleuren met het licht in de wereld op zijn plek. */
export function tintCreature(rig: Rig, light: [number, number, number]) {
  for (const l of rig.lit) {
    l.mat.color.setRGB(
      l.base.r * Math.min(1.7, 0.32 + light[0] * 1.15),
      l.base.g * Math.min(1.7, 0.32 + light[1] * 1.15),
      l.base.b * Math.min(1.7, 0.32 + light[2] * 1.15),
    )
  }
}
