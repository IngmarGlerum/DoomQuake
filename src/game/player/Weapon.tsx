import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { sfx } from '../audio'
import type { Lighting } from '../render/lighting'
import { shotgunGeometry } from '../render/models'
import { player, useGame } from '../store'

/** Viewmodel van de shotgun: volgt de camera, met bob, terugslag en muzzle flash. Raken komt later. */
export function Weapon({ lighting }: { lighting: Lighting }) {
  const camera = useThree((s) => s.camera)
  const group = useRef<THREE.Group>(null)
  const gun = useRef<THREE.Mesh>(null)
  const flash = useRef<THREE.Mesh>(null)
  const state = useRef({ kick: 0, flash: 0, cooldown: 0, bob: 0 })
  const tint = useRef(new THREE.Color())
  const sample: [number, number, number] = [0, 0, 0]

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const game = useGame.getState()
      if (e.button !== 0 || !game.locked || state.current.cooldown > 0) return
      if (!game.fire()) {
        sfx.click()
        state.current.cooldown = 0.3
        return
      }
      sfx.shotgun()
      state.current.kick = 1
      state.current.flash = 0.06
      state.current.cooldown = 0.75
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [])

  useFrame((_, delta) => {
    const g = group.current
    if (!g || !gun.current || !flash.current) return
    const s = state.current
    s.cooldown = Math.max(0, s.cooldown - delta)
    s.kick = Math.max(0, s.kick - delta * 4)
    s.flash = Math.max(0, s.flash - delta)
    if (player.grounded) s.bob += delta * player.speed * 0.9
    const bobAmount = Math.min(player.speed / 10, 1)

    g.position.copy(camera.position)
    g.quaternion.copy(camera.quaternion)
    gun.current.position.set(
      0.22 + Math.cos(s.bob) * 0.025 * bobAmount,
      -0.24 + Math.abs(Math.sin(s.bob)) * 0.02 * bobAmount + s.kick * 0.04,
      -0.35 + s.kick * 0.12,
    )
    gun.current.rotation.x = s.kick * 0.35
    flash.current.visible = s.flash > 0

    lighting.sample(camera.position.x, camera.position.y, camera.position.z, undefined, sample)
    const boost = s.flash > 0 ? 1.2 : 0
    tint.current.setRGB(Math.min(1.4, sample[0] + 0.15 + boost), Math.min(1.4, sample[1] + 0.15 + boost), Math.min(1.4, sample[2] + 0.15 + boost))
    ;(gun.current.material as THREE.MeshBasicMaterial).color.copy(tint.current)
  })

  return (
    <group ref={group}>
      <mesh ref={gun} geometry={shotgunGeometry()} renderOrder={10}>
        <meshBasicMaterial vertexColors depthTest={false} fog={false} />
      </mesh>
      <mesh ref={flash} position={[0.22, -0.2, -1.05]} renderOrder={11} visible={false}>
        <octahedronGeometry args={[0.14, 0]} />
        <meshBasicMaterial color={[1.5, 1.2, 0.4]} depthTest={false} fog={false} />
      </mesh>
    </group>
  )
}
