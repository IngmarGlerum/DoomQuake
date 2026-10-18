import { useEffect, useState } from 'react'
import { AMMO_LABEL, WEAPONS } from '../game/combat/weapons'
import type { Level } from '../game/level/types'
import { getWeaponIcons } from '../game/render/weaponIcons'
import { sfx } from '../game/audio'
import { isTouchDevice } from '../game/player/input'
import { useGame } from '../game/store'
import { startTouchPlay } from './TouchControls'

const MESSAGE_MS = 2500

export function Hud({ level }: { level: Level }) {
  const { health, armor, ammo, weapon, kills, enemies, hurtAt, hasKey, message, messageAt, status, locked, seed, noclip } = useGame()
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
              <p className="blink">Klik om te spelen</p>
              <table>
                <tbody>
                  <tr><td>WASD / pijltjes</td><td>lopen</td></tr>
                  <tr><td>muis</td><td>rondkijken</td></tr>
                  <tr><td>klik</td><td>schieten (machine gun: ingedrukt houden)</td></tr>
                  <tr><td>1 / 2 / 3 / 4, scrollwiel</td><td>heavy pistol / shotgun / machine gun / rocket launcher</td></tr>
                  <tr><td>spatie</td><td>springen (houd ingedrukt om te bunnyhoppen)</td></tr>
                  <tr><td>M</td><td>kaart aan/uit</td></tr>
                  <tr><td>N</td><td>noclip (vrij vliegen, spatie/C = omhoog/omlaag)</td></tr>
                  <tr><td>G</td><td>nieuw willekeurig level</td></tr>
                  <tr><td>Esc</td><td>pauze</td></tr>
                </tbody>
              </table>
            </>
          )}
          <p className="hint">Zoek de rode sleutel, open de rode deur en bereik de EXIT.</p>
        </div>
      )}
      {status === 'won' && (
        <div className="overlay">
          <h1>LEVEL VOLTOOID</h1>
          {isTouchDevice ? (
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
          {isTouchDevice ? (
            <button className="overlay-btn" onClick={() => useGame.getState().restart()}>Opnieuw</button>
          ) : (
            <p className="blink">Enter of R: opnieuw</p>
          )}
        </div>
      )}
    </div>
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
