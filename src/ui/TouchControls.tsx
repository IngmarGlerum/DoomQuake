import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { unlockAudio } from '../game/audio'
import { fireButton, look, touch } from '../game/player/input'
import { useGame } from '../game/store'

const STICK_RADIUS = 56
const DEADZONE = 0.12
/** Deel van de schermbreedte (links) waar de joystick verschijnt. */
const STICK_AREA = 0.45

function capture(e: ReactPointerEvent<HTMLElement>) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch {
    // pointer bestaat niet (meer); geen probleem
  }
}

/** Volledig scherm + landscape vastzetten (werkt op Android; iOS negeert het netjes). */
export async function enterFullscreenLandscape() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })
  } catch {
    // niet ondersteund (bijv. iPhone Safari)
  }
  try {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
    await orientation.lock?.('landscape')
  } catch {
    // niet ondersteund of niet in fullscreen
  }
}

export function usePortrait() {
  const query = '(orientation: portrait)'
  const [portrait, setPortrait] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setPortrait(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return portrait
}

/**
 * Twin-stick besturing voor touchscreens:
 * - linkerkant: zwevende joystick (verschijnt waar je je duim neerzet)
 * - rechterkant: slepen om te kijken
 * - vuurknop (ook slepen om te richten tijdens het schieten) en springknop
 */
export function TouchControls() {
  const locked = useGame((s) => s.locked)
  const status = useGame((s) => s.status)
  const portrait = usePortrait()

  const base = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLDivElement>(null)
  const pointers = useRef({
    stick: -1,
    stickX: 0,
    stickY: 0,
    looks: new Map<number, { x: number; y: number }>(),
  })

  // in portretstand pauzeren
  useEffect(() => {
    if (portrait) useGame.getState().setLocked(false)
  }, [portrait])

  // bij pauze alle touch-input loslaten
  useEffect(() => {
    if (locked) return
    resetTouch()
    pointers.current.stick = -1
    pointers.current.looks.clear()
    if (base.current) base.current.style.display = 'none'
  }, [locked])

  const showStick = (x: number, y: number) => {
    if (!base.current || !knob.current) return
    base.current.style.display = 'block'
    base.current.style.transform = `translate(${x - STICK_RADIUS}px, ${y - STICK_RADIUS}px)`
    knob.current.style.transform = 'translate(0px, 0px)'
  }

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointers.current
    capture(e)
    if (e.clientX < window.innerWidth * STICK_AREA && p.stick === -1) {
      p.stick = e.pointerId
      p.stickX = e.clientX
      p.stickY = e.clientY
      showStick(e.clientX, e.clientY)
    } else {
      p.looks.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }
  }

  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const p = pointers.current
    if (e.pointerId === p.stick) {
      let dx = e.clientX - p.stickX
      let dy = e.clientY - p.stickY
      const len = Math.hypot(dx, dy)
      if (len > STICK_RADIUS) {
        dx = (dx / len) * STICK_RADIUS
        dy = (dy / len) * STICK_RADIUS
      }
      if (knob.current) knob.current.style.transform = `translate(${dx}px, ${dy}px)`
      const mag = Math.min(1, len / STICK_RADIUS)
      const k = mag < DEADZONE ? 0 : (mag - DEADZONE) / (1 - DEADZONE) / Math.max(mag, 1e-6)
      touch.strafe = (dx / STICK_RADIUS) * k
      touch.forward = (-dy / STICK_RADIUS) * k
      return
    }
    const last = p.looks.get(e.pointerId)
    if (last) {
      look.dx += e.clientX - last.x
      look.dy += e.clientY - last.y
      last.x = e.clientX
      last.y = e.clientY
    }
  }

  const onUp = (e: ReactPointerEvent<HTMLElement>) => {
    const p = pointers.current
    if (e.pointerId === p.stick) {
      p.stick = -1
      touch.forward = touch.strafe = 0
      if (base.current) base.current.style.display = 'none'
    }
    p.looks.delete(e.pointerId)
  }

  const onFireDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    capture(e)
    fireButton.held = true
    fireButton.pressed = true
    // je kunt met je duim óp de vuurknop slepen om te richten
    pointers.current.looks.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }
  const onFireUp = () => {
    fireButton.held = false
  }

  if (portrait) return <RotatePrompt />
  if (!locked || status !== 'playing') return null

  return (
    <div className="touch-layer" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div ref={base} className="stick-base">
        <div ref={knob} className="stick-knob" />
      </div>

      {/* pointermove/up bubbelen naar de touch-layer, die het richten afhandelt */}
      <div className="touch-btn fire" onPointerDown={onFireDown} onPointerUp={onFireUp} onPointerCancel={onFireUp}>
        <span>🔥</span>
      </div>
      <div
        className="touch-btn jump"
        onPointerDown={(e) => {
          e.stopPropagation()
          touch.jump = true
        }}
        onPointerUp={() => (touch.jump = false)}
        onPointerCancel={() => (touch.jump = false)}
        onPointerLeave={() => (touch.jump = false)}
      >
        <span>⤒</span>
      </div>

      <div className="touch-top">
        <button
          className="touch-small"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => useGame.getState().toggleMap()}
          aria-label="Kaart"
        >
          🗺
        </button>
        <button
          className="touch-small"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => useGame.getState().setLocked(false)}
          aria-label="Pauze"
        >
          ❚❚
        </button>
      </div>
    </div>
  )
}

function resetTouch() {
  touch.forward = touch.strafe = 0
  touch.jump = false
  fireButton.held = fireButton.pressed = false
  look.dx = look.dy = 0
}

function RotatePrompt() {
  return (
    <div className="rotate-prompt">
      <div className="rotate-phone" />
      <h2>Draai je telefoon</h2>
      <p>Retro Shooter speel je in landscape. Houd je telefoon opzij.</p>
    </div>
  )
}

/** Startknop op mobiel: audio vrijgeven, fullscreen + landscape, en het spel hervatten. */
export function startTouchPlay() {
  unlockAudio()
  void enterFullscreenLandscape()
  useGame.getState().setLocked(true)
}
