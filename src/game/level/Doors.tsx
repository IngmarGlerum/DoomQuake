import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { sfx } from '../audio'
import type { Lighting } from '../render/lighting'
import { getTextures } from '../render/textures'
import { player, useGame } from '../store'
import { CELL, cellCenter, type Level } from './types'

const OPEN_DISTANCE = 3.2
const OPEN_SPEED = 2.5

/** Doom-deuren: blokken die omhoog het plafond in schuiven zodra je met de sleutel aankomt. */
export function Doors({ level, lighting }: { level: Level; lighting: Lighting }) {
  const doors = useMemo(
    () =>
      level.cells.flatMap((c, i) => {
        if (!c.door) return []
        const x = i % level.width
        const y = Math.floor(i / level.width)
        const { x: wx, z: wz } = cellCenter(x, y)
        return [{ id: i, x: wx, z: wz, floor: c.floor, height: c.ceil - c.floor }]
      }),
    [level],
  )
  // één gedeeld "deurgeluid/melding"-moment voor alle deurcellen
  const shared = useRef({ opening: false, deniedAt: 0 })

  useFrame(() => {
    const near = doors.some((d) => Math.hypot(player.position.x - d.x, player.position.z - d.z) < OPEN_DISTANCE)
    if (!near || shared.current.opening) return
    const game = useGame.getState()
    if (game.hasKey) {
      shared.current.opening = true
      sfx.door()
    } else if (performance.now() - shared.current.deniedAt > 2500) {
      shared.current.deniedAt = performance.now()
      game.say('Je hebt de rode sleutel nodig om deze deur te openen')
      sfx.denied()
    }
  })

  return (
    <>
      {doors.map((d) => (
        <Door key={d.id} {...d} lighting={lighting} shared={shared} />
      ))}
    </>
  )
}

function Door(props: {
  x: number
  z: number
  floor: number
  height: number
  lighting: Lighting
  shared: React.RefObject<{ opening: boolean }>
}) {
  const { x, z, floor, height, lighting, shared } = props
  const body = useRef<RapierRigidBody>(null)
  const offset = useRef(0)
  const tint = useMemo(() => new THREE.Color(...lighting.sample(x, floor + 1, z)), [lighting, x, floor, z])
  const baseY = floor + height / 2

  useFrame((_, delta) => {
    if (!shared.current.opening || offset.current >= height - 0.05) return
    offset.current = Math.min(height - 0.05, offset.current + OPEN_SPEED * delta)
    body.current?.setNextKinematicTranslation({ x, y: baseY + offset.current, z })
  })

  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[x, baseY, z]}>
      <CuboidCollider args={[CELL / 2, height / 2, CELL / 2]} />
      <mesh>
        <boxGeometry args={[CELL, height, CELL]} />
        <meshBasicMaterial map={getTextures().door} color={tint} />
      </mesh>
    </RigidBody>
  )
}
