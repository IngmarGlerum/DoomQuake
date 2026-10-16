/** Globale keyboard-state (op KeyboardEvent.code), los van React. */
const down = new Set<string>()

window.addEventListener('keydown', (e) => down.add(e.code))
window.addEventListener('keyup', (e) => down.delete(e.code))
window.addEventListener('blur', () => down.clear())

export const isDown = (...codes: string[]) => codes.some((c) => down.has(c))

export function readMoveInput() {
  const forward = (isDown('KeyW', 'ArrowUp') ? 1 : 0) - (isDown('KeyS', 'ArrowDown') ? 1 : 0)
  const strafe = (isDown('KeyD', 'ArrowRight') ? 1 : 0) - (isDown('KeyA', 'ArrowLeft') ? 1 : 0)
  return { forward, strafe, jump: isDown('Space'), down: isDown('ControlLeft', 'KeyC') }
}
