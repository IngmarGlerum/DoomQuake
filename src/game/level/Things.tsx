import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { sfx } from '../audio'
import type { Lighting } from '../render/lighting'
import { enemyGeometry, pickupGeometry } from '../render/models'
import { getTextures } from '../render/textures'
import { player, useGame } from '../store'
import type { Level, Thing } from './types'

const near = (t: Thing, radius: number) =>
  Math.hypot(player.position.x - t.x, player.position.z - t.z) < radius && Math.abs(player.position.y - t.y) < 1.5

export function Things({ level, lighting }: { level: Level; lighting: Lighting }) {
  return (
    <>
      {level.things.map((t, i) => {
        switch (t.kind) {
          case 'enemy':
            return <Enemy key={i} thing={t} lighting={lighting} />
          case 'key':
            return <Key key={i} thing={t} />
          case 'exit':
            return <Exit key={i} thing={t} lighting={lighting} />
          default:
            return <Pickup key={i} thing={t} lighting={lighting} />
        }
      })}
    </>
  )
}

const useTint = (lighting: Lighting, t: Thing) =>
  useMemo(() => new THREE.Color(...lighting.sample(t.x, t.y + 1, t.z)), [lighting, t])

/** Vijanden zijn voorlopig nog statisch: ze draaien alleen naar je toe. */
function Enemy({ thing, lighting }: { thing: Thing; lighting: Lighting }) {
  const ref = useRef<THREE.Mesh>(null)
  const tint = useTint(lighting, thing)
  const phase = (thing.x * 7.13 + thing.z * 3.71) % (Math.PI * 2)

  useFrame(({ clock }) => {
    const m = ref.current
    if (!m) return
    const dx = player.position.x - thing.x
    const dz = player.position.z - thing.z
    if (dx * dx + dz * dz < 25 * 25) {
      const target = Math.atan2(-dx, -dz)
      let diff = target - m.rotation.y
      diff = Math.atan2(Math.sin(diff), Math.cos(diff))
      m.rotation.y += diff * 0.05
    }
    m.position.y = thing.y + Math.abs(Math.sin(clock.elapsedTime * 2 + phase)) * 0.03
  })

  return (
    <mesh ref={ref} geometry={enemyGeometry(thing.enemy ?? 'grunt')} position={[thing.x, thing.y, thing.z]}>
      <meshBasicMaterial vertexColors color={tint} />
    </mesh>
  )
}

function Pickup({ thing, lighting }: { thing: Thing; lighting: Lighting }) {
  const kind = thing.kind as 'health' | 'ammo' | 'armor'
  const ref = useRef<THREE.Mesh>(null)
  const [taken, setTaken] = useState(false)
  const tint = useTint(lighting, thing)

  useFrame(({ clock }) => {
    if (taken || !ref.current) return
    ref.current.rotation.y = clock.elapsedTime * 1.5
    if (near(thing, 1.1) && useGame.getState().pickup(kind)) {
      sfx.pickup()
      setTaken(true)
    }
  })

  if (taken) return null
  return (
    <mesh ref={ref} geometry={pickupGeometry[kind]()} position={[thing.x, thing.y + 0.05, thing.z]}>
      <meshBasicMaterial vertexColors color={tint} />
    </mesh>
  )
}

function Key({ thing }: { thing: Thing }) {
  const ref = useRef<THREE.Mesh>(null)
  const hasKey = useGame((s) => s.hasKey)

  useFrame(({ clock }) => {
    if (hasKey || !ref.current) return
    ref.current.rotation.y = clock.elapsedTime * 2.5
    ref.current.position.y = thing.y + 0.7 + Math.sin(clock.elapsedTime * 3) * 0.1
    if (near(thing, 1.2)) {
      useGame.getState().takeKey()
      sfx.key()
    }
  })

  if (hasKey) return null
  return (
    <mesh ref={ref} geometry={pickupGeometry.key()} position={[thing.x, thing.y + 0.7, thing.z]}>
      <meshBasicMaterial vertexColors color={[1.6, 1.6, 1.6]} />
    </mesh>
  )
}

function Exit({ thing, lighting }: { thing: Thing; lighting: Lighting }) {
  const tint = useTint(lighting, thing)
  const done = useRef(false)

  useFrame(() => {
    if (done.current || !near(thing, 1.4)) return
    done.current = true
    sfx.exit()
    useGame.getState().win()
  })

  return (
    <group position={[thing.x, thing.y, thing.z]}>
      <mesh position={[0, 0.8, 0]}>
        <boxGeometry args={[0.8, 1.6, 0.8]} />
        <meshBasicMaterial map={getTextures().exit} color={tint.clone().multiplyScalar(1.5)} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.4, 8]} />
        <meshBasicMaterial color={[0.8, 0.1, 0.05]} />
      </mesh>
    </group>
  )
}
