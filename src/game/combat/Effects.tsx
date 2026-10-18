import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

/**
 * Visuele effecten met vaste pools (geen allocaties per schot):
 * - lichtsporen (tracers) die als streep van de loop naar de inslag vliegen
 * - deeltjes: vonken, stof, bloed, vuur
 * - kogelgaten op muren
 * - korte lichtflitsen bij inslag en mondingsvuur
 */
const MAX_TRACERS = 64
const MAX_PARTICLES = 700
const MAX_DECALS = 160
const MAX_FLASHES = 48

const TRACER_SPEED = 170
const TRACER_LENGTH = 7
const TRACER_WIDTH = 0.045

type Color3 = [number, number, number]

interface Tracer {
  active: boolean
  from: THREE.Vector3
  dir: THREE.Vector3
  dist: number
  t: number
  color: Color3
}

interface Particle {
  active: boolean
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  maxLife: number
  size: number
  gravity: number
  color: THREE.Color
  drag: number
}

interface Flash {
  active: boolean
  pos: THREE.Vector3
  life: number
  maxLife: number
  size: number
  color: Color3
}

const tracers: Tracer[] = Array.from({ length: MAX_TRACERS }, () => ({
  active: false,
  from: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  dist: 0,
  t: 0,
  color: [1, 1, 1],
}))
const particles: Particle[] = Array.from({ length: MAX_PARTICLES }, () => ({
  active: false,
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  life: 0,
  maxLife: 1,
  size: 0.05,
  gravity: 0,
  color: new THREE.Color(),
  drag: 0,
}))
const flashes: Flash[] = Array.from({ length: MAX_FLASHES }, () => ({
  active: false,
  pos: new THREE.Vector3(),
  life: 0,
  maxLife: 0.06,
  size: 1,
  color: [1, 1, 1],
}))
let nextTracer = 0
let nextParticle = 0
let nextFlash = 0
let nextDecal = 0
const pendingDecals: { pos: THREE.Vector3; normal: THREE.Vector3; size: number }[] = []

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const tmpColor = new THREE.Color()

function emit(
  pos: THREE.Vector3,
  dir: THREE.Vector3,
  count: number,
  o: { speed: [number, number]; spread: number; life: [number, number]; size: [number, number]; gravity: number; colors: Color3[]; drag?: number },
) {
  const tmp = new THREE.Vector3()
  for (let i = 0; i < count; i++) {
    const p = particles[nextParticle]
    nextParticle = (nextParticle + 1) % MAX_PARTICLES
    tmp.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(o.spread)
    p.active = true
    p.pos.copy(pos)
    p.vel.copy(dir).add(tmp).normalize().multiplyScalar(rand(...o.speed))
    p.maxLife = p.life = rand(...o.life)
    p.size = rand(...o.size)
    p.gravity = o.gravity
    p.drag = o.drag ?? 0
    const c = o.colors[Math.floor(Math.random() * o.colors.length)]
    p.color.setRGB(c[0], c[1], c[2])
  }
}

export const fx = {
  tracer(from: THREE.Vector3, to: THREE.Vector3, color: Color3) {
    const t = tracers[nextTracer]
    nextTracer = (nextTracer + 1) % MAX_TRACERS
    t.active = true
    t.from.copy(from)
    t.dir.subVectors(to, from)
    t.dist = t.dir.length()
    t.dir.normalize()
    t.t = 0
    t.color = color
  },

  flash(pos: THREE.Vector3, size: number, color: Color3, duration = 0.06) {
    const f = flashes[nextFlash]
    nextFlash = (nextFlash + 1) % MAX_FLASHES
    f.active = true
    f.pos.copy(pos)
    f.size = size
    f.color = color
    f.maxLife = f.life = duration
  },

  /** Kogel raakt muur/vloer: vonken, stofwolkje, flitsje en een kogelgat. */
  wallImpact(pos: THREE.Vector3, normal: THREE.Vector3, decal = true) {
    const out = pos.clone().addScaledVector(normal, 0.03)
    emit(out, normal, 12, { speed: [3, 10], spread: 0.9, life: [0.15, 0.4], size: [0.05, 0.1], gravity: 14, colors: [[2, 1.7, 0.6], [2, 1.2, 0.3], [1.6, 1.6, 1.2]] })
    emit(out, normal, 6, { speed: [0.4, 1.6], spread: 0.6, life: [0.4, 0.8], size: [0.1, 0.2], gravity: -0.5, drag: 2, colors: [[0.45, 0.42, 0.38], [0.3, 0.28, 0.25]] })
    fx.flash(out, 0.9, [2, 1.6, 0.7], 0.07)
    if (decal) pendingDecals.push({ pos: pos.clone().addScaledVector(normal, 0.012), normal: normal.clone(), size: rand(0.16, 0.24) })
  },

  /** Kogel raakt vijand: bloedspetters. */
  fleshImpact(pos: THREE.Vector3, dir: THREE.Vector3, amount = 1) {
    const back = dir.clone().negate()
    emit(pos, back, Math.round(10 * amount), { speed: [1.5, 5], spread: 0.9, life: [0.3, 0.7], size: [0.07, 0.14], gravity: 12, colors: [[0.7, 0.02, 0.02], [0.45, 0, 0], [0.9, 0.1, 0.05]] })
    emit(pos, dir, Math.round(5 * amount), { speed: [2, 6], spread: 0.5, life: [0.3, 0.6], size: [0.04, 0.08], gravity: 12, colors: [[0.6, 0, 0]] })
  },

  explosion(pos: THREE.Vector3, scale = 1) {
    const up = new THREE.Vector3(0, 1, 0)
    const n = (k: number) => Math.round(k * scale)
    emit(pos, up, n(40), { speed: [2 * scale, 8 * scale], spread: 2.5, life: [0.25, 0.6], size: [0.08 * scale, 0.2 * scale], gravity: 2, drag: 2.5, colors: [[2, 1.4, 0.3], [2, 0.8, 0.1], [1.6, 0.4, 0.05], [2, 1.9, 1]] })
    emit(pos, up, n(12), { speed: [0.5, 2 * scale], spread: 2, life: [0.6, 1.1 * scale], size: [0.15 * scale, 0.3 * scale], gravity: -1, drag: 1.5, colors: [[0.25, 0.22, 0.2], [0.15, 0.13, 0.12]] })
    if (scale > 1) {
      // rondvliegend puin met zwaartekracht
      emit(pos, up, n(10), { speed: [4, 11], spread: 1.6, life: [0.5, 1.0], size: [0.05, 0.1], gravity: 16, colors: [[0.35, 0.33, 0.3], [1.8, 0.9, 0.2]] })
    }
    fx.flash(pos, 3.5 * scale, [2, 1.2, 0.4], 0.15 * scale)
  },

  /** Rookspoor + vlammetje achter een raket. */
  rocketTrail(pos: THREE.Vector3, dir: THREE.Vector3) {
    const back = dir.clone().negate()
    emit(pos, back, 1, { speed: [1, 3], spread: 0.3, life: [0.06, 0.14], size: [0.08, 0.14], gravity: 0, colors: [[2, 1.5, 0.4], [2, 0.9, 0.2]] })
    emit(pos, back, 1, { speed: [0.1, 0.5], spread: 1, life: [0.6, 1.1], size: [0.12, 0.22], gravity: -0.6, drag: 1.2, colors: [[0.55, 0.53, 0.5], [0.4, 0.38, 0.36]] })
  },

  /** Rook/vonkjes uit een loop. */
  muzzleSmoke(pos: THREE.Vector3, dir: THREE.Vector3) {
    emit(pos, dir, 2, { speed: [0.3, 0.9], spread: 0.4, life: [0.2, 0.4], size: [0.04, 0.08], gravity: -1, drag: 3, colors: [[0.5, 0.48, 0.45]] })
  },

  /** Spoor van een vuurbal. */
  fireTrail(pos: THREE.Vector3) {
    emit(pos, new THREE.Vector3(0, 1, 0), 1, { speed: [0.1, 0.6], spread: 1, life: [0.15, 0.3], size: [0.08, 0.16], gravity: -2, drag: 2, colors: [[2, 0.9, 0.2], [1.8, 0.5, 0.05]] })
  },
}

/** Wist alle actieve effecten (bij een nieuw level). */
function resetEffects() {
  tracers.forEach((t) => (t.active = false))
  particles.forEach((p) => (p.active = false))
  flashes.forEach((f) => (f.active = false))
  pendingDecals.length = 0
}

/** Deeltjes dichter dan dit bij de camera worden niet getekend (anders vullen ze het scherm). */
const NEAR_CULL = 0.7

export function Effects() {
  const camera = useThree((s) => s.camera)
  const lines = useRef<THREE.LineSegments>(null)
  const beams = useRef<THREE.InstancedMesh>(null)
  const parts = useRef<THREE.InstancedMesh>(null)
  const decals = useRef<THREE.InstancedMesh>(null)
  const flashGroup = useRef<THREE.Group>(null)

  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_TRACERS * 6), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_TRACERS * 6), 3))
    return g
  }, [])
  const flashTexture = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 16
    const ctx = c.getContext('2d')!
    const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.4, 'rgba(255,255,255,0.6)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 16, 16)
    const t = new THREE.CanvasTexture(c)
    t.magFilter = THREE.NearestFilter
    return t
  }, [])

  useEffect(() => {
    resetEffects()
    const bm = beams.current
    if (bm) {
      const black = new THREE.Color(0, 0, 0)
      for (let i = 0; i < MAX_TRACERS; i++) {
        bm.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0))
        bm.setColorAt(i, black)
      }
    }
    const pm = parts.current
    if (pm) {
      // instanceColor vooraf aanmaken zodat de shader meteen met kleuren compileert
      const white = new THREE.Color(1, 1, 1)
      for (let i = 0; i < MAX_PARTICLES; i++) pm.setColorAt(i, white)
    }
    const m = decals.current
    if (!m) return
    const zero = new THREE.Matrix4().makeScale(0, 0, 0)
    for (let i = 0; i < MAX_DECALS; i++) m.setMatrixAt(i, zero)
    m.instanceMatrix.needsUpdate = true
    nextDecal = 0
  }, [])

  const tmp = useMemo(
    () => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), z: new THREE.Vector3(0, 0, 1), head: new THREE.Vector3(), tail: new THREE.Vector3() }),
    [],
  )

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)

    // tracers: een dun lijntje (altijd minstens 1 pixel) + een gloeiende balk
    const bm = beams.current
    const pos = lineGeo.getAttribute('position') as THREE.BufferAttribute
    const col = lineGeo.getAttribute('color') as THREE.BufferAttribute
    for (let i = 0; i < MAX_TRACERS; i++) {
      const t = tracers[i]
      if (t.active) {
        t.t += dt
        const travelled = t.t * TRACER_SPEED
        if (travelled - TRACER_LENGTH > t.dist) t.active = false
        else {
          tmp.head.copy(t.from).addScaledVector(t.dir, Math.min(travelled, t.dist))
          tmp.tail.copy(t.from).addScaledVector(t.dir, Math.max(0, Math.min(travelled - TRACER_LENGTH, t.dist)))
          pos.setXYZ(i * 2, tmp.tail.x, tmp.tail.y, tmp.tail.z)
          pos.setXYZ(i * 2 + 1, tmp.head.x, tmp.head.y, tmp.head.z)
          col.setXYZ(i * 2, t.color[0] * 0.15, t.color[1] * 0.15, t.color[2] * 0.15)
          col.setXYZ(i * 2 + 1, t.color[0], t.color[1], t.color[2])
          if (bm) {
            const len = tmp.head.distanceTo(tmp.tail)
            tmp.q.setFromUnitVectors(tmp.z, t.dir)
            tmp.s.set(TRACER_WIDTH, TRACER_WIDTH, Math.max(len, 0.01))
            tmp.m.compose(tmp.head.add(tmp.tail).multiplyScalar(0.5), tmp.q, tmp.s)
            bm.setMatrixAt(i, tmp.m)
            tmpColor.setRGB(t.color[0] * 0.8, t.color[1] * 0.8, t.color[2] * 0.8)
            bm.setColorAt(i, tmpColor)
          }
          continue
        }
      }
      pos.setXYZ(i * 2, 0, -1000, 0)
      pos.setXYZ(i * 2 + 1, 0, -1000, 0)
      if (bm) {
        tmp.m.makeScale(0, 0, 0)
        bm.setMatrixAt(i, tmp.m)
      }
    }
    if (bm) {
      bm.instanceMatrix.needsUpdate = true
      if (bm.instanceColor) bm.instanceColor.needsUpdate = true
    }
    pos.needsUpdate = true
    col.needsUpdate = true
    lineGeo.computeBoundingSphere()

    // deeltjes
    const pm = parts.current
    if (pm) {
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const p = particles[i]
        if (p.active) {
          p.life -= dt
          if (p.life <= 0) p.active = false
        }
        if (!p.active || p.pos.distanceToSquared(camera.position) < NEAR_CULL * NEAR_CULL) {
          if (p.active) p.pos.addScaledVector(p.vel, dt)
          tmp.m.makeScale(0, 0, 0)
          pm.setMatrixAt(i, tmp.m)
          continue
        }
        p.vel.y -= p.gravity * dt
        if (p.drag) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt))
        p.pos.addScaledVector(p.vel, dt)
        const s = p.size * (0.4 + 0.6 * (p.life / p.maxLife))
        tmp.m.makeScale(s, s, s).setPosition(p.pos)
        pm.setMatrixAt(i, tmp.m)
        pm.setColorAt(i, p.color)
      }
      pm.instanceMatrix.needsUpdate = true
      if (pm.instanceColor) pm.instanceColor.needsUpdate = true
    }

    // kogelgaten
    const dm = decals.current
    if (dm && pendingDecals.length) {
      for (const d of pendingDecals) {
        tmp.q.setFromUnitVectors(tmp.z, d.normal)
        tmp.s.set(d.size, d.size, d.size)
        tmp.m.compose(d.pos, tmp.q, tmp.s)
        dm.setMatrixAt(nextDecal, tmp.m)
        nextDecal = (nextDecal + 1) % MAX_DECALS
      }
      pendingDecals.length = 0
      dm.instanceMatrix.needsUpdate = true
    }

    // flitsen
    const fg = flashGroup.current
    if (fg) {
      fg.children.forEach((child, i) => {
        const f = flashes[i]
        const sprite = child as THREE.Sprite
        if (f.active) {
          f.life -= dt
          if (f.life <= 0) f.active = false
        }
        sprite.visible = f.active
        if (!f.active) return
        const k = f.life / f.maxLife
        sprite.position.copy(f.pos)
        sprite.scale.setScalar(f.size * (0.6 + 0.4 * k))
        ;(sprite.material as THREE.SpriteMaterial).color.setRGB(f.color[0] * k, f.color[1] * k, f.color[2] * k)
      })
    }
  })

  return (
    <>
      <instancedMesh ref={beams} args={[undefined, undefined, MAX_TRACERS]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial blending={THREE.AdditiveBlending} transparent depthWrite={false} fog={false} />
      </instancedMesh>
      <lineSegments ref={lines} geometry={lineGeo} frustumCulled={false}>
        <lineBasicMaterial vertexColors blending={THREE.AdditiveBlending} transparent depthWrite={false} fog={false} />
      </lineSegments>
      <instancedMesh ref={parts} args={[undefined, undefined, MAX_PARTICLES]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial />
      </instancedMesh>
      <instancedMesh ref={decals} args={[undefined, undefined, MAX_DECALS]} frustumCulled={false}>
        <circleGeometry args={[0.5, 6]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.85} polygonOffset polygonOffsetFactor={-2} depthWrite={false} />
      </instancedMesh>
      <group ref={flashGroup}>
        {flashes.map((_, i) => (
          <sprite key={i} visible={false}>
            <spriteMaterial map={flashTexture} blending={THREE.AdditiveBlending} transparent depthWrite={false} fog={false} />
          </sprite>
        ))}
      </group>
    </>
  )
}
