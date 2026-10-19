import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import type * as THREE from 'three'
import { sfx } from '../audio'
import type { Lighting, RGB } from '../render/lighting'
import { pickupGeometry } from '../render/models'
import { player, useGame } from '../store'
import { clearDrops, dropVersion, drops, type Drop } from './drops'

const GRAVITY = 12
const PICKUP_RADIUS = 1.1

/** Toont en verwerkt de pickups die verslagen vijanden laten vallen. */
export function Drops({ lighting }: { lighting: Lighting }) {
  const [, setVersion] = useState(0)
  const seen = useRef(-1)

  useEffect(() => clearDrops(), [])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    let changed = seen.current !== dropVersion.value
    for (const d of drops) {
      if (d.taken) continue
      if (!d.landed) {
        d.vel.y -= GRAVITY * dt
        d.pos.addScaledVector(d.vel, dt)
        if (d.pos.y <= d.floor && d.vel.y < 0) {
          d.pos.y = d.floor
          d.landed = true
        }
        continue
      }
      const near =
        Math.hypot(player.position.x - d.pos.x, player.position.z - d.pos.z) < PICKUP_RADIUS &&
        Math.abs(player.position.y - d.pos.y) < 1.5
      if (near && useGame.getState().pickup(d.kind)) {
        d.taken = true
        sfx.pickup()
        changed = true
      }
    }
    if (changed) {
      // opgepakte drops opruimen en opnieuw renderen
      for (let i = drops.length - 1; i >= 0; i--) if (drops[i].taken) drops.splice(i, 1)
      seen.current = dropVersion.value
      setVersion((v) => v + 1)
    }
  })

  return (
    <>
      {drops.map((d) => (
        <DropMesh key={d.id} drop={d} lighting={lighting} />
      ))}
    </>
  )
}

function DropMesh({ drop, lighting }: { drop: Drop; lighting: Lighting }) {
  const ref = useRef<THREE.Mesh>(null)
  const light = useRef<RGB>([0, 0, 0])
  const geometry = drop.kind === 'rocket' ? pickupGeometry.rocketAmmo() : pickupGeometry[drop.kind]()

  useFrame(({ clock }) => {
    const m = ref.current
    if (!m) return
    m.position.copy(drop.pos)
    if (drop.landed) m.position.y += 0.05 + Math.sin(clock.elapsedTime * 3 + drop.id) * 0.05
    m.rotation.y = clock.elapsedTime * 2 + drop.id
    m.scale.setScalar(1.4)
    lighting.sample(drop.pos.x, drop.pos.y + 0.5, drop.pos.z, undefined, light.current)
    // iets oplichten zodat drops opvallen in donkere hoeken
    const c = light.current
    ;(m.material as THREE.MeshBasicMaterial).color.setRGB(c[0] + 0.35, c[1] + 0.35, c[2] + 0.35)
  })

  return (
    <mesh ref={ref} geometry={geometry}>
      <meshBasicMaterial vertexColors />
    </mesh>
  )
}
