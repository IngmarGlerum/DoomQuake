import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { raycast } from './runtime'

/**
 * Realistisch bloed (gesticht): spetters, nevel en spatten op muur en vloer.
 * - druppels: zachte, langs hun snelheid uitgerekte vlekjes die naar de camera kijken
 * - nevel: een paar grote, vage wolkjes die snel uitdijen en verdwijnen
 * - spatten: vlekken (uit een atlas van vier varianten) op de muur achter het slachtoffer en op de vloer,
 *   nat glanzend en belicht door de lampen; neervallende druppels laten kleine vlekjes achter
 */
const MAX_DROPS = 500
const MAX_MIST = 40
const MAX_SPLATS = 140

interface Drop {
  active: boolean
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  size: number
  floorY: number
  /** laat een vlekje achter op de vloer */
  stain: boolean
}

interface Mist {
  active: boolean
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  maxLife: number
  size: number
}

const drops: Drop[] = Array.from({ length: MAX_DROPS }, () => ({ active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, size: 0.01, floorY: -1e9, stain: false }))
const mists: Mist[] = Array.from({ length: MAX_MIST }, () => ({ active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, maxLife: 0.3, size: 0.2 }))
const pendingSplats: { pos: THREE.Vector3; normal: THREE.Vector3; size: number }[] = []
let nextDrop = 0
let nextMist = 0
let nextSplat = 0

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const DOWN = new THREE.Vector3(0, -1, 0)

export const blood = {
  /**
   * Inslag in vlees: een spetter naar achteren (uit het wondje), een uittredende straal in de
   * schietrichting, nevel, en spatten op de muur erachter en op de vloer.
   */
  spray(pos: THREE.Vector3, dir: THREE.Vector3, amount = 1) {
    const back = dir.clone().multiplyScalar(-1)
    const floor = raycast(pos, DOWN, 3, { ignoreEnemies: true })
    const floorY = floor ? floor.point.y : pos.y - 1.6
    const tmp = new THREE.Vector3()
    const n = Math.round(14 + 22 * Math.min(2, amount))
    for (let i = 0; i < n; i++) {
      const d = drops[nextDrop]
      nextDrop = (nextDrop + 1) % MAX_DROPS
      const forward = i % 3 !== 0
      const base = forward ? dir : back
      tmp.set(rand(-1, 1), rand(-0.6, 1), rand(-1, 1)).multiplyScalar(forward ? 0.35 : 0.7)
      d.active = true
      d.pos.copy(pos)
      d.vel.copy(base).add(tmp).normalize().multiplyScalar(rand(1.5, forward ? 6.5 : 3.5))
      d.life = rand(0.6, 1.4)
      d.size = rand(0.006, 0.02) * (forward ? 1 : 0.8)
      d.floorY = floorY
      d.stain = Math.random() < 0.25
    }
    for (let i = 0; i < 3; i++) {
      const m = mists[nextMist]
      nextMist = (nextMist + 1) % MAX_MIST
      m.active = true
      m.pos.copy(pos)
      m.vel.copy(i === 0 ? back : dir).multiplyScalar(rand(0.6, 1.4)).add(tmp.set(rand(-0.3, 0.3), rand(-0.1, 0.3), rand(-0.3, 0.3)))
      m.maxLife = m.life = rand(0.18, 0.35)
      m.size = rand(0.12, 0.22) * Math.min(1.6, 0.7 + amount * 0.4)
    }
    // spat op de muur achter het slachtoffer (de uittredende straal)
    const wall = raycast(pos, dir, 2.5, { ignoreEnemies: true })
    if (wall) pendingSplats.push({ pos: wall.point.addScaledVector(wall.normal, 0.008), normal: wall.normal.clone(), size: rand(0.35, 0.6) * Math.min(1.5, 0.6 + amount * 0.4) })
    // en een plas onder de voeten bij een flinke treffer
    if (floor && amount >= 1.2) pendingSplats.push({ pos: floor.point.addScaledVector(floor.normal, 0.006), normal: floor.normal.clone(), size: rand(0.4, 0.8) * Math.min(1.6, amount * 0.5) })
  },

  /** Een losse vlek (bijv. een plas onder een gevallen patiënt). */
  splat(pos: THREE.Vector3, normal: THREE.Vector3, size: number) {
    pendingSplats.push({ pos: pos.clone().addScaledVector(normal, 0.006), normal: normal.clone(), size })
  },
}

function reset() {
  drops.forEach((d) => (d.active = false))
  mists.forEach((m) => (m.active = false))
  pendingSplats.length = 0
}

/** Atlas van vier bloedspatten (wit met alfa; de kleur komt van het materiaal). */
function splatAtlas() {
  const S = 512
  const c = document.createElement('canvas')
  c.width = c.height = S
  const ctx = c.getContext('2d')!
  const half = S / 2
  for (let k = 0; k < 4; k++) {
    const ox = (k % 2) * half + half / 2
    const oy = Math.floor(k / 2) * half + half / 2
    ctx.save()
    ctx.beginPath()
    ctx.rect(ox - half / 2, oy - half / 2, half, half)
    ctx.clip()
    const blob = (x: number, y: number, r: number, a: number) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, `rgba(255,255,255,${a})`)
      g.addColorStop(0.75, `rgba(255,255,255,${a})`)
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    // kern: een cluster van overlappende vlekken
    for (let i = 0; i < 14; i++) blob(ox + rand(-30, 30), oy + rand(-30, 30), rand(14, 34), rand(0.75, 0.95))
    // stralen met druppels aan het eind (spat van een kogel)
    const rays = 9 + k * 3
    for (let i = 0; i < rays; i++) {
      const a = rand(0, Math.PI * 2)
      const len = rand(40, 115)
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      ctx.lineCap = 'round'
      for (let s = 0; s < 6; s++) {
        const t0 = s / 6
        const t1 = (s + 1) / 6
        ctx.lineWidth = 6 * (1 - t0) + 1
        ctx.beginPath()
        ctx.moveTo(ox + Math.cos(a) * len * t0, oy + Math.sin(a) * len * t0)
        ctx.lineTo(ox + Math.cos(a) * len * t1, oy + Math.sin(a) * len * t1)
        ctx.stroke()
      }
      blob(ox + Math.cos(a) * len, oy + Math.sin(a) * len, rand(3, 7), 0.9)
    }
    // losse spetters
    for (let i = 0; i < 40; i++) {
      const a = rand(0, Math.PI * 2)
      const d = rand(30, 120)
      blob(ox + Math.cos(a) * d, oy + Math.sin(a) * d, rand(1.5, 4.5), 0.9)
    }
    ctx.restore()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** Zacht rond vlekje voor druppels en nevel. */
function dropTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.85)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

export function BloodFX() {
  const camera = useThree((s) => s.camera)
  const dropMesh = useRef<THREE.InstancedMesh>(null)
  const mistMesh = useRef<THREE.InstancedMesh>(null)
  const splatMesh = useRef<THREE.InstancedMesh>(null)

  const { dropTex, splatMat, atlasAttr, splatGeo } = useMemo(() => {
    const atlasAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPLATS * 2), 2)
    const splatMat = new THREE.MeshStandardMaterial({
      color: 0x3a0202,
      map: splatAtlas(),
      transparent: true,
      roughness: 0.42,
      envMapIntensity: 0.25,
      metalness: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    })
    // elke spat een eigen vakje uit de atlas
    splatMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aAtlas;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vMapUv * 0.5 + aAtlas;')
    }
    splatMat.customProgramCacheKey = () => 'blood-splat-v1'
    const splatGeo = new THREE.PlaneGeometry(1, 1)
    splatGeo.setAttribute('aAtlas', atlasAttr)
    return { dropTex: dropTexture(), splatMat, atlasAttr, splatGeo }
  }, [])

  useEffect(() => {
    reset()
    const zero = new THREE.Matrix4().makeScale(0, 0, 0)
    for (const m of [dropMesh.current, mistMesh.current, splatMesh.current]) {
      if (!m) continue
      for (let i = 0; i < m.count; i++) m.setMatrixAt(i, zero)
      m.instanceMatrix.needsUpdate = true
    }
    nextSplat = 0
    return () => {
      splatGeo.dispose()
      splatMat.map?.dispose()
      splatMat.dispose()
      dropTex.dispose()
    }
  }, [splatGeo, splatMat, dropTex])

  const tmp = useMemo(
    () => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), z: new THREE.Vector3(0, 0, 1), axis: new THREE.Vector3(), side: new THREE.Vector3(), view: new THREE.Vector3(), roll: new THREE.Quaternion() }),
    [],
  )

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const dm = dropMesh.current
    if (dm) {
      for (let i = 0; i < MAX_DROPS; i++) {
        const d = drops[i]
        if (d.active) {
          d.life -= dt
          d.vel.y -= 9.8 * dt
          d.pos.addScaledVector(d.vel, dt)
          if (d.pos.y <= d.floorY + 0.005) {
            d.active = false
            if (d.stain) pendingSplats.push({ pos: new THREE.Vector3(d.pos.x, d.floorY + 0.006, d.pos.z), normal: new THREE.Vector3(0, 1, 0), size: rand(0.06, 0.14) })
          } else if (d.life <= 0) d.active = false
        }
        if (!d.active) {
          tmp.m.makeScale(0, 0, 0)
          dm.setMatrixAt(i, tmp.m)
          continue
        }
        // uitgerekt langs de snelheid (bewegingsonscherpte), plat naar de camera
        const speed = d.vel.length()
        tmp.axis.copy(d.vel).divideScalar(speed || 1)
        tmp.view.subVectors(camera.position, d.pos).normalize()
        tmp.side.crossVectors(tmp.axis, tmp.view).normalize()
        const len = d.size * (1 + speed * 0.9)
        tmp.view.crossVectors(tmp.side, tmp.axis)
        tmp.m.makeBasis(tmp.side.multiplyScalar(d.size), tmp.axis.multiplyScalar(len), tmp.view)
        tmp.m.setPosition(d.pos)
        dm.setMatrixAt(i, tmp.m)
      }
      dm.instanceMatrix.needsUpdate = true
    }

    const mm = mistMesh.current
    if (mm) {
      for (let i = 0; i < MAX_MIST; i++) {
        const m = mists[i]
        if (m.active) {
          m.life -= dt
          if (m.life <= 0) m.active = false
        }
        if (!m.active) {
          tmp.m.makeScale(0, 0, 0)
          mm.setMatrixAt(i, tmp.m)
          continue
        }
        m.pos.addScaledVector(m.vel, dt)
        m.vel.multiplyScalar(Math.max(0, 1 - dt * 4))
        const k = 1 - m.life / m.maxLife
        const s = m.size * (0.5 + k * 1.2)
        tmp.m.compose(m.pos, camera.quaternion, tmp.s.set(s, s, s))
        mm.setMatrixAt(i, tmp.m)
      }
      mm.instanceMatrix.needsUpdate = true
    }

    const sm = splatMesh.current
    if (sm && pendingSplats.length) {
      for (const p of pendingSplats) {
        tmp.q.setFromUnitVectors(tmp.z, p.normal)
        tmp.roll.setFromAxisAngle(tmp.z, Math.random() * Math.PI * 2)
        tmp.q.multiply(tmp.roll)
        tmp.m.compose(p.pos, tmp.q, tmp.s.set(p.size, p.size, p.size))
        sm.setMatrixAt(nextSplat, tmp.m)
        const k = Math.floor(Math.random() * 4)
        atlasAttr.setXY(nextSplat, (k % 2) * 0.5, Math.floor(k / 2) * 0.5)
        nextSplat = (nextSplat + 1) % MAX_SPLATS
      }
      pendingSplats.length = 0
      sm.instanceMatrix.needsUpdate = true
      atlasAttr.needsUpdate = true
    }
  })

  return (
    <>
      <instancedMesh ref={dropMesh} args={[undefined, undefined, MAX_DROPS]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={dropTex} color={[0.16, 0.005, 0.005]} transparent depthWrite={false} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={mistMesh} args={[undefined, undefined, MAX_MIST]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={dropTex} color={[0.12, 0.008, 0.008]} transparent opacity={0.22} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={splatMesh} args={[splatGeo, splatMat, MAX_SPLATS]} frustumCulled={false} receiveShadow />
    </>
  )
}
