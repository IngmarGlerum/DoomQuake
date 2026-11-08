import { sfx } from '../audio'

/** Zaklamp (gesticht): aan bij de start, met L of □ op de controller aan/uit. */
export const flashlight = {
  on: true,
  toggle() {
    flashlight.on = !flashlight.on
    sfx.click()
  },
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyL' && !e.repeat) flashlight.toggle()
  })
}
