import { useFrame } from '@react-three/fiber'
import { RigidBody } from '@react-three/rapier'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildLevelGeometry } from '../render/buildGeometry'
import type { Lighting } from '../render/lighting'
import { bakedMaterial } from '../render/bakedMaterial'
import { getPbr } from '../render/realisticTextures'
import { getTextures } from '../render/textures'
import type { Level } from './types'

export function LevelMesh({ level, lighting }: { level: Level; lighting: Lighting }) {
  const textures = getTextures()
  const geometries = useMemo(() => [...buildLevelGeometry(level, lighting)], [level, lighting])
  useEffect(() => () => geometries.forEach(([, g]) => g.dispose()), [geometries])
  // gesticht: realistische PBR-materialen (waar er een hoge-resolutie-versie van de texture is)
  const realistic = level.kind === 'asylum'
  const materials = useMemo(() => {
    if (!realistic) return null
    return new Map(
      geometries.map(([name]) => {
        const pbr = getPbr(name)
        return [
          name,
          pbr
            ? bakedMaterial({ map: pbr.map, normalMap: pbr.normal, normalScale: new THREE.Vector2(pbr.normalScale, pbr.normalScale), roughnessMap: pbr.rough, roughness: 1, metalness: pbr.metalness })
            : null,
        ] as const
      }),
    )
  }, [realistic, geometries])
  useEffect(() => () => materials?.forEach((m) => m?.dispose()), [materials])

  // nukage laten stromen
  useFrame((_, delta) => {
    textures.liquid.offset.x += delta * 0.04
    textures.liquid.offset.y += delta * 0.025
  })

  return (
    <RigidBody type="fixed" colliders="trimesh">
      {geometries.map(([name, geometry]) => {
        const mat = materials?.get(name)
        return mat ? (
          <mesh key={name} geometry={geometry} material={mat} receiveShadow castShadow />
        ) : (
          <mesh key={name} geometry={geometry}>
            <meshBasicMaterial map={textures[name]} vertexColors />
          </mesh>
        )
      })}
    </RigidBody>
  )
}
