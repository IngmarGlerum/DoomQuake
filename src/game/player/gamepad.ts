import { unlockAudio, sfx } from '../audio'
import { WEAPONS, type WeaponId } from '../combat/weapons'
import { toggleFullscreen } from '../fullscreen'
import { useGame } from '../store'
import { stick } from './stick'

/**
 * Gamepad-besturing (DualSense, Xbox en elke controller met de 'standard' indeling) via de
 * Gamepad API. Werkt ook in Safari op iPhone met een via Bluetooth verbonden controller.
 * Browsers tonen een controller pas aan de pagina na de eerste knopdruk.
 *
 * Wordt elke frame één keer gepold (vanuit de Player); de rest van het spel leest `pad`.
 */

// knopnummers in de standaard indeling (DualSense-namen)
const B = {
  cross: 0,
  circle: 1,
  square: 2,
  triangle: 3,
  l1: 4,
  r1: 5,
  l2: 6,
  r2: 7,
  share: 8,
  options: 9,
  l3: 10,
  r3: 11,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const

const MOVE_DEADZONE = 0.15
const LOOK_DEADZONE = 0.12
const TRIGGER_ON = 0.35
/** draaisnelheid bij volle uitslag (rad/s), horizontaal en verticaal */
const YAW_SPEED = 3.2
const PITCH_SPEED = 2.2
/** na zo lang volle uitslag draait de camera sneller (om je snel om te draaien) */
const BOOST_AFTER = 0.3
const BOOST = 1.6
/** met L2 ingedrukt draai je trager zolang het vizier op een vijand staat */
export const AIM_SLOWDOWN = 0.4

/** D-pad: direct een wapen kiezen */
const DPAD_WEAPON: [number, WeaponId][] = [
  [B.left, 'pistol'],
  [B.right, 'shotgun'],
  [B.up, 'machinegun'],
  [B.down, 'rocket'],
]

export const pad = {
  /** is er een controller (gezien sinds de laatste knopdruk) */
  connected: false,
  name: '',
  /** analoog, -1..1, na de dode zone */
  forward: 0,
  strafe: 0,
  /** gewenste draaisnelheid in rad/s (al met curve en versnelling) */
  yawRate: 0,
  pitchRate: 0,
  jump: false,
  fire: false,
  /** R2 net ingedrukt; de Weapon zet hem terug na het schot */
  firePressed: false,
  aim: false,
  boostTime: 0,
  /** springen pas na het loslaten van ✕ (anders spring je bij het starten meteen) */
  jumpArmed: false,
  prev: [] as boolean[],
  index: -1,
}

function findPad(): Gamepad | null {
  const pads = navigator.getGamepads?.() ?? []
  const current = pad.index >= 0 ? pads[pad.index] : null
  if (current?.connected) return current
  for (const p of pads) {
    if (p?.connected) {
      pad.index = p.index
      return p
    }
  }
  pad.index = -1
  return null
}

let wasConnected = false

/** Eén keer per frame aanroepen. */
export function pollGamepad(dt: number) {
  if (!initialized) init()
  const gp = typeof navigator !== 'undefined' ? findPad() : null
  if (!gp) {
    if (wasConnected) {
      wasConnected = false
      reset()
      useGame.getState().setController(false, '')
    }
    return
  }
  if (!wasConnected) {
    wasConnected = true
    pad.prev = []
  }
  pad.connected = true
  pad.name = gp.id

  const btn = (i: number) => {
    const b = gp.buttons[i]
    if (!b) return false
    return i === B.l2 || i === B.r2 ? b.value > TRIGGER_ON || b.pressed : b.pressed
  }
  const now = gp.buttons.map((_, i) => btn(i))
  const prev = pad.prev
  const pressed = (i: number) => now[i] && !prev[i]
  pad.prev = now
  // de controller wordt gebruikt: touch-knoppen verbergen, uitleg voor de controller tonen
  const used = now.some((b, i) => b && i !== B.l2 && i !== B.r2) || now[B.r2] || gp.axes.some((a) => Math.abs(a) > 0.5)
  if (used && !useGame.getState().controller) useGame.getState().setController(true, gp.id)

  const game = useGame.getState()
  const playing = game.status === 'playing' && game.locked

  // Create-knop: volledig scherm (lukt alleen als de browser een controllerknop als gebruikersactie telt)
  if (pressed(B.share)) void toggleFullscreen()

  // menu's: starten, pauzeren, opnieuw
  if (game.status === 'playing' && !game.locked) {
    if (pressed(B.cross) || pressed(B.options)) startWithController()
  } else if (game.status === 'playing') {
    if (pressed(B.options)) {
      if (document.pointerLockElement) document.exitPointerLock()
      game.setLocked(false)
    }
  } else if (game.status === 'won') {
    if (pressed(B.cross) || pressed(B.options)) game.newLevel()
    if (pressed(B.circle)) game.restart()
  } else if (game.status === 'dead') {
    if (pressed(B.cross) || pressed(B.options)) game.restart()
  }

  if (!playing) {
    reset()
    return
  }

  const move = stick(gp.axes[0] ?? 0, gp.axes[1] ?? 0, MOVE_DEADZONE, 1)
  pad.strafe = move.x
  pad.forward = -move.y

  const look = stick(gp.axes[2] ?? 0, gp.axes[3] ?? 0, LOOK_DEADZONE, 1.8)
  pad.boostTime = look.mag > 0.95 ? pad.boostTime + dt : 0
  const boost = pad.boostTime > BOOST_AFTER ? Math.min(BOOST, 1 + (pad.boostTime - BOOST_AFTER) * 3) : 1
  pad.yawRate = -look.x * YAW_SPEED * boost
  pad.pitchRate = -look.y * PITCH_SPEED

  if (!now[B.cross]) pad.jumpArmed = true
  pad.jump = now[B.cross] && pad.jumpArmed
  pad.aim = now[B.l2]
  pad.fire = now[B.r2]
  if (pressed(B.r2)) pad.firePressed = true

  if (pressed(B.r1)) cycleWeapon(1)
  if (pressed(B.l1)) cycleWeapon(-1)
  for (const [b, id] of DPAD_WEAPON) if (pressed(b) && game.selectWeapon(WEAPONS.findIndex((w) => w.id === id))) sfx.weaponSwitch()
  if (pressed(B.triangle)) game.toggleMap()
}

/** Volgend/vorig wapen, wapens zonder munitie overslaan (tenzij alles leeg is). */
function cycleWeapon(dir: 1 | -1) {
  const game = useGame.getState()
  const n = WEAPONS.length
  for (let k = 1; k < n; k++) {
    const i = (game.weapon + dir * k + n) % n
    if (game.ammo[WEAPONS[i].ammo] > 0) {
      if (game.selectWeapon(i)) sfx.weaponSwitch()
      return
    }
  }
}

function startWithController() {
  // geluid vrijgeven; of een knopdruk daarvoor telt verschilt per browser, een tik op het scherm werkt altijd
  unlockAudio()
  pad.jumpArmed = false
  useGame.getState().setLocked(true)
}

function reset() {
  pad.forward = pad.strafe = pad.yawRate = pad.pitchRate = 0
  pad.jump = pad.fire = pad.firePressed = pad.aim = false
  pad.boostTime = 0
}

/** Kort trillen, als de browser en controller dat ondersteunen (anders gebeurt er niets). */
export function rumble(strong: number, weak: number, ms: number) {
  if (pad.index < 0) return
  const gp = navigator.getGamepads?.()[pad.index] as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null
  try {
    void gp?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak })?.catch(() => {})
  } catch {
    // niet ondersteund
  }
}

/** Eenmalig, bij de eerste poll (niet bij het laden: dan bestaat de store mogelijk nog niet). */
let initialized = false
function init() {
  initialized = true
  // tikken op het scherm = weer touch-besturing
  window.addEventListener('touchstart', () => {
    if (useGame.getState().controller) useGame.getState().setController(false, pad.name)
  })
  // trillen als je geraakt wordt
  let lastHurt = useGame.getState().hurtAt
  useGame.subscribe((s) => {
    if (s.hurtAt !== lastHurt) {
      lastHurt = s.hurtAt
      if (s.hurtAt > 0) rumble(0.8, 0.4, 180)
    }
  })
}
