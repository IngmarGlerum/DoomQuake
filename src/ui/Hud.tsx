import { useEffect, useState } from 'react'
import { AMMO_LABEL, WEAPONS } from '../game/combat/weapons'
import type { Level } from '../game/level/types'
import { getWeaponIcons } from '../game/render/weaponIcons'
import { sfx } from '../game/audio'
import { isTouchDevice } from '../game/player/input'
import { useGame } from '../game/store'
import { LEVEL_ORDER, LEVELS } from '../game/level/levels'
import { pointerLock } from '../game/player/pointerLock'
import { startTouchPlay } from './TouchControls'
import { canFullscreen, isIPhone, isStandalone, toggleFullscreen, useFullscreen } from '../game/fullscreen'

const MESSAGE_MS = 2500

export function Hud({ level }: { level: Level }) {
  const { health, armor, ammo, weapon, kills, enemies, hurtAt, hasKey, message, messageAt, status, locked, seed, noclip, controller, controllerName } = useGame()
  const icons = getWeaponIcons()
  const current = WEAPONS[weapon]
  const [now, setNow] = useState(() => performance.now())

  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 250)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="hud">
      {hurtAt > 0 && <div key={hurtAt} className="hurt-flash" />}
      <div className="crosshair">+</div>
      {now - messageAt < MESSAGE_MS && <div className="message">{message}</div>}
      <div className="topright">
        seed: <b>{seed}</b> · {level.rooms.length} kamers
        {noclip && <span className="noclip"> · NOCLIP</span>}
      </div>

      <div className="statusbar">
        <div className={`weapons ${isTouchDevice ? 'tappable' : ''}`}>
          {WEAPONS.map((w, i) => (
            <div
              key={w.id}
              className={`slot ${i === weapon ? 'selected' : ''} ${ammo[w.ammo] <= 0 ? 'empty' : ''}`}
              title={w.name}
              onPointerDown={() => useGame.getState().selectWeapon(i) && sfx.weaponSwitch()}
            >
              <span className="slot-key">{w.slot}</span>
              <img src={icons[w.id]} alt={w.name} />
              <span className="slot-ammo">{ammo[w.ammo]}</span>
            </div>
          ))}
        </div>
        <Stat label={AMMO_LABEL[current.ammo]} value={ammo[current.ammo]} warn={ammo[current.ammo] <= 3} />
        <Stat label="HEALTH" value={`${Math.ceil(health)}%`} warn={health < 30} />
        <div className="face">{health > 60 ? '😠' : health > 25 ? '😣' : '😵'}</div>
        <Stat label="ARMOR" value={`${Math.floor(armor)}%`} />
        <div className="keys">
          <div className={`keycard ${hasKey ? 'owned' : ''}`} />
          <span>KEY</span>
        </div>
        <Stat label="KILLS" value={`${kills}/${enemies}`} />
      </div>

      {status === 'playing' && !locked && (
        <div className="overlay">
          <h1>RETRO SHOOTER</h1>
          <LevelPicker />
          {controller ? (
            <>
              <button className="overlay-btn" onClick={isTouchDevice ? startTouchPlay : () => pointerLock.lock()}>
                ✕ SPELEN
              </button>
              <ControllerHelp name={controllerName} />
            </>
          ) : (
            <>
            {isTouchDevice ? (
              <>
                <button className="overlay-btn" onClick={startTouchPlay}>
                  ▶ SPELEN
                </button>
                <table>
                  <tbody>
                    <tr><td>linkerduim</td><td>joystick: lopen (verschijnt waar je drukt)</td></tr>
                    <tr><td>rechterduim</td><td>slepen om rond te kijken</td></tr>
                    <tr><td>🔥</td><td>schieten (vasthouden + slepen om te richten)</td></tr>
                    <tr><td>⤒</td><td>springen</td></tr>
                    <tr><td>wapenicoontjes</td><td>tikken om te wisselen</td></tr>
                  </tbody>
                </table>
              </>
            ) : (
              <>
                <button className="overlay-btn" onClick={() => pointerLock.lock()}>
                  ▶ SPELEN
                </button>
                <table>
                  <tbody>
                    <tr><td>WASD / pijltjes</td><td>lopen</td></tr>
                    <tr><td>muis</td><td>rondkijken</td></tr>
                    <tr><td>klik</td><td>schieten (assault rifle: ingedrukt houden)</td></tr>
                    <tr><td>1 – 5, scrollwiel</td><td>pistol / shotgun / assault rifle / rocket launcher / disk launcher</td></tr>
                    <tr><td>spatie</td><td>springen (houd ingedrukt om te bunnyhoppen)</td></tr>
                    <tr><td>M</td><td>kaart aan/uit</td></tr>
                    <tr><td>N</td><td>noclip (vrij vliegen, spatie/C = omhoog/omlaag)</td></tr>
                    <tr><td>G</td><td>nieuw willekeurig level</td></tr>
                    <tr><td>F</td><td>volledig scherm aan/uit</td></tr>
                    <tr><td>Esc</td><td>pauze</td></tr>
                  </tbody>
                </table>
              </>
            )}
              <p className="pad-hint">🎮 Controller? Verbind hem en druk op een knop.</p>
            </>
          )}
          <FullscreenOption />
          <p className="hint">Zoek de rode sleutel, open de rode deur en bereik de EXIT.</p>
        </div>
      )}
      {status === 'won' && (
        <div className="overlay">
          <h1>LEVEL VOLTOOID</h1>
          {controller ? (
            <p className="blink">✕ volgend level · ○ dit level opnieuw</p>
          ) : isTouchDevice ? (
            <div className="overlay-buttons">
              <button className="overlay-btn" onClick={() => useGame.getState().newLevel()}>Volgend level</button>
              <button className="overlay-btn secondary" onClick={() => useGame.getState().restart()}>Opnieuw</button>
            </div>
          ) : (
            <p className="blink">Enter: volgend level · R: dit level opnieuw</p>
          )}
        </div>
      )}
      {status === 'dead' && (
        <div className="overlay dead">
          <h1>JE BENT DOOD</h1>
          {controller ? (
            <p className="blink">✕ opnieuw</p>
          ) : isTouchDevice ? (
            <button className="overlay-btn" onClick={() => useGame.getState().restart()}>Opnieuw</button>
          ) : (
            <p className="blink">Enter of R: opnieuw</p>
          )}
        </div>
      )}
    </div>
  )
}

/** Knop voor volledig scherm, of op een iPhone (geen fullscreen voor webpagina's) de tip om de game als app te openen. */
function FullscreenOption() {
  const on = useFullscreen()
  if (canFullscreen) {
    return (
      <button className="overlay-btn secondary small" onClick={() => void toggleFullscreen()}>
        {on ? '⤡ Venster' : '⛶ Volledig scherm'}
        {!isTouchDevice && <span className="key-hint"> (F)</span>}
      </button>
    )
  }
  if (isIPhone && !isStandalone) {
    return <p className="pad-hint">Volledig scherm: tik in Safari op Deel › Zet op beginscherm en start de game vanaf je beginscherm.</p>
  }
  return null
}

/** Uitleg van de controllerknoppen (DualSense-namen; op een Xbox-controller zitten ze op dezelfde plek). */
function ControllerHelp({ name }: { name: string }) {
  const short = name.split('(')[0].trim().slice(0, 40) || 'Controller'
  return (
    <>
      <table>
        <tbody>
          <tr><td>sticks</td><td>links lopen · rechts rondkijken</td></tr>
          <tr><td>R2 · L2</td><td>schieten · richten (trager draaien op een vijand)</td></tr>
          <tr><td>R1 · L1</td><td>volgend · vorig wapen</td></tr>
          <tr><td>D-pad</td><td>← pistol · → shotgun · ↑ rifle · ↓ rocket</td></tr>
          <tr><td>✕ · △ · Options</td><td>springen · kaart · pauze</td></tr>
          <tr><td>Create</td><td>volledig scherm (als de browser het toestaat)</td></tr>
        </tbody>
      </table>
      <p className="pad-hint">🎮 {short} verbonden</p>
    </>
  )
}

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className={`stat ${warn ? 'warn' : ''}`}>
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  )
}

/** Keuze tussen de levels; een ander level kiezen start een nieuw spel. */
function LevelPicker() {
  const current = useGame((s) => s.levelKind)
  return (
    <div className="level-picker">
      {LEVEL_ORDER.map((kind, i) => (
        <button
          key={kind}
          className={`level-card ${kind === current ? 'selected' : ''}`}
          onClick={() => useGame.getState().chooseLevel(kind)}
        >
          <span className="level-num">LEVEL {i + 1}</span>
          <span className="level-name">{LEVELS[kind].name}</span>
          <span className="level-desc">{LEVELS[kind].description}</span>
        </button>
      ))}
    </div>
  )
}
