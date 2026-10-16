/**
 * Quake-achtige movement: grondwrijving + acceleratie richting de "wish direction",
 * met een lage snelheidscap in de lucht (air strafing werkt dus net als in Quake).
 * Alles in meters en seconden.
 */
export const MOVE = {
  maxSpeed: 10,
  accel: 10,
  airAccel: 10,
  airCap: 1.0,
  friction: 6,
  stopSpeed: 3,
  jumpSpeed: 6,
  gravity: 18,
  noclipSpeed: 16,
}

export interface Velocity {
  x: number
  y: number
  z: number
}

export function applyFriction(v: Velocity, dt: number) {
  const speed = Math.hypot(v.x, v.z)
  if (speed < 1e-4) {
    v.x = v.z = 0
    return
  }
  const drop = Math.max(speed, MOVE.stopSpeed) * MOVE.friction * dt
  const scale = Math.max(0, speed - drop) / speed
  v.x *= scale
  v.z *= scale
}

export function accelerate(v: Velocity, wishX: number, wishZ: number, wishSpeed: number, accel: number, cap: number, dt: number) {
  const current = v.x * wishX + v.z * wishZ
  const add = Math.min(wishSpeed, cap) - current
  if (add <= 0) return
  const a = Math.min(accel * dt * wishSpeed, add)
  v.x += a * wishX
  v.z += a * wishZ
}
