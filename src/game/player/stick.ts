/** Radiale dode zone met een zachte curve: kleine uitslag = fijn richten. */
export function stick(x: number, y: number, deadzone: number, exponent: number) {
  const mag = Math.min(1, Math.hypot(x, y))
  if (mag < deadzone) return { x: 0, y: 0, mag: 0 }
  const scaled = Math.pow((mag - deadzone) / (1 - deadzone), exponent)
  return { x: (x / mag) * scaled, y: (y / mag) * scaled, mag: scaled }
}
