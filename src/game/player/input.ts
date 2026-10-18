/** Globale input-state (toetsenbord + touch), los van React. */
const down = new Set<string>()

window.addEventListener('keydown', (e) => down.add(e.code))
window.addEventListener('keyup', (e) => down.delete(e.code))
window.addEventListener('blur', () => down.clear())

export const isDown = (...codes: string[]) => codes.some((c) => down.has(c))

/** Is dit een touch-apparaat (telefoon/tablet)? */
export const isTouchDevice =
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window)

/** Gevuld door de virtuele joystick en knoppen op mobiel. */
export const touch = {
  /** analoog, -1..1 */
  forward: 0,
  strafe: 0,
  jump: false,
}

/** Opgespaarde kijkbeweging in pixels (touch-slepen), elke frame door de Player verwerkt. */
export const look = { dx: 0, dy: 0 }

/** Vuurknop op mobiel: `held` zolang ingedrukt, `pressed` tot het schot is afgevuurd. */
export const fireButton = { held: false, pressed: false }

export function readMoveInput() {
  const keyForward = (isDown('KeyW', 'ArrowUp') ? 1 : 0) - (isDown('KeyS', 'ArrowDown') ? 1 : 0)
  const keyStrafe = (isDown('KeyD', 'ArrowRight') ? 1 : 0) - (isDown('KeyA', 'ArrowLeft') ? 1 : 0)
  return {
    forward: Math.max(-1, Math.min(1, keyForward + touch.forward)),
    strafe: Math.max(-1, Math.min(1, keyStrafe + touch.strafe)),
    jump: isDown('Space') || touch.jump,
    down: isDown('ControlLeft', 'KeyC'),
  }
}
