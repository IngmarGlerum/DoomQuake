import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { sfx } from '../audio'
import { runtime } from '../combat/runtime'
import type { Lighting } from '../render/lighting'
import { getTextures } from '../render/textures'
import { player } from '../store'
import { CELL, type Level } from './types'

const OPEN_DISTANCE = 3.4
const OPEN_TIME = 0.35
const CLOSE_TIME = 0.6
const CLOSE_DELAY = 0.8
const PANEL_THICKNESS = 0.22
const LINTEL = 0.35

interface Panel {
  x: number
  z: number
  /** richting waarin het paneel de muur in schuift */
  dx: number
  dz: number
}

interface DoorGroup {
  id: number
  /** schuifrichting: panelen staan langs deze as */
  axis: 'x' | 'z'
  panels: Panel[]
  floor: number
  height: number
  cx: number
  cz: number
  /** uiterste randen van de opening langs de as (wereld) */
  min: number
  max: number
}

/** Zoek aaneengesloten schuifdeurcellen en bepaal per opening hoe de panelen moeten schuiven. */
function findGroups(level: Level): DoorGroup[] {
  const { width, height, cells } = level
  const seen = new Set<number>()
  const groups: DoorGroup[] = []
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i].slide || seen.has(i)) continue
    const members: number[] = []
    const stack = [i]
    seen.add(i)
    while (stack.length) {
      const j = stack.pop()!
      members.push(j)
      const x = j % width
      const y = Math.floor(j / width)
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const k = ny * width + nx
        if (cells[k].slide && !seen.has(k)) {
          seen.add(k)
          stack.push(k)
        }
      }
    }
    const xs = members.map((j) => j % width)
    const ys = members.map((j) => Math.floor(j / width))
    let axis: 'x' | 'z'
    if (new Set(xs).size > 1) axis = 'x'
    else if (new Set(ys).size > 1) axis = 'z'
    else {
      // één cel: schuif loodrecht op de doorgang
      const x = xs[0]
      const y = ys[0]
      const roomEW = [x + 1, x - 1].some((nx) => cells[y * width + nx]?.room >= 0)
      axis = roomEW ? 'z' : 'x'
    }
    const cx = ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * CELL
    const cz = ((Math.min(...ys) + Math.max(...ys) + 1) / 2) * CELL
    const floor = Math.max(...members.map((j) => cells[j].floor))
    const ceil = Math.min(...members.map((j) => cells[j].ceil))
    const panels = members.map((j) => {
      const px = ((j % width) + 0.5) * CELL
      const pz = (Math.floor(j / width) + 0.5) * CELL
      const along = axis === 'x' ? px - cx : pz - cz
      const sign = along === 0 ? 1 : Math.sign(along)
      return { x: px, z: pz, dx: axis === 'x' ? sign : 0, dz: axis === 'z' ? sign : 0 }
    })
    const min = axis === 'x' ? Math.min(...xs) * CELL : Math.min(...ys) * CELL
    const max = axis === 'x' ? (Math.max(...xs) + 1) * CELL : (Math.max(...ys) + 1) * CELL
    groups.push({ id: i, axis, panels, floor, height: ceil - floor, cx, cz, min, max })
  }
  return groups
}

/** Automatische schuifdeuren met een zwart-geel gestreept kozijn. */
export function SlideDoors({ level, lighting }: { level: Level; lighting: Lighting }) {
  const groups = useMemo(() => findGroups(level), [level])
  if (!groups.length) return null
  return (
    <>
      {groups.map((g) => (
        <SlideDoor key={g.id} group={g} lighting={lighting} />
      ))}
    </>
  )
}

function SlideDoor({ group: g, lighting }: { group: DoorGroup; lighting: Lighting }) {
  const bodies = useRef<(RapierRigidBody | null)[]>([])
  const state = useRef({ open: 0, target: 0, idle: 0 })
  const tint = useMemo(() => new THREE.Color(...lighting.sample(g.cx, g.floor + 1.5, g.cz)).addScalar(0.12), [lighting, g])
  const panelHeight = g.height - LINTEL
  const baseY = g.floor + panelHeight / 2

  const textures = useMemo(() => {
    const t = getTextures()
    const hazard = (rx: number, ry: number) => {
      const h = t.hazard.clone()
      h.wrapS = h.wrapT = THREE.RepeatWrapping
      h.repeat.set(rx, ry)
      h.needsUpdate = true
      return h
    }
    const span = g.max - g.min
    return { door: t.slidedoor, post: hazard(1, g.height / 0.6), lintel: hazard(span / 0.6, 1), sill: hazard(span / 0.6, 0.5) }
  }, [g])

  useFrame((_, delta) => {
    const s = state.current
    // open voor de speler en (later) voor vijanden in de buurt
    const near = (x: number, y: number, z: number) => Math.hypot(x - g.cx, z - g.cz) < OPEN_DISTANCE && Math.abs(y - g.floor) < 3
    let someone = near(player.position.x, player.position.y, player.position.z)
    if (!someone) {
      for (const e of runtime.enemyByCollider.values()) {
        if (e.state !== 'dead' && near(e.pos.x, e.pos.y, e.pos.z)) {
          someone = true
          break
        }
      }
    }
    if (someone) {
      s.idle = 0
      if (s.target !== 1) {
        s.target = 1
        sfx.slideOpen({ x: g.cx, z: g.cz })
      }
    } else if (s.target === 1) {
      s.idle += delta
      if (s.idle > CLOSE_DELAY) {
        s.target = 0
        sfx.slideClose({ x: g.cx, z: g.cz })
      }
    }
    const before = s.open
    if (s.open < s.target) s.open = Math.min(1, s.open + delta / OPEN_TIME)
    else if (s.open > s.target) s.open = Math.max(0, s.open - delta / CLOSE_TIME)
    if (s.open === before) return
    // ease-in-out
    const k = s.open * s.open * (3 - 2 * s.open)
    g.panels.forEach((p, i) => {
      bodies.current[i]?.setNextKinematicTranslation({ x: p.x + p.dx * CELL * 0.96 * k, y: baseY, z: p.z + p.dz * CELL * 0.96 * k })
    })
  })

  const along = (len: number, thick: number): [number, number] => (g.axis === 'x' ? [len, thick] : [thick, len])
  const [pw, pd] = along(CELL, PANEL_THICKNESS)
  const span = g.max - g.min
  const [lw, ld] = along(span + 0.6, 0.5)
  const [sw, sd] = along(span, 0.55)
  const postAt = (edge: number): [number, number, number] =>
    g.axis === 'x' ? [edge, g.floor + g.height / 2, g.cz] : [g.cx, g.floor + g.height / 2, edge]
  const [postW, postD] = along(0.3, 0.55)

  return (
    <>
      {g.panels.map((p, i) => (
        <RigidBody
          key={i}
          ref={(b) => {
            bodies.current[i] = b
          }}
          type="kinematicPosition"
          colliders={false}
          position={[p.x, baseY, p.z]}
        >
          <CuboidCollider args={[pw / 2, panelHeight / 2, pd / 2]} />
          <mesh>
            <boxGeometry args={[pw, panelHeight, pd]} />
            <meshBasicMaterial map={textures.door} color={tint} />
          </mesh>
        </RigidBody>
      ))}

      {/* kozijn: twee stijlen, een bovenbalk en een drempel met gevarenstrepen */}
      {[g.min, g.max].map((edge, i) => (
        <mesh key={i} position={postAt(edge)}>
          <boxGeometry args={[postW, g.height, postD]} />
          <meshBasicMaterial map={textures.post} color={tint} />
        </mesh>
      ))}
      <mesh position={[g.cx, g.floor + g.height - LINTEL / 2, g.cz]}>
        <boxGeometry args={[lw, LINTEL, ld]} />
        <meshBasicMaterial map={textures.lintel} color={tint} />
      </mesh>
      <mesh position={[g.cx, g.floor + 0.015, g.cz]}>
        <boxGeometry args={[sw, 0.03, sd]} />
        <meshBasicMaterial map={textures.sill} color={tint} />
      </mesh>
    </>
  )
}
