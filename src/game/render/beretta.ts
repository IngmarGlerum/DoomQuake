import * as THREE from 'three'
import { makeRng } from '../rng'

/**
 * Beretta 92FS-achtig pistool, opgebouwd uit geëxtrudeerde zijprofielen (in millimeters)
 * met afgeronde randen, procedurele textures en normal maps voor reliëf:
 * gestraald staal, kartels achter op de slede, gravures, geruite grippanelen.
 *
 * Coördinaten van de profielen: u = van achterkant slede richting loop, v = omhoog (0 = bovenkant slede).
 * Na opbouw wijst de loop naar -z, staat de linkerkant (met gravure) richting -x.
 */
export const BERETTA_SCALE = 0.0016

type P = [number, number]

/** Polygon met afgeronde hoeken als THREE.Shape. */
function roundedShape(points: P[], radius: number | number[]): THREE.Shape {
  const shape = new THREE.Shape()
  const n = points.length
  const r = (i: number) => (Array.isArray(radius) ? radius[i] : radius)
  const corner = (i: number) => {
    const [px, py] = points[(i - 1 + n) % n]
    const [cx, cy] = points[i]
    const [nx, ny] = points[(i + 1) % n]
    const l1 = Math.hypot(cx - px, cy - py)
    const l2 = Math.hypot(nx - cx, ny - cy)
    const rr = Math.min(r(i), l1 / 2, l2 / 2)
    return {
      a: [cx + ((px - cx) / l1) * rr, cy + ((py - cy) / l1) * rr] as P,
      c: [cx, cy] as P,
      b: [cx + ((nx - cx) / l2) * rr, cy + ((ny - cy) / l2) * rr] as P,
    }
  }
  const first = corner(0)
  shape.moveTo(...first.a)
  shape.quadraticCurveTo(...first.c, ...first.b)
  for (let i = 1; i < n; i++) {
    const k = corner(i)
    shape.lineTo(...k.a)
    shape.quadraticCurveTo(...k.c, ...k.b)
  }
  shape.closePath()
  return shape
}

function roundedPath(points: P[], radius: number): THREE.Path {
  const s = roundedShape(points, radius)
  const p = new THREE.Path()
  p.curves = s.curves
  return p
}

/** Extrudeer een zijprofiel tot een plaat met dikte (mm), gecentreerd en gedraaid naar wapen-oriëntatie. */
function plate(shape: THREE.Shape, thickness: number, bevel = 0.9, xOffset = 0): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.1, thickness - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.85,
    bevelSegments: 3,
    curveSegments: 10,
  })
  g.translate(0, 0, -(thickness - bevel * 2) / 2)
  g.rotateY(Math.PI / 2) // u → -z, dikte → x
  g.translate(xOffset, 0, 0)
  g.computeVertexNormals()
  return g
}

/** Cilinder langs de loop-as (u), in mm. */
function tube(radius: number, u0: number, u1: number, v: number, segments = 20): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, u1 - u0, segments, 1)
  g.rotateX(Math.PI / 2)
  g.translate(0, v, -(u0 + u1) / 2)
  return g
}

// ---------- textures ----------

interface SideTex {
  map: THREE.CanvasTexture
  normal: THREE.CanvasTexture
  rough: THREE.CanvasTexture
}

/**
 * Tekenoppervlak voor een zijkant: (u, v) in mm → canvas-pixels. Links in het canvas is de loop
 * (zo lezen gravures op de linkerkant van het wapen gewoon van links naar rechts).
 */
function sideCanvas(u0: number, u1: number, v0: number, v1: number, ppm: number) {
  const w = Math.round((u1 - u0) * ppm)
  const h = Math.round((v1 - v0) * ppm)
  const make = () => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  const color = make()
  const height = make()
  const rough = make()
  return {
    w,
    h,
    color,
    height,
    rough,
    cx: color.getContext('2d', { willReadFrequently: true })!,
    hx: height.getContext('2d', { willReadFrequently: true })!,
    rx: rough.getContext('2d', { willReadFrequently: true })!,
    X: (u: number) => (u1 - u) * ppm,
    Y: (v: number) => (v1 - v) * ppm,
    S: (mm: number) => mm * ppm,
    finish(): SideTex {
      const toTex = (c: HTMLCanvasElement, srgb: boolean) => {
        const t = new THREE.CanvasTexture(c)
        t.repeat.set(-1 / (u1 - u0), 1 / (v1 - v0))
        t.offset.set(u1 / (u1 - u0), -v0 / (v1 - v0))
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
        t.anisotropy = 4
        if (srgb) t.colorSpace = THREE.SRGBColorSpace
        return t
      }
      return { map: toTex(color, true), normal: toTex(heightToNormal(height, 3.2), false), rough: toTex(rough, false) }
    },
  }
}

/** Hoogtekaart (grijswaarden) → tangent-space normal map. */
export function heightToNormal(src: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const { width: w, height: h } = src
  const data = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  const img = ctx.createImageData(w, h)
  const H = (x: number, y: number) => data[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4] / 255
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // canvas-y loopt omlaag, textuur-v omhoog (flipY)
      let nx = -(H(x + 1, y) - H(x - 1, y)) * strength
      let ny = (H(x, y + 1) - H(x, y - 1)) * strength
      let nz = 1
      const l = Math.hypot(nx, ny, nz)
      nx /= l
      ny /= l
      nz /= l
      const i = (y * w + x) * 4
      img.data[i] = (nx * 0.5 + 0.5) * 255
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return out
}

/** Fijne korrel (gestraald oppervlak) op kleur-, hoogte- en ruwheidskaart. */
function grain(c: ReturnType<typeof sideCanvas>, base: [number, number, number], amount: number, seed: string) {
  const rng = makeRng(seed)
  for (const [ctx, kind] of [
    [c.cx, 'color'],
    [c.hx, 'height'],
    [c.rx, 'rough'],
  ] as const) {
    const img = ctx.getImageData(0, 0, c.w, c.h)
    for (let i = 0; i < img.data.length; i += 4) {
      const n = rng.next() - 0.5
      // lichte machinaal-gefreesde strepen in de lengterichting
      const row = Math.floor(i / 4 / c.w)
      const streak = Math.sin(row * 0.9) * 0.5 + Math.sin(row * 2.7 + 1) * 0.3
      if (kind === 'color') {
        const f = 1 + n * amount + streak * amount * 0.25
        img.data[i] = base[0] * f
        img.data[i + 1] = base[1] * f
        img.data[i + 2] = base[2] * f
      } else if (kind === 'height') {
        const v = 128 + n * 10
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      } else {
        // ruwheid in het groene kanaal (three leest G)
        const v = 120 + n * 30
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      }
      img.data[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  }
}

function slideTextures(): SideTex {
  const c = sideCanvas(-8, 222, -30, 6, 6)
  grain(c, [43, 45, 49], 0.18, 'slide')

  // kartels achter op de slede: diepe verticale gleuven
  for (let u = 6; u < 36; u += 3.1) {
    const x = c.X(u)
    const w = c.S(1.35)
    const y0 = c.Y(-1.5)
    const y1 = c.Y(-22)
    c.cx.fillStyle = '#121315'
    c.cx.fillRect(x - w, y0, w, y1 - y0)
    c.cx.fillStyle = 'rgba(120,124,132,0.35)'
    c.cx.fillRect(x - w - c.S(0.35), y0, c.S(0.3), y1 - y0)
    c.hx.fillStyle = '#2a2a2a'
    c.hx.fillRect(x - w, y0, w, y1 - y0)
    c.rx.fillStyle = '#c0c0c0'
    c.rx.fillRect(x - w, y0, w, y1 - y0)
  }

  // gravures (lichter, dieper)
  const engrave = (text: string, u: number, v: number, size: number, weight = 'bold') => {
    for (const [ctx, style] of [
      [c.cx, '#7a7e86'],
      [c.hx, '#3c3c3c'],
      [c.rx, '#e0e0e0'],
    ] as const) {
      ctx.font = `${weight} ${c.S(size)}px "Arial Narrow", Arial, sans-serif`
      ctx.textBaseline = 'middle'
      ctx.fillStyle = style
      ctx.fillText(text, c.X(u), c.Y(v))
    }
  }
  engrave('PIETRO BERETTA GARDONE V.T.', 168, -15.5, 3.4)
  engrave('MOD. 92FS - CAL. 9mm Parabellum', 160, -20.2, 2.6, 'normal')
  engrave('MADE IN ITALY', 205, -19.5, 2.2, 'normal')

  // slijtage aan de bovenrand (lichter staal waar de holster schuurt)
  const wear = c.cx.createLinearGradient(0, c.Y(1), 0, c.Y(-3))
  wear.addColorStop(0, 'rgba(150,154,160,0.35)')
  wear.addColorStop(1, 'rgba(150,154,160,0)')
  c.cx.fillStyle = wear
  c.cx.fillRect(0, c.Y(1), c.w, c.Y(-3) - c.Y(1))
  return c.finish()
}

function frameTextures(): SideTex {
  const c = sideCanvas(-22, 210, -142, -18, 5)
  grain(c, [38, 40, 43], 0.16, 'frame')
  // serienummer op de dust cover
  for (const [ctx, style] of [
    [c.cx, '#6c7078'],
    [c.hx, '#4a4a4a'],
  ] as const) {
    ctx.font = `bold ${c.S(2.6)}px "Arial Narrow", Arial, sans-serif`
    ctx.textBaseline = 'middle'
    ctx.fillStyle = style
    ctx.fillText('BER 427915Z', c.X(192), c.Y(-31))
    ctx.fillText('PB', c.X(60), c.Y(-30))
  }
  // fijne gleufjes op de voorkant van de trekkerbeugel
  for (let v = -44; v > -62; v -= 1.6) {
    c.cx.fillStyle = '#18191b'
    c.cx.fillRect(c.X(156), c.Y(v), c.S(6), c.S(0.6))
    c.hx.fillStyle = '#404040'
    c.hx.fillRect(c.X(156), c.Y(v), c.S(6), c.S(0.6))
  }
  return c.finish()
}

function gripTextures(): SideTex {
  const c = sideCanvas(-6, 86, -136, -40, 7)
  const rng = makeRng('grip')
  // basis: zwart kunststof
  for (const [ctx, col] of [
    [c.cx, '#1b1b1c'],
    [c.hx, '#808080'],
    [c.rx, '#d0d0d0'],
  ] as const) {
    ctx.fillStyle = col
    ctx.fillRect(0, 0, c.w, c.h)
  }
  // ruitjespatroon (checkering): kleine piramides in een gedraaid raster
  const pitch = c.S(1.7)
  const img = c.hx.getImageData(0, 0, c.w, c.h)
  const col = c.cx.getImageData(0, 0, c.w, c.h)
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const a = ((x + y) / pitch) % 1
      const b = ((x - y + 10000) / pitch) % 1
      const d = Math.min(Math.abs(a - 0.5), Math.abs(b - 0.5)) * 2 // 0 = groef, 1 = top
      const hgt = 70 + d * 120 + (rng.next() - 0.5) * 8
      const i = (y * c.w + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = hgt
      const shade = 18 + d * 22
      col.data[i] = col.data[i + 1] = col.data[i + 2] = shade
    }
  }
  c.hx.putImageData(img, 0, 0)
  c.cx.putImageData(col, 0, 0)

  // gladde rand rond het ruitjesveld
  const border = (ctx: CanvasRenderingContext2D, style: string) => {
    ctx.strokeStyle = style
    ctx.lineWidth = c.S(3.2)
    ctx.beginPath()
    const pts: P[] = [
      [0, -47],
      [79, -49],
      [77, -58],
      [61, -125],
      [57, -129],
      [16, -129],
      [10, -125],
      [4, -100],
      [-1, -62],
    ]
    pts.forEach(([u, v], i) => (i ? ctx.lineTo(c.X(u), c.Y(v)) : ctx.moveTo(c.X(u), c.Y(v))))
    ctx.closePath()
    ctx.stroke()
  }
  border(c.cx, '#202022')
  border(c.hx, '#a8a8a8')

  // medaillon met Beretta-logo
  const med = (ctx: CanvasRenderingContext2D, fill: string, ring: string) => {
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.ellipse(c.X(38), c.Y(-66), c.S(7.5), c.S(6), 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = ring
    ctx.lineWidth = c.S(1)
    ctx.stroke()
  }
  med(c.cx, '#8a8e94', '#c8ccd2')
  med(c.hx, '#b0b0b0', '#d8d8d8')
  for (const [ctx, style] of [
    [c.cx, '#2a2c30'],
    [c.hx, '#707070'],
  ] as const) {
    ctx.font = `bold ${c.S(5.5)}px Georgia, serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = style
    ctx.fillText('PB', c.X(38), c.Y(-66.3))
  }
  c.rx.fillStyle = '#5a5a5a'
  c.rx.beginPath()
  c.rx.ellipse(c.X(38), c.Y(-66), c.S(7.5), c.S(6), 0, 0, Math.PI * 2)
  c.rx.fill()

  // schroeven boven en onder
  for (const [u, v] of [
    [40, -53],
    [33, -121],
  ]) {
    for (const [ctx, fill, slot] of [
      [c.cx, '#5e626a', '#1a1b1d'],
      [c.hx, '#c8c8c8', '#505050'],
    ] as const) {
      ctx.fillStyle = fill
      ctx.beginPath()
      ctx.arc(c.X(u), c.Y(v), c.S(2.8), 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = slot
      ctx.save()
      ctx.translate(c.X(u), c.Y(v))
      ctx.rotate(0.6)
      ctx.fillRect(-c.S(2.4), -c.S(0.4), c.S(4.8), c.S(0.8))
      ctx.restore()
    }
    c.rx.fillStyle = '#707070'
    c.rx.beginPath()
    c.rx.arc(c.X(u), c.Y(v), c.S(2.8), 0, Math.PI * 2)
    c.rx.fill()
  }
  return c.finish()
}

/** Kleine ruis-normal map voor losse stalen onderdelen. */
function smallSteelNormal(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const rng = makeRng('steel')
  const img = ctx.createImageData(64, 64)
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 128 + (rng.next() - 0.5) * 20
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(heightToNormal(c, 2))
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(0.08, 0.08)
  return t
}

// ---------- model ----------

export interface Beretta {
  root: THREE.Group
  /** beweegt terug bij elk schot (slede + vizier + hendel) */
  slide: THREE.Group
  barrel: THREE.Mesh
  hammer: THREE.Mesh
  /** positie van de loopmond in root-coördinaten (voor het mondingsvuur) */
  muzzle: THREE.Vector3
  materials: THREE.Material[]
}

let cache: { slide: SideTex; frame: SideTex; grip: SideTex; steel: THREE.CanvasTexture } | null = null

export function buildBeretta(): Beretta {
  cache ??= { slide: slideTextures(), frame: frameTextures(), grip: gripTextures(), steel: smallSteelNormal() }
  const t = cache

  const steel = (tex: SideTex, roughness: number) =>
    new THREE.MeshStandardMaterial({
      map: tex.map,
      normalMap: tex.normal,
      normalScale: new THREE.Vector2(1.6, 1.6),
      roughnessMap: tex.rough,
      // gecoat zwart staal (Bruniton): deels metaal, deels mat
      metalness: 0.45,
      roughness,
      envMapIntensity: 1.1,
    })
  const slideMat = steel(t.slide, 0.55)
  const frameMat = steel(t.frame, 0.6)
  const gripMat = new THREE.MeshStandardMaterial({
    map: t.grip.map,
    normalMap: t.grip.normal,
    normalScale: new THREE.Vector2(2.2, 2.2),
    roughnessMap: t.grip.rough,
    metalness: 0.05,
    roughness: 0.85,
    envMapIntensity: 0.6,
  })
  const partMat = new THREE.MeshStandardMaterial({ color: 0x2e3034, metalness: 0.55, roughness: 0.42, normalMap: t.steel, envMapIntensity: 1.1 })
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x8e9298, metalness: 0.92, roughness: 0.26, envMapIntensity: 1.3 })
  const boreMat = new THREE.MeshBasicMaterial({ color: 0x050505 })
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xf2f2e8 })
  const polymerMat = new THREE.MeshStandardMaterial({ color: 0x161617, metalness: 0.05, roughness: 0.8 })

  const root = new THREE.Group()
  const slide = new THREE.Group()
  root.add(slide)

  // --- slede: open bovenkant waar de loop doorheen te zien is ---
  const slideShape = roundedShape(
    [
      [0, -25],
      [0, -5],
      [4, 0],
      [58, 0],
      [62, -9.5],
      [170, -9.5],
      [174, -3.5],
      [209, -3.5],
      [215, -7],
      [216.5, -12],
      [216.5, -22],
      [213, -26],
      [4, -26],
    ],
    [1.5, 2, 2.5, 2, 3, 3, 2, 2.5, 3, 1.5, 1.5, 2.5, 1.5],
  )
  slide.add(new THREE.Mesh(plate(slideShape, 24, 1.1), slideMat))

  // vizieren: korrel voorop, keep achterop, met witte stippen (3-dot)
  const frontSight = new THREE.Mesh(plate(roundedShape([[207, -4], [214, -4], [213.5, 1.5], [209.5, 1.5]], 0.8), 3, 0.4), partMat)
  slide.add(frontSight)
  const rearSight = new THREE.Mesh(plate(roundedShape([[5, 0], [15, 0], [15, 4], [5, 4]], 0.8), 18, 0.5), partMat)
  slide.add(rearSight)
  // keep: inkeping in het midden van het achtervizier
  const notch = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.4, 10.6), boreMat)
  notch.position.set(0, 2.9, -10)
  slide.add(notch)
  // witte stippen op de achterkant van korrel en keep (kijken naar de speler, +z)
  for (const [x, v, u] of [
    [-5, 2.2, 4.85],
    [5, 2.2, 4.85],
    [0, -0.4, 206.85],
  ] as const) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.8, 12), dotMat)
    d.position.set(x, v, -u)
    slide.add(d)
  }

  // veiligheid / decocker-hendel aan de linkerkant achterop
  const lever = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 3, 18), partMat)
  lever.rotation.z = Math.PI / 2
  lever.position.set(-13.2, -13, -14)
  slide.add(lever)
  const leverArm = new THREE.Mesh(plate(roundedShape([[10, -16], [24, -15], [26, -10.5], [12, -9]], 1.5), 3, 0.5, -13.4), partMat)
  slide.add(leverArm)

  // --- loop: zichtbaar door de open slede, met loopmond ---
  const barrel = new THREE.Mesh(tube(7, 40, 216.2, -13), barrelMat)
  root.add(barrel)
  const bore = new THREE.Mesh(tube(4.4, 214, 216.6, -13, 16), boreMat)
  barrel.add(bore)
  // geleidepen van de terugslagveer onder de loop
  const guide = new THREE.Mesh(tube(3, 205, 215.8, -21.5, 12), partMat)
  root.add(guide)

  // --- frame met dust cover, trekkerbeugel (met opening) en gripframe ---
  const frameShape = roundedShape(
    [
      [-7, -24],
      [200, -24],
      [204, -28],
      [204, -33],
      [197, -37],
      [152, -37],
      [154, -62],
      [151, -72],
      [143, -76.5],
      [110, -76.5],
      [97, -70],
      [86, -60],
      [67, -130],
      [62, -137],
      [14, -137],
      [8, -131],
      [3, -100],
      [-3, -62],
      [-9, -44],
      [-13, -35],
      [-11, -28],
    ],
    [2, 2, 2, 2, 2, 3, 4, 5, 6, 6, 6, 4, 3, 3, 3, 3, 6, 6, 4, 4, 3],
  )
  frameShape.holes.push(
    roundedPath(
      [
        [147, -38],
        [149, -60],
        [145, -68.5],
        [138, -71.5],
        [113, -71.5],
        [103, -66],
        [98, -56],
        [100, -42],
        [106, -38],
      ],
      4,
    ),
  )
  root.add(new THREE.Mesh(plate(frameShape, 22, 1.2), frameMat))

  // --- grippanelen links en rechts ---
  const gripShape = roundedShape(
    [
      [-1, -45],
      [80, -48],
      [78, -58],
      [62, -126],
      [57, -130],
      [16, -130],
      [10, -126],
      [4, -100],
      [-2, -62],
    ],
    [4, 4, 3, 4, 4, 4, 4, 6, 6],
  )
  root.add(new THREE.Mesh(plate(gripShape, 3, 0.9, -11.6), gripMat))
  root.add(new THREE.Mesh(plate(gripShape, 3, 0.9, 11.6), gripMat))

  // magazijnbodem
  const base = new THREE.Mesh(plate(roundedShape([[13, -136], [64, -136], [66, -141], [11, -141]], 1.5), 25, 1), polymerMat)
  root.add(base)

  // --- haan (met gat), trekker, slide stop en demontagehendel ---
  const hammerShape = roundedShape(
    [
      [-1, -27],
      [-1, -12],
      [-5, -5],
      [-13, -2.5],
      [-18, -6],
      [-15, -12],
      [-9, -15],
      [-8, -27],
    ],
    1.6,
  )
  hammerShape.holes.push(roundedPath([[-12, -6], [-9, -6], [-9, -9], [-12, -9]], 1.4))
  const hammerGeo = plate(hammerShape, 8, 0.7)
  // draaipunt van de haan rond (u=-4, v=-24)
  hammerGeo.translate(0, 24, -4)
  const hammer = new THREE.Mesh(hammerGeo, partMat)
  hammer.position.set(0, -24, 4)
  root.add(hammer)

  const trigger = new THREE.Mesh(
    plate(roundedShape([[128, -40], [133, -40], [131.5, -51], [127, -61], [121, -66.5], [119.5, -64], [124, -55], [126, -46]], 1.5), 6, 0.6),
    partMat,
  )
  root.add(trigger)

  const slideStop = new THREE.Mesh(plate(roundedShape([[88, -25], [118, -25], [120, -29], [96, -32], [88, -30]], 1.5), 2, 0.4, -11.6), partMat)
  root.add(slideStop)
  const takedown = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 2.4, 16), partMat)
  takedown.rotation.z = Math.PI / 2
  takedown.position.set(-11.6, -31, -146)
  root.add(takedown)

  for (const m of [...root.children, ...slide.children]) {
    if (m instanceof THREE.Mesh) {
      m.castShadow = false
      m.receiveShadow = false
    }
  }

  const muzzle = new THREE.Vector3(0, -13, -218)
  root.scale.setScalar(BERETTA_SCALE)
  return {
    root,
    slide,
    barrel,
    hammer,
    muzzle,
    materials: [slideMat, frameMat, gripMat, partMat, barrelMat, boreMat, dotMat, polymerMat],
  }
}
