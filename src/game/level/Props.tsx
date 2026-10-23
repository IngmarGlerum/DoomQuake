import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Lighting } from '../render/lighting'
import { buildProps } from '../render/props'
import { getTextures } from '../render/textures'
import type { Level } from './types'

/** Decor van de grotbasis: kasten, terminals, kooien, pijpen... met knipperende ledjes en schermen. */
export function Props({ level, lighting }: { level: Level; lighting: Lighting }) {
  const build = useMemo(() => (level.props?.length ? buildProps(level, lighting) : null), [level, lighting])
  const leds = useRef<THREE.InstancedMesh>(null)
  const screenMat = useRef<THREE.MeshBasicMaterial>(null)
  const screenTex = useMemo(() => {
    const t = getTextures().screen.clone()
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.needsUpdate = true
    return t
  }, [])

  useEffect(
    () => () => {
      build?.solid?.dispose()
      build?.glow?.dispose()
      build?.screens?.dispose()
    },
    [build],
  )

  // ledjes plaatsen
  useEffect(() => {
    const m = leds.current
    if (!m || !build) return
    const mat = new THREE.Matrix4()
    build.leds.forEach((l, i) => {
      mat.makeTranslation(l.pos.x, l.pos.y, l.pos.z)
      m.setMatrixAt(i, mat)
      m.setColorAt(i, l.color)
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [build])

  const tick = useRef(0)
  const color = useMemo(() => new THREE.Color(), [])
  useFrame(({ clock }, delta) => {
    if (!build) return
    // schermen: tekst scrolt langzaam en het beeld flikkert een beetje
    screenTex.offset.y -= delta * 0.04
    if (screenMat.current) {
      const f = 0.85 + Math.random() * 0.15 + (Math.random() < 0.01 ? -0.4 : 0)
      screenMat.current.color.setRGB(f * 1.3, f * 1.3, f * 1.3)
    }
    // ledjes: niet elke frame, dat scheelt werk
    tick.current += delta
    const m = leds.current
    if (!m || tick.current < 0.05) return
    tick.current = 0
    const t = clock.elapsedTime
    build.leds.forEach((l, i) => {
      const on = l.rate === 0 ? true : (t * l.rate + l.phase) % 1 < l.duty
      color.copy(l.color).multiplyScalar(on ? 1.8 : 0.12)
      m.setColorAt(i, color)
    })
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })

  if (!build) return null
  return (
    <>
      {build.solid && (
        <mesh geometry={build.solid}>
          <meshBasicMaterial vertexColors />
        </mesh>
      )}
      {build.glow && (
        <mesh geometry={build.glow}>
          <meshBasicMaterial vertexColors toneMapped={false} />
        </mesh>
      )}
      {build.screens && (
        <mesh geometry={build.screens}>
          <meshBasicMaterial ref={screenMat} map={screenTex} toneMapped={false} />
        </mesh>
      )}
      {build.leds.length > 0 && (
        <instancedMesh ref={leds} args={[undefined, undefined, build.leds.length]} frustumCulled={false}>
          <boxGeometry args={[0.035, 0.025, 0.02]} />
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
      )}
      <RigidBody type="fixed" colliders={false}>
        {build.colliders.map((c, i) => (
          <CuboidCollider key={i} args={c.half} position={c.pos} rotation={[0, c.rot, 0]} />
        ))}
      </RigidBody>
    </>
  )
}
