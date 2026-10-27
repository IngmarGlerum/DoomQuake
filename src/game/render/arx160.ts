import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { makeRng } from '../rng'
import { grain, heightToNormal, plate, roundedPath, roundedShape, sideCanvas, tube, type SideTex } from './beretta'

/**
 * Beretta ARX160-achtig aanvalsgeweer, in millimeters, net als het pistool opgebouwd uit
 * geëxtrudeerde zijprofielen met afgeronde randen en procedurele textures met normal maps:
 * hoekige polymeer behuizing met naden en ventilatiesleuven, doorlopende picatinny-rail,
 * opklapbare vizieren, gestippelde pistoolgreep, gebogen magazijn, telescoopkolf en
 * een vlamdemper met sleuven.
 *
 * Profielcoördinaten: u = vanaf de achterkant van de behuizing richting loop, v = omhoog
 * (0 = bovenkant van de rail). Na opbouw wijst de loop naar -z en ligt de linkerkant op -x.
 */
export const RIFLE_SCALE = 0.001

type P = [number, number]

/** Doos in profielcoördinaten: breedte (x), hoogte (v), lengte (u) en het midden. */
function box(w: number, h: number, l: number, x: number, v: number, u: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, l)
  g.translate(x, v, -u)
  return g
}

/** Picatinny-rail: basisprofiel met dwarse ribbels om de 10 mm. */
function rail(u0: number, u1: number, v: number, width: number, side: 'top' | 'left' | 'right' = 'top') {
  const parts: THREE.BufferGeometry[] = [box(width * 0.72, 4, u1 - u0, 0, v - 2, (u0 + u1) / 2)]
  for (let u = u0 + 3; u < u1 - 3; u += 10) parts.push(box(width, 4.2, 5.2, 0, v + 1.6, u + 2.6))
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()))!
  if (side !== 'top') {
    // op de zijkant: om de loop-as kantelen
    g.translate(0, -v, 0)
    g.rotateZ(side === 'left' ? Math.PI / 2 : -Math.PI / 2)
    g.translate(0, v, 0)
  }
  return g
}

// ---------- textures ----------

/** Polymeer: fijne korrel en een matte, licht vlekkerige ruwheid. */
function polymer(c: ReturnType<typeof sideCanvas>, base: [number, number, number], seed: string) {
  grain(c, base, 0.22, seed)
  const rng = makeRng(seed + '-mottle')
  for (let i = 0; i < 260; i++) {
    const x = rng.next() * c.w
    const y = rng.next() * c.h
    const r = c.S(2 + rng.next() * 8)
    c.cx.fillStyle = `rgba(${rng.next() < 0.5 ? '0,0,0' : '90,92,96'},0.05)`
    c.cx.beginPath()
    c.cx.arc(x, y, r, 0, Math.PI * 2)
    c.cx.fill()
  }
}

/** Een verzonken naad of sleuf: donker in kleur, diep in de hoogtekaart. */
function groove(c: ReturnType<typeof sideCanvas>, pts: P[], width: number) {
  for (const [ctx, style, w] of [
    [c.hx, '#2c2c2c', width],
    [c.cx, '#0c0c0d', width],
    [c.cx, 'rgba(120,122,128,0.22)', width * 0.35],
  ] as const) {
    ctx.strokeStyle = style
    ctx.lineWidth = c.S(w)
    ctx.lineCap = 'round'
    ctx.beginPath()
    pts.forEach(([u, v], i) => (i ? ctx.lineTo(c.X(u), c.Y(v)) : ctx.moveTo(c.X(u), c.Y(v))))
    ctx.stroke()
  }
}

/** Gevulde, verzonken vorm (sleuven, uitsparingen). */
function recess(c: ReturnType<typeof sideCanvas>, pts: P[], depth = '#262626') {
  for (const [ctx, style] of [
    [c.hx, depth],
    [c.cx, '#0a0a0b'],
  ] as const) {
    ctx.fillStyle = style
    ctx.beginPath()
    pts.forEach(([u, v], i) => (i ? ctx.lineTo(c.X(u), c.Y(v)) : ctx.moveTo(c.X(u), c.Y(v))))
    ctx.closePath()
    ctx.fill()
  }
}

/** Opgehoogde, iets lichtere letters in het gietwerk. */
function molded(c: ReturnType<typeof sideCanvas>, text: string, u: number, v: number, size: number, color = '#4a4c50') {
  for (const [ctx, style] of [
    [c.hx, '#c8c8c8'],
    [c.cx, color],
  ] as const) {
    ctx.font = `bold ${c.S(size)}px "Arial Narrow", Arial, sans-serif`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillStyle = style
    ctx.fillText(text, c.X(u), c.Y(v))
  }
}

function upperTextures(): SideTex {
  const c = sideCanvas(-12, 392, -82, 4, 3)
  polymer(c, [36, 37, 39], 'arx-upper')
  // naad tussen behuizing en handkap, en de lange lijn langs de onderkant
  groove(c, [[248, -10], [252, -62]], 1.4)
  groove(c, [[-4, -50], [248, -50]], 1.1)
  groove(c, [[2, -14], [372, -14]], 0.9)
  // schuin aflopende ventilatiesleuven in de handkap
  for (let i = 0; i < 5; i++) {
    const u = 268 + i * 17
    recess(c, [[u, -22], [u + 7, -22], [u + 2, -46], [u - 5, -46]])
  }
  // uitsparing voor de laadhendel
  recess(c, [[172, -24], [238, -24], [238, -36], [172, -36]], '#303030')
  // bevestigingspennen
  for (const [u, v] of [[24, -40], [236, -58], [120, -58]] as P[]) {
    for (const [ctx, style] of [
      [c.hx, '#d8d8d8'],
      [c.cx, '#4c4e52'],
    ] as const) {
      ctx.fillStyle = style
      ctx.beginPath()
      ctx.arc(c.X(u), c.Y(v), c.S(3.2), 0, Math.PI * 2)
      ctx.fill()
    }
  }
  molded(c, 'ARX160', 110, -38, 9)
  molded(c, 'CAL. 5.56 NATO', 110, -45.5, 4)
  molded(c, 'MADE IN ITALY', 330, -55, 3.4)
  return c.finish()
}

function lowerTextures(): SideTex {
  const c = sideCanvas(0, 252, -226, -64, 3)
  polymer(c, [33, 34, 36], 'arx-lower')
  const rng = makeRng('arx-stipple')
  // gestippelde greep: honderden kleine putjes binnen het greepvlak
  for (let i = 0; i < 2600; i++) {
    const t = rng.next()
    const v = -118 - t * 92
    const front = 76 - t * 22
    const back = 26 - t * 4
    const u = back + rng.next() * (front - back)
    for (const [ctx, style] of [
      [c.hx, rng.next() < 0.5 ? '#585858' : '#a8a8a8'],
      [c.cx, rng.next() < 0.5 ? '#1c1d1f' : '#3a3c40'],
    ] as const) {
      ctx.fillStyle = style
      ctx.beginPath()
      ctx.arc(c.X(u), c.Y(v), c.S(0.9), 0, Math.PI * 2)
      ctx.fill()
    }
  }
  // vingergroeven aan de voorkant van de greep
  for (let i = 0; i < 3; i++) groove(c, [[78 - i * 6.5, -128 - i * 24], [70 - i * 6.5, -134 - i * 24]], 1.2)
  // vuurstandmarkering rond de keuzehendel
  for (const [t, a] of [['S', -2.3], ['1', -1.5], ['F', -0.7]] as const) {
    const u = 64 + Math.cos(a) * 15
    const v = -86 + Math.sin(a) * 15
    for (const [ctx, style] of [
      [c.hx, '#2a2a2a'],
      [c.cx, '#c8c8c0'],
    ] as const) {
      ctx.font = `bold ${c.S(5)}px Arial, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = style
      ctx.fillText(t, c.X(u), c.Y(v))
    }
  }
  groove(c, [[150, -70], [150, -106]], 1)
  molded(c, 'BERETTA', 200, -86, 6)
  return c.finish()
}

function magazineTextures(): SideTex {
  const c = sideCanvas(150, 276, -332, -94, 3)
  polymer(c, [58, 60, 63], 'arx-mag')
  // ribbels die de kromming van het magazijn volgen
  for (let i = 0; i < 4; i++) {
    const o = 10 + i * 13
    groove(c, [[157 + o, -112], [166 + o, -175], [184 + o, -250], [198 + o, -300]], 2.2)
  }
  // tellergaten aan de zijkant (doorkijkje naar de patronen)
  for (let i = 0; i < 3; i++) {
    const v = -130 - i * 38
    const u = 165 + i * 7
    recess(c, [[u, v], [u + 6, v], [u + 6, v - 10], [u, v - 10]], '#202020')
    c.cx.fillStyle = '#9a7a38'
    c.cx.fillRect(c.X(u + 5), c.Y(v - 2), c.S(4), c.S(6))
  }
  return c.finish()
}

/** Kleine, herhalende korrel voor losse onderdelen (kolf, vizieren, handgreep van de laadhendel). */
function grainNormal(seed: string, strength = 2): THREE.CanvasTexture {
  const size = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  const img = ctx.createImageData(size, size)
  const rng = makeRng(seed)
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 128 + (rng.next() - 0.5) * 34
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(heightToNormal(cv, strength))
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(0.05, 0.05)
  return t
}

// ---------- model ----------

export interface Rifle {
  root: THREE.Group
  /** grendel + laadhendel, slaan bij elk schot naar achteren */
  bolt: THREE.Group
  /** loopmond en uitwerppoort in root-coördinaten */
  muzzle: THREE.Vector3
  ejectPort: THREE.Vector3
  materials: THREE.Material[]
}

let cache: { upper: SideTex; lower: SideTex; mag: SideTex; grain: THREE.CanvasTexture } | null = null

export function buildRifle(): Rifle {
  cache ??= { upper: upperTextures(), lower: lowerTextures(), mag: magazineTextures(), grain: grainNormal('arx-grain') }
  const t = cache

  const shell = (tex: SideTex, roughness: number) =>
    new THREE.MeshStandardMaterial({
      map: tex.map,
      normalMap: tex.normal,
      normalScale: new THREE.Vector2(1.5, 1.5),
      roughnessMap: tex.rough,
      metalness: 0.08,
      roughness,
      envMapIntensity: 0.7,
    })
  const upperMat = shell(t.upper, 0.72)
  const lowerMat = shell(t.lower, 0.8)
  const magMat = shell(t.mag, 0.62)
  const polyMat = new THREE.MeshStandardMaterial({ color: 0x222325, metalness: 0.08, roughness: 0.75, normalMap: t.grain, envMapIntensity: 0.7 })
  // geanodiseerd aluminium (rail, vizieren) en gefosfateerd staal (loop, grendel)
  const alloyMat = new THREE.MeshStandardMaterial({ color: 0x1e1f22, metalness: 0.55, roughness: 0.45, normalMap: t.grain, envMapIntensity: 1 })
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x2b2d30, metalness: 0.75, roughness: 0.38, normalMap: t.grain, envMapIntensity: 1.2 })
  const boltMat = new THREE.MeshStandardMaterial({ color: 0x8a8d92, metalness: 0.9, roughness: 0.3, envMapIntensity: 1.3 })
  const boreMat = new THREE.MeshBasicMaterial({ color: 0x050505 })
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xb8893a, metalness: 0.9, roughness: 0.32, envMapIntensity: 1.2 })
  const sightMat = new THREE.MeshBasicMaterial({ color: 0xe8e8d8 })

  const root = new THREE.Group()
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = root) => {
    const m = new THREE.Mesh(geo, mat)
    parent.add(m)
    return m
  }

  // --- behuizing + handkap (één polymeer schaal) ---
  add(
    plate(
      roundedShape(
        [
          [-8, -9],
          [374, -9],
          [384, -16],
          [388, -44],
          [382, -60],
          [372, -64],
          [252, -64],
          [244, -72],
          [16, -72],
          [-8, -64],
        ],
        [4, 6, 6, 5, 4, 4, 4, 4, 4, 6],
      ),
      50,
      2.4,
    ),
    upperMat,
  )

  // --- onderste behuizing: magazijnschacht, trekkerbeugel en pistoolgreep ---
  const lowerShape = roundedShape(
    [
      [14, -66],
      [246, -66],
      [246, -96],
      [234, -110],
      [152, -110],
      [146, -114],
      [140, -128],
      [128, -134],
      [96, -134],
      [86, -122],
      [80, -114],
      [70, -150],
      [58, -200],
      [52, -214],
      [36, -220],
      [22, -214],
      [20, -200],
      [24, -160],
      [20, -120],
      [10, -98],
      [8, -78],
    ],
    [3, 3, 4, 5, 3, 4, 6, 6, 6, 4, 6, 10, 8, 8, 8, 6, 10, 10, 8, 6, 4],
  )
  lowerShape.holes.push(
    roundedPath(
      [
        [136, -113],
        [131, -125],
        [122, -129],
        [101, -129],
        [93, -120],
        [96, -113],
      ],
      4,
    ),
  )
  add(plate(lowerShape, 36, 2.2), lowerMat)

  // trekker
  add(plate(roundedShape([[112, -108], [118, -108], [117, -116], [113, -126], [108, -127], [110, -118]], 1.6), 7, 0.6), steelMat)

  // --- gebogen magazijn ---
  add(
    plate(
      roundedShape(
        [
          [156, -100],
          [226, -100],
          [234, -168],
          [252, -246],
          [270, -298],
          [266, -314],
          [206, -326],
          [198, -312],
          [182, -248],
          [166, -170],
        ],
        [2, 2, 8, 10, 6, 5, 5, 6, 10, 8],
      ),
      26,
      1.8,
    ),
    magMat,
  )
  // patroon die bovenin het magazijn zichtbaar is
  const round = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 40, 12).rotateX(Math.PI / 2), brassMat)
  round.position.set(0, -98, -200)
  root.add(round)

  // --- rail bovenop over de hele lengte, plus korte rails op de handkap ---
  add(rail(-4, 372, -2, 21), alloyMat)
  add(rail(276, 368, -40, 18, 'left').translate(-27, 0, 0), alloyMat)
  add(rail(276, 368, -40, 18, 'right').translate(27, 0, 0), alloyMat)

  // --- opklapbare vizieren ---
  const rear = roundedShape([[4, -2], [42, -2], [42, 20], [36, 34], [10, 34], [4, 20]], 3)
  rear.holes.push(roundedPath([[16, 14], [30, 14], [30, 28], [16, 28]], 3))
  add(plate(rear, 24, 1.2), alloyMat)
  // diopter: ring met een klein gaatje in het midden
  const aperture = new THREE.Mesh(new THREE.TorusGeometry(3.6, 1.6, 8, 20), alloyMat)
  aperture.position.set(0, 21, -23)
  root.add(aperture)
  const front = roundedShape([[334, -2], [360, -2], [358, 24], [352, 30], [342, 30], [336, 24]], 2.5)
  front.holes.push(roundedPath([[340, 6], [354, 6], [354, 25], [340, 25]], 2))
  add(plate(front, 20, 1), alloyMat)
  add(box(3, 16, 3, 0, 14, 347), alloyMat)
  const dot = new THREE.Mesh(new THREE.CircleGeometry(1.1, 10), sightMat)
  dot.position.set(0, 21, -345.4)
  root.add(dot)

  // --- loop, gasblok en vlamdemper ---
  add(tube(9, 300, 560, -40), steelMat)
  add(box(22, 24, 30, 0, -40, 400), steelMat)
  const hider = add(tube(11.5, 556, 606, -40, 24), steelMat)
  // sleuven in de vlamdemper
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(2.4, 24, 30), boreMat)
    s.rotation.z = (i * Math.PI) / 4
    s.position.set(0, -40, -588)
    hider.add(s)
  }
  add(tube(4, 600, 606.6, -40, 14), boreMat)

  // --- telescoopkolf (ligt grotendeels achter de camera) ---
  add(tube(13, -250, 0, -42, 16), alloyMat)
  add(
    plate(
      roundedShape(
        [
          [-196, -26],
          [-298, -26],
          [-306, -40],
          [-306, -152],
          [-292, -160],
          [-268, -154],
          [-264, -64],
          [-204, -56],
        ],
        [6, 8, 6, 8, 8, 6, 10, 6],
      ),
      42,
      2,
    ),
    polyMat,
  )

  // --- linkerkant: keuzehendel, magazijnknop, grendelvanger ---
  add(plate(roundedShape([[60, -82], [80, -78], [82, -83], [62, -90]], 2), 3, 0.6, -19), steelMat)
  add(new THREE.CylinderGeometry(6, 6, 3, 18).rotateZ(Math.PI / 2).translate(-19, -86, -64), steelMat)
  add(box(4, 9, 14, -19.5, -92, 160), polyMat)
  add(box(4, 14, 8, -19.5, -78, 140), steelMat)
  // sling-ogen voor en achter
  for (const u of [20, 360]) {
    add(new THREE.TorusGeometry(6, 1.8, 8, 16).rotateY(Math.PI / 2).translate(-26, -58, -u), steelMat)
  }

  // --- grendel + laadhendel: bewegen samen naar achteren ---
  const bolt = new THREE.Group()
  root.add(bolt)
  // laadhendel steekt links uit de behuizing (bij de ARX160 vooraan, net achter de handkap)
  add(box(16, 9, 12, -29, -30, 226), steelMat, bolt)
  add(box(10, 11, 16, -37, -30, 226), polyMat, bolt)
  // grendeldrager zichtbaar in de uitwerppoort rechts
  add(box(1.2, 14, 40, 26.6, -37, 165), boltMat, bolt)
  // uitwerppoort (rechterkant): donkere uitsparing in de behuizing
  add(box(1.5, 22, 72, 25.8, -37, 160), boreMat)

  for (const m of root.children) m.castShadow = m.receiveShadow = false

  root.scale.setScalar(RIFLE_SCALE)
  return {
    root,
    bolt,
    muzzle: new THREE.Vector3(0, -40, -607),
    ejectPort: new THREE.Vector3(28, -37, -165),
    materials: [upperMat, lowerMat, magMat, polyMat, alloyMat, steelMat, boltMat, boreMat, brassMat, sightMat],
  }
}

// ---------- hulzen ----------

let caseGeo: THREE.LatheGeometry | null = null

/** 5.56-huls (mm): rand met extractiegroef, licht taps lichaam, schouder en hals. Ligt langs de y-as. */
export function casingGeometry(): THREE.LatheGeometry {
  caseGeo ??= new THREE.LatheGeometry(
    (
      [
        [0, 0],
        [4.7, 0],
        [4.75, 1.1],
        [4.0, 1.4],
        [4.0, 2.6],
        [4.8, 3.2],
        [4.55, 36],
        [3.2, 39.5],
        [3.15, 44.7],
        [2.7, 44.7],
        [2.7, 42],
      ] as P[]
    ).map(([r, y]) => new THREE.Vector2(r, y)),
    14,
  )
  return caseGeo
}

export const casingMaterial = () =>
  new THREE.MeshStandardMaterial({ color: 0xc89a48, metalness: 0.92, roughness: 0.28, envMapIntensity: 1.4 })

// ---------- mondingsvuur ----------

/**
 * Textures voor het mondingsvuur, additief te tekenen (zwart = niets):
 * - `petal`: een vlammentong langs de loop-as (basis onderaan in het canvas)
 * - `star`: de stervormige flits recht van voren, zoals bij een vlamdemper met sleuven
 */
export function flashTextures() {
  const make = (w: number, h: number, draw: (x: number, y: number, rng: () => number) => number) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(w, h)
    const rng = makeRng(`flash-${w}-${h}`)
    const r = () => rng.next()
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = Math.max(0, Math.min(1, draw(x, y, r)))
        // wit-geel in de kern, oranje naar de randen
        const i = (y * w + x) * 4
        img.data[i] = 255 * Math.min(1, k * 1.6)
        img.data[i + 1] = 255 * Math.min(1, k * k * 1.5 + k * 0.25)
        img.data[i + 2] = 255 * Math.min(1, k * k * k * 1.2)
        img.data[i + 3] = 255 * k
      }
    }
    ctx.putImageData(img, 0, 0)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }

  // vlammentong: smal bij de monding, bol in het midden, rafelig uitlopend
  const streaks = Array.from({ length: 9 }, (_, i) => ({ x: (i / 8) * 1.6 - 0.8, w: 0.06 + (i % 3) * 0.03, a: 0.3 + ((i * 7) % 5) * 0.12 }))
  const petal = make(64, 256, (x, y) => {
    const u = (x / 63) * 2 - 1
    const t = 1 - y / 255 // 0 = monding, 1 = punt
    const width = 0.12 + Math.sin(Math.min(1, t * 1.25) * Math.PI) * 0.62
    let k = Math.exp(-((u / width) ** 2) * 2.4) * Math.pow(1 - t, 0.7) * Math.min(1, t * 9 + 0.25)
    for (const s of streaks) k += Math.exp(-(((u - s.x * width) / s.w) ** 2)) * s.a * (1 - t) * t * 2.2
    return k * (0.9 + 0.1 * Math.sin(t * 40 + u * 7))
  })

  const stars = [5, 6, 4].map((n, variant) => {
    const angles = Array.from({ length: n }, (_, i) => (i / n) * Math.PI * 2 + (variant * 0.37 + (i % 2) * 0.13))
    const lens = angles.map((_, i) => 0.65 + ((i * 37 + variant * 11) % 10) / 28)
    return make(128, 128, (x, y) => {
      const dx = (x - 63.5) / 63.5
      const dy = (y - 63.5) / 63.5
      const r = Math.hypot(dx, dy)
      let k = Math.exp(-(r * r) / 0.018) * 1.3 + Math.exp(-(r * r) / 0.09) * 0.35
      angles.forEach((a, i) => {
        const along = dx * Math.cos(a) + dy * Math.sin(a)
        if (along <= 0) return
        const across = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a))
        const f = along / lens[i]
        if (f >= 1) return
        k += Math.exp(-((across / (0.07 * (1 - f) + 0.01)) ** 2)) * (1 - f) ** 1.4 * 0.95
      })
      return k
    })
  })
  return { petal, stars }
}
