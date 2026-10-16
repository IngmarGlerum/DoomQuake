import { useFrame } from '@react-three/fiber'
import { RigidBody } from '@react-three/rapier'
import { useEffect, useMemo } from 'react'
import { buildLevelGeometry } from '../render/buildGeometry'
import type { Lighting } from '../render/lighting'
import { getTextures } from '../render/textures'
import type { Level } from './types'

export function LevelMesh({ level, lighting }: { level: Level; lighting: Lighting }) {
  const textures = getTextures()
  const geometries = useMemo(() => [...buildLevelGeometry(level, lighting)], [level, lighting])
  useEffect(() => () => geometries.forEach(([, g]) => g.dispose()), [geometries])

  // nukage laten stromen
  useFrame((_, delta) => {
    textures.liquid.offset.x += delta * 0.04
    textures.liquid.offset.y += delta * 0.025
  })

  return (
    <RigidBody type="fixed" colliders="trimesh">
      {geometries.map(([name, geometry]) => (
        <mesh key={name} geometry={geometry}>
          <meshBasicMaterial map={textures[name]} vertexColors />
        </mesh>
      ))}
    </RigidBody>
  )
}
