import { useFrame, useThree } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import type { Collider, KinematicCharacterController } from '@dimforge/rapier3d-compat'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { sfx } from '../audio'
import { runtime } from '../combat/runtime'
import { CELL, type Level } from '../level/types'
import { player, useGame } from '../store'
import { readMoveInput } from './input'
import { MOVE, accelerate, applyFriction } from './movement'

const RADIUS = 0.4
const HALF_HEIGHT = 0.5 // capsule: 2*0.5 + 2*0.4 = 1.8m
const CENTER_TO_FEET = HALF_HEIGHT + RADIUS
const EYE = 0.65 // oog boven het midden van de capsule (≈1.55m)
const DT = 1 / 120
const MAX_AUTOSTEP = 0.55

/**
 * Speler als losse collider + Rapier character controller. Movement draait op een
 * vaste tijdstap (120 Hz); de camera interpoleert tussen de laatste twee stappen.
 */
export function Player({ level }: { level: Level }) {
  const { world, rapier } = useRapier()
  const camera = useThree((s) => s.camera)
  const body = useRef<{ collider: Collider; controller: KinematicCharacterController } | null>(null)
  const sim = useRef({
    vel: { x: 0, y: 0, z: 0 },
    prev: new THREE.Vector3(),
    cur: new THREE.Vector3(),
    acc: 0,
    grounded: false,
    bob: 0,
    hurtTimer: 0,
  })

  useEffect(() => {
    const { spawn } = level
    const collider = world.createCollider(
      rapier.ColliderDesc.capsule(HALF_HEIGHT, RADIUS).setTranslation(spawn.x, spawn.y + CENTER_TO_FEET + 0.05, spawn.z),
    )
    const controller = world.createCharacterController(0.02)
    controller.enableAutostep(MAX_AUTOSTEP, 0.1, false)
    controller.enableSnapToGround(0.35)
    controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180)
    controller.setSlideEnabled(true)
    body.current = { collider, controller }
    runtime.world = world
    runtime.rapier = rapier
    runtime.playerCollider = collider

    const s = sim.current
    s.cur.set(spawn.x, spawn.y + CENTER_TO_FEET + 0.05, spawn.z)
    s.prev.copy(s.cur)
    s.vel = { x: 0, y: 0, z: 0 }
    camera.rotation.order = 'YXZ'
    camera.rotation.set(0, spawn.yaw, 0)

    // alleen in dev: teleporteren vanuit de console, handig om gegenereerde levels te inspecteren
    if (import.meta.env.DEV) {
      Object.assign(window, {
        __level: level,
        __player: player,
        __game: useGame,
        __teleport: (x: number, y: number, z: number, yaw = 0, pitch = 0) => {
          s.cur.set(x, y + CENTER_TO_FEET + 0.05, z)
          s.prev.copy(s.cur)
          collider.setTranslation(s.cur)
          camera.rotation.set(pitch, yaw, 0)
        },
      })
    }

    return () => {
      body.current = null
      if (runtime.playerCollider === collider) runtime.playerCollider = null
      try {
        world.removeCharacterController(controller)
        world.removeCollider(collider, false)
      } catch {
        // de physics-wereld is al opgeruimd
      }
    }
  }, [level, world, rapier, camera])

  const yawDir = new THREE.Euler()

  const step = (dt: number) => {
    const b = body.current
    if (!b) return
    const s = sim.current
    const game = useGame.getState()
    const input = game.status === 'playing' ? readMoveInput() : { forward: 0, strafe: 0, jump: false, down: false }

    yawDir.setFromQuaternion(camera.quaternion, 'YXZ')
    const yaw = yawDir.y
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    const rx = Math.cos(yaw)
    const rz = -Math.sin(yaw)

    if (game.noclip) {
      const dir = new THREE.Vector3()
      camera.getWorldDirection(dir)
      const right = new THREE.Vector3(rx, 0, rz)
      const move = dir.multiplyScalar(input.forward).add(right.multiplyScalar(input.strafe))
      move.y += (input.jump ? 1 : 0) - (input.down ? 1 : 0)
      if (move.lengthSq() > 0) move.normalize().multiplyScalar(MOVE.noclipSpeed * dt)
      s.cur.add(move)
      b.collider.setTranslation(s.cur)
      s.vel = { x: 0, y: 0, z: 0 }
      return
    }

    let wx = fx * input.forward + rx * input.strafe
    let wz = fz * input.forward + rz * input.strafe
    const len = Math.hypot(wx, wz)
    if (len > 0) {
      wx /= len
      wz /= len
    }
    const wishSpeed = len > 0 ? MOVE.maxSpeed : 0
    const v = s.vel

    if (s.grounded && input.jump) {
      v.y = MOVE.jumpSpeed
      s.grounded = false
      sfx.jump()
    }
    if (s.grounded) {
      applyFriction(v, dt)
      accelerate(v, wx, wz, wishSpeed, MOVE.accel, wishSpeed, dt)
    } else {
      accelerate(v, wx, wz, wishSpeed, MOVE.airAccel, MOVE.airCap, dt)
    }
    v.y -= MOVE.gravity * dt

    const desired = { x: v.x * dt, y: v.y * dt, z: v.z * dt }
    b.controller.computeColliderMovement(b.collider, desired)
    const m = b.controller.computedMovement()
    s.cur.set(s.cur.x + m.x, s.cur.y + m.y, s.cur.z + m.z)
    b.collider.setTranslation(s.cur)

    const wasGrounded = s.grounded
    s.grounded = b.controller.computedGrounded()
    if (s.grounded && v.y < 0) v.y = 0
    if (!s.grounded && v.y > 0 && m.y < desired.y - 1e-4) v.y = 0 // plafond geraakt
    // Snelheid clippen tegen muren (Quake-stijl), maar niet tegen traptreden:
    // contact onder autostep-hoogte laten we aan de autostep over.
    const feet = s.cur.y - CENTER_TO_FEET
    for (let i = 0; i < b.controller.numComputedCollisions(); i++) {
      const c = b.controller.computedCollision(i)
      if (!c || Math.abs(c.normal1.y) > 0.7 || c.witness1.y < feet + MAX_AUTOSTEP) continue
      const into = v.x * c.normal1.x + v.z * c.normal1.z
      if (into < 0) {
        v.x -= c.normal1.x * into
        v.z -= c.normal1.z * into
      }
    }
    if (!wasGrounded && s.grounded) s.bob = 0

    if (s.cur.y < -60) {
      s.cur.set(level.spawn.x, level.spawn.y + CENTER_TO_FEET + 0.05, level.spawn.z)
      b.collider.setTranslation(s.cur)
    }
  }

  useFrame((_, delta) => {
    const s = sim.current
    s.acc += Math.min(delta, 0.1)
    while (s.acc >= DT) {
      s.prev.copy(s.cur)
      step(DT)
      s.acc -= DT
    }
    const alpha = s.acc / DT
    camera.position.lerpVectors(s.prev, s.cur, alpha)

    const speed = Math.hypot(s.vel.x, s.vel.z)
    if (s.grounded) s.bob += delta * speed * 0.9
    camera.position.y += EYE + (s.grounded ? Math.sin(s.bob) * Math.min(speed / MOVE.maxSpeed, 1) * 0.06 : 0)

    // gedeelde spelerstate bijwerken voor HUD, minimap, pickups en deuren
    player.position.set(camera.position.x, s.cur.y - CENTER_TO_FEET, camera.position.z)
    yawDir.setFromQuaternion(camera.quaternion, 'YXZ')
    player.yaw = yawDir.y
    player.speed = speed
    player.grounded = s.grounded
    const cx = Math.floor(player.position.x / CELL)
    const cz = Math.floor(player.position.z / CELL)
    player.cell = cz * level.width + cx

    // nukage doet pijn
    const cell = level.cells[player.cell]
    if (cell?.liquid && player.position.y < cell.floor + 0.2 && !useGame.getState().noclip) {
      s.hurtTimer -= delta
      if (s.hurtTimer <= 0) {
        s.hurtTimer = 0.5
        useGame.getState().damage(5)
        sfx.hurt()
      }
    } else {
      s.hurtTimer = 0
    }
  })

  return null
}
