import * as THREE from 'three'
import type { WeaponId } from '../combat/weapons'
import type { EnemyKind } from '../level/types'

/**
 * Low-poly "Quake-achtige" placeholder-modellen, opgebouwd uit primitieven met nep-
 * belichting in vertexkleuren. Later te vervangen door echte glTF-modellen
 * (bijv. Quaternius / Kenney, CC0).
 */
const LIGHT_DIR = new THREE.Vector3(0.4, 0.85, 0.35).normalize()

function shaded(geometry: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  g.computeVertexNormals()
  const n = g.getAttribute('normal')
  const base = new THREE.Color(color)
  const colors = new Float32Array(n.count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < n.count; i++) {
    v.fromBufferAttribute(n, i)
    const f = 0.45 + 0.55 * Math.max(0, v.dot(LIGHT_DIR))
    colors[i * 3] = base.r * f
    colors[i * 3 + 1] = base.g * f
    colors[i * 3 + 2] = base.b * f
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return g
}

type Part = { geo: THREE.BufferGeometry; color: number; pos: [number, number, number]; rot?: [number, number, number] }

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
const cone = (r: number, h: number) => new THREE.ConeGeometry(r, h, 5)
const cyl = (r: number, h: number) => new THREE.CylinderGeometry(r, r, h, 6)

function merge(parts: Part[]): THREE.BufferGeometry {
  const geos = parts.map((p) => {
    const g = shaded(p.geo, p.color)
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...p.pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0]))),
      new THREE.Vector3(1, 1, 1),
    )
    g.applyMatrix4(m)
    return g
  })
  const total = geos.reduce((n, g) => n + g.getAttribute('position').count, 0)
  const pos = new Float32Array(total * 3)
  const col = new Float32Array(total * 3)
  let o = 0
  for (const g of geos) {
    pos.set(g.getAttribute('position').array as Float32Array, o * 3)
    col.set(g.getAttribute('color').array as Float32Array, o * 3)
    o += g.getAttribute('position').count
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('color', new THREE.BufferAttribute(col, 3))
  out.computeBoundingSphere()
  return out
}

const ENEMY_PARTS: Record<EnemyKind, () => Part[]> = {
  // soldaat met helm en geweer
  grunt: () => [
    { geo: box(0.24, 0.85, 0.26), color: 0x3d4a2a, pos: [-0.15, 0.43, 0] },
    { geo: box(0.24, 0.85, 0.26), color: 0x3d4a2a, pos: [0.15, 0.43, 0] },
    { geo: box(0.62, 0.7, 0.36), color: 0x5f6b3a, pos: [0, 1.2, 0] },
    { geo: box(0.3, 0.3, 0.3), color: 0xc89070, pos: [0, 1.72, 0] },
    { geo: box(0.36, 0.14, 0.36), color: 0x2f3a22, pos: [0, 1.88, 0] },
    { geo: box(0.17, 0.62, 0.2), color: 0x5f6b3a, pos: [-0.4, 1.2, -0.08], rot: [-0.5, 0, 0] },
    { geo: box(0.17, 0.62, 0.2), color: 0x5f6b3a, pos: [0.4, 1.2, -0.08], rot: [-0.5, 0, 0] },
    { geo: box(0.1, 0.12, 0.8), color: 0x222222, pos: [0.15, 1.05, -0.45] },
  ],
  // gebogen, gespierd wezen met hoorns en klauwen
  imp: () => [
    { geo: box(0.26, 0.8, 0.3), color: 0x6a4a30, pos: [-0.18, 0.4, 0.05] },
    { geo: box(0.26, 0.8, 0.3), color: 0x6a4a30, pos: [0.18, 0.4, 0.05] },
    { geo: box(0.75, 0.8, 0.45), color: 0x8a6040, pos: [0, 1.2, -0.05], rot: [0.25, 0, 0] },
    { geo: box(0.36, 0.34, 0.36), color: 0x7a5236, pos: [0, 1.75, -0.22] },
    { geo: cone(0.06, 0.3), color: 0xe0d0b0, pos: [-0.14, 2.0, -0.2], rot: [0, 0, 0.4] },
    { geo: cone(0.06, 0.3), color: 0xe0d0b0, pos: [0.14, 2.0, -0.2], rot: [0, 0, -0.4] },
    { geo: cone(0.09, 0.3), color: 0xe0d0b0, pos: [-0.42, 1.6, 0], rot: [0, 0, 0.9] },
    { geo: cone(0.09, 0.3), color: 0xe0d0b0, pos: [0.42, 1.6, 0], rot: [0, 0, -0.9] },
    { geo: box(0.2, 0.75, 0.22), color: 0x7a5236, pos: [-0.5, 1.1, -0.15], rot: [-0.6, 0, 0.15] },
    { geo: box(0.2, 0.75, 0.22), color: 0x7a5236, pos: [0.5, 1.1, -0.15], rot: [-0.6, 0, -0.15] },
    { geo: box(0.08, 0.06, 0.06), color: 0xffaa00, pos: [-0.08, 1.8, -0.41] },
    { geo: box(0.08, 0.06, 0.06), color: 0xffaa00, pos: [0.08, 1.8, -0.41] },
  ],
  // lomp, roze "pinky"-achtig beest met grote kaak
  demon: () => [
    { geo: box(0.32, 0.6, 0.36), color: 0x8a4050, pos: [-0.38, 0.3, 0.2] },
    { geo: box(0.32, 0.6, 0.36), color: 0x8a4050, pos: [0.38, 0.3, 0.2] },
    { geo: box(1.15, 0.9, 1.25), color: 0xc06070, pos: [0, 1.0, 0.05] },
    { geo: box(0.85, 0.5, 0.6), color: 0xb05060, pos: [0, 1.2, -0.75] },
    { geo: box(0.8, 0.22, 0.55), color: 0x903848, pos: [0, 0.82, -0.72], rot: [0.25, 0, 0] },
    { geo: cone(0.05, 0.16), color: 0xf0f0e0, pos: [-0.25, 1.0, -1.0], rot: [Math.PI, 0, 0] },
    { geo: cone(0.05, 0.16), color: 0xf0f0e0, pos: [0, 1.0, -1.02], rot: [Math.PI, 0, 0] },
    { geo: cone(0.05, 0.16), color: 0xf0f0e0, pos: [0.25, 1.0, -1.0], rot: [Math.PI, 0, 0] },
    { geo: box(0.1, 0.08, 0.06), color: 0xff3020, pos: [-0.2, 1.35, -1.06] },
    { geo: box(0.1, 0.08, 0.06), color: 0xff3020, pos: [0.2, 1.35, -1.06] },
  ],
}

const cache = new Map<string, THREE.BufferGeometry>()
const cached = (key: string, build: () => THREE.BufferGeometry) => {
  if (!cache.has(key)) cache.set(key, build())
  return cache.get(key)!
}

export const enemyGeometry = (kind: EnemyKind) => cached(`enemy-${kind}`, () => merge(ENEMY_PARTS[kind]()))

export const pickupGeometry = {
  health: () =>
    cached('health', () =>
      merge([
        { geo: box(0.5, 0.3, 0.4), color: 0xe8e8e8, pos: [0, 0.15, 0] },
        { geo: box(0.3, 0.02, 0.1), color: 0xd01010, pos: [0, 0.31, 0] },
        { geo: box(0.1, 0.02, 0.3), color: 0xd01010, pos: [0, 0.31, 0] },
      ]),
    ),
  ammo: () =>
    cached('ammo', () =>
      merge([
        { geo: box(0.5, 0.25, 0.3), color: 0x8a2a1a, pos: [0, 0.125, 0] },
        { geo: box(0.5, 0.04, 0.3), color: 0xd8b020, pos: [0, 0.27, 0] },
      ]),
    ),
  armor: () =>
    cached('armor', () =>
      merge([
        { geo: box(0.6, 0.65, 0.22), color: 0x2a8a3a, pos: [0, 0.33, 0] },
        { geo: box(0.2, 0.65, 0.24), color: 0x50c060, pos: [0, 0.33, 0] },
      ]),
    ),
  stimpack: () =>
    cached('stimpack', () =>
      merge([
        { geo: box(0.3, 0.18, 0.22), color: 0xe8e8e8, pos: [0, 0.09, 0] },
        { geo: box(0.16, 0.02, 0.05), color: 0xd01010, pos: [0, 0.19, 0] },
        { geo: box(0.05, 0.02, 0.16), color: 0xd01010, pos: [0, 0.19, 0] },
      ]),
    ),
  clip: () =>
    cached('clip', () =>
      merge([
        { geo: box(0.1, 0.28, 0.16), color: 0x2a2c30, pos: [0, 0.14, 0], rot: [0.15, 0, 0] },
        { geo: box(0.08, 0.04, 0.12), color: 0xd8b020, pos: [0, 0.3, -0.02], rot: [0.15, 0, 0] },
      ]),
    ),
  shells: () =>
    cached('shells', () =>
      merge([
        { geo: cyl(0.04, 0.16), color: 0xb02010, pos: [-0.09, 0.08, 0] },
        { geo: cyl(0.04, 0.16), color: 0xb02010, pos: [0, 0.08, 0.02] },
        { geo: cyl(0.04, 0.16), color: 0xb02010, pos: [0.09, 0.08, 0] },
        { geo: cyl(0.042, 0.04), color: 0xd8b020, pos: [-0.09, 0.02, 0] },
        { geo: cyl(0.042, 0.04), color: 0xd8b020, pos: [0, 0.02, 0.02] },
        { geo: cyl(0.042, 0.04), color: 0xd8b020, pos: [0.09, 0.02, 0] },
      ]),
    ),
  disks: () =>
    cached('disks-pickup', () => merge([...sawDiskParts(0.16, [0, 0.03, 0]), ...sawDiskParts(0.16, [0.02, 0.07, 0.01])])),
  /** losse raket rechtop, als munitie-drop */
  rocketAmmo: () =>
    cached('rocket-ammo', () => {
      const g = rocketGeometry().clone()
      g.rotateX(-Math.PI / 2)
      g.translate(0, 0.3, 0)
      return g
    }),
  key: () =>
    cached('key', () =>
      merge([
        { geo: box(0.32, 0.46, 0.05), color: 0xff2020, pos: [0, 0, 0] },
        { geo: box(0.32, 0.08, 0.06), color: 0xffffff, pos: [0, 0.12, 0] },
      ]),
    ),
}

export const shotgunGeometry = () =>
  cached('shotgun', () =>
    merge([
      { geo: cyl(0.035, 0.75), color: 0x505560, pos: [-0.04, 0, -0.38], rot: [Math.PI / 2, 0, 0] },
      { geo: cyl(0.035, 0.75), color: 0x505560, pos: [0.04, 0, -0.38], rot: [Math.PI / 2, 0, 0] },
      { geo: box(0.14, 0.1, 0.3), color: 0x6a4a2a, pos: [0, -0.06, -0.3] },
      { geo: box(0.13, 0.13, 0.25), color: 0x3a3e46, pos: [0, -0.02, 0.0] },
      { geo: box(0.12, 0.16, 0.35), color: 0x5a3a20, pos: [0, -0.1, 0.25], rot: [-0.2, 0, 0] },
    ]),
  )

export const pistolGeometry = () =>
  cached('pistol', () =>
    merge([
      { geo: box(0.075, 0.09, 0.34), color: 0x3a3e46, pos: [0, 0.02, -0.15] },
      { geo: box(0.08, 0.025, 0.3), color: 0x5a606a, pos: [0, 0.075, -0.15] },
      { geo: cyl(0.022, 0.06), color: 0x222428, pos: [0, 0.02, -0.34], rot: [Math.PI / 2, 0, 0] },
      { geo: box(0.07, 0.2, 0.1), color: 0x4a3020, pos: [0, -0.1, 0.0], rot: [0.28, 0, 0] },
      { geo: box(0.02, 0.05, 0.08), color: 0x2a2c30, pos: [0, -0.05, -0.08] },
      { geo: box(0.02, 0.025, 0.02), color: 0xd0d0d0, pos: [0, 0.1, -0.29] },
    ]),
  )

export const machinegunGeometry = () =>
  cached('machinegun', () =>
    merge([
      { geo: box(0.1, 0.13, 0.52), color: 0x30343a, pos: [0, 0, -0.12] },
      { geo: cyl(0.05, 0.3), color: 0x22252a, pos: [0, 0.01, -0.5], rot: [Math.PI / 2, 0, 0] },
      { geo: cyl(0.022, 0.5), color: 0x50555e, pos: [0, 0.01, -0.62], rot: [Math.PI / 2, 0, 0] },
      { geo: box(0.06, 0.22, 0.09), color: 0x26282c, pos: [0, -0.16, -0.18], rot: [-0.2, 0, 0] },
      { geo: box(0.04, 0.06, 0.26), color: 0x3a3e46, pos: [0, 0.1, -0.14] },
      { geo: box(0.08, 0.14, 0.3), color: 0x4a3020, pos: [0, -0.04, 0.27], rot: [-0.12, 0, 0] },
      { geo: box(0.07, 0.15, 0.08), color: 0x4a3020, pos: [0, -0.13, 0.06], rot: [0.3, 0, 0] },
    ]),
  )

export const rocketLauncherGeometry = () =>
  cached('rocket', () =>
    merge([
      // grote buis met een donkere mond en een verdikte achterkant
      { geo: cyl(0.075, 0.95), color: 0x4a5a3a, pos: [0, 0.02, -0.28], rot: [Math.PI / 2, 0, 0] },
      { geo: cyl(0.085, 0.12), color: 0x2a2e22, pos: [0, 0.02, -0.72], rot: [Math.PI / 2, 0, 0] },
      { geo: cyl(0.09, 0.16), color: 0x3a4430, pos: [0, 0.02, 0.18], rot: [Math.PI / 2, 0, 0] },
      { geo: box(0.04, 0.05, 0.6), color: 0xc8a020, pos: [0, -0.05, -0.28] },
      // vizier, handgreep en trekker
      { geo: box(0.03, 0.09, 0.05), color: 0x202020, pos: [0, 0.12, -0.5] },
      { geo: box(0.05, 0.06, 0.12), color: 0x202020, pos: [0, 0.11, -0.05] },
      { geo: box(0.06, 0.18, 0.08), color: 0x3a2818, pos: [0, -0.12, -0.02], rot: [0.25, 0, 0] },
      { geo: box(0.06, 0.15, 0.07), color: 0x3a2818, pos: [0, -0.1, -0.4], rot: [0.15, 0, 0] },
    ]),
  )

export const rocketGeometry = () =>
  cached('rocket-projectile', () =>
    merge([
      { geo: cyl(0.06, 0.45), color: 0x8a8a7a, pos: [0, 0, 0], rot: [Math.PI / 2, 0, 0] },
      { geo: cone(0.065, 0.18), color: 0xc03020, pos: [0, 0, -0.31], rot: [-Math.PI / 2, 0, 0] },
      { geo: box(0.2, 0.02, 0.1), color: 0x505048, pos: [0, 0, 0.2] },
      { geo: box(0.02, 0.2, 0.1), color: 0x505048, pos: [0, 0, 0.2] },
    ]),
  )

/** Liggende cirkelzaag met straal R (as = Y), als losse onderdelen. */
function sawDiskParts(R: number, at: [number, number, number] = [0, 0, 0]): Part[] {
  const [x, y, z] = at
  const h = Math.max(0.012, R * 0.11)
  const parts: Part[] = [
    { geo: new THREE.CylinderGeometry(R, R, h, 16), color: 0xb8bec8, pos: [x, y, z] },
    { geo: new THREE.CylinderGeometry(R * 0.68, R * 0.68, h * 1.15, 16), color: 0x8a9098, pos: [x, y, z] },
    { geo: new THREE.CylinderGeometry(R * 0.26, R * 0.26, h * 1.8, 8), color: 0x3a3e44, pos: [x, y, z] },
  ]
  const teeth = 14
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2
    const r = R + R * 0.08
    // kegeltje plat in het vlak, punt naar buiten en een beetje schuin (zaagtand)
    parts.push({
      geo: cone(R * 0.12, R * 0.26),
      color: 0xe0e4ea,
      pos: [x + Math.cos(a) * r, y, z + Math.sin(a) * r],
      rot: [0, -a - 0.5, -Math.PI / 2],
    })
  }
  return parts
}

/** Projectiel van de disk launcher. */
export const sawDiskGeometry = () => cached('saw-disk', () => merge(sawDiskParts(0.28)))

/** Schijf zoals hij in het wapen ligt (viewmodel-schaal). */
export const viewDiskGeometry = () => cached('saw-disk-view', () => merge(sawDiskParts(0.1)))

const DISK_SEAT: [number, number, number] = [0, 0.04, -0.2]

function diskLauncherParts(): Part[] {
  return [
    // vlakke slede waar de schijf op ligt
    { geo: box(0.22, 0.05, 0.56), color: 0x3a3f48, pos: [0, -0.02, -0.18] },
    { geo: box(0.025, 0.08, 0.5), color: 0x6a707a, pos: [-0.12, 0.02, -0.2] },
    { geo: box(0.025, 0.08, 0.5), color: 0x6a707a, pos: [0.12, 0.02, -0.2] },
    // oranje geleiders voorop
    { geo: box(0.03, 0.06, 0.12), color: 0xc86018, pos: [-0.11, 0.03, -0.5] },
    { geo: box(0.03, 0.06, 0.12), color: 0xc86018, pos: [0.11, 0.03, -0.5] },
    // behuizing achter met een blauw lichtje
    { geo: box(0.2, 0.11, 0.16), color: 0x2e3238, pos: [0, 0.02, 0.12] },
    { geo: box(0.03, 0.02, 0.02), color: 0x30c0ff, pos: [-0.06, 0.08, 0.04] },
    { geo: box(0.03, 0.02, 0.02), color: 0x30c0ff, pos: [0.06, 0.08, 0.04] },
    // magazijn met reserveschijven onder de slede
    { geo: cyl(0.09, 0.12), color: 0x50565e, pos: [0, -0.1, -0.14] },
    // handgreep
    { geo: box(0.06, 0.18, 0.08), color: 0x2a1c12, pos: [0, -0.14, 0.12], rot: [0.25, 0, 0] },
  ]
}

/** Wapen zonder schijf (het viewmodel animeert de schijf los). */
export const diskLauncherBodyGeometry = () => cached('disk-launcher-body', () => merge(diskLauncherParts()))

/** Positie van de schijf op de slede, in viewmodel-coördinaten t.o.v. het wapen. */
export const diskSeat = DISK_SEAT

export const weaponGeometry: Record<WeaponId, () => THREE.BufferGeometry> = {
  pistol: pistolGeometry,
  shotgun: shotgunGeometry,
  machinegun: machinegunGeometry,
  rocket: rocketLauncherGeometry,
  // icoon en wisselanimatie: wapen mét schijf
  disk: () => cached('disk-launcher', () => merge([...diskLauncherParts(), ...sawDiskParts(0.1, DISK_SEAT)])),
}
