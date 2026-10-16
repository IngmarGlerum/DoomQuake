import { useEffect, useState } from 'react'
import type { Level } from '../game/level/types'
import { useGame } from '../game/store'

const MESSAGE_MS = 2500

export function Hud({ level }: { level: Level }) {
  const { health, armor, ammo, hasKey, message, messageAt, status, locked, seed, noclip } = useGame()
  const [now, setNow] = useState(() => performance.now())

  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 250)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="hud">
      <div className="crosshair">+</div>
      {now - messageAt < MESSAGE_MS && <div className="message">{message}</div>}
      <div className="topright">
        seed: <b>{seed}</b> · {level.rooms.length} kamers
        {noclip && <span className="noclip"> · NOCLIP</span>}
      </div>

      <div className="statusbar">
        <Stat label="AMMO" value={ammo} />
        <Stat label="HEALTH" value={`${Math.ceil(health)}%`} warn={health < 30} />
        <div className="face">{health > 60 ? '😠' : health > 25 ? '😣' : '😵'}</div>
        <Stat label="ARMOR" value={`${Math.floor(armor)}%`} />
        <div className="keys">
          <div className={`keycard ${hasKey ? 'owned' : ''}`} />
          <span>KEY</span>
        </div>
      </div>

      {status === 'playing' && !locked && (
        <div className="overlay">
          <h1>RETRO SHOOTER</h1>
          <p className="blink">Klik om te spelen</p>
          <table>
            <tbody>
              <tr><td>WASD / pijltjes</td><td>lopen</td></tr>
              <tr><td>muis</td><td>rondkijken</td></tr>
              <tr><td>klik</td><td>schieten</td></tr>
              <tr><td>spatie</td><td>springen (houd ingedrukt om te bunnyhoppen)</td></tr>
              <tr><td>M</td><td>kaart aan/uit</td></tr>
              <tr><td>N</td><td>noclip (vrij vliegen, spatie/C = omhoog/omlaag)</td></tr>
              <tr><td>G</td><td>nieuw willekeurig level</td></tr>
              <tr><td>Esc</td><td>pauze</td></tr>
            </tbody>
          </table>
          <p className="hint">Zoek de rode sleutel, open de rode deur en bereik de EXIT.</p>
        </div>
      )}
      {status === 'won' && (
        <div className="overlay">
          <h1>LEVEL VOLTOOID</h1>
          <p className="blink">Enter: volgend level · R: dit level opnieuw</p>
        </div>
      )}
      {status === 'dead' && (
        <div className="overlay dead">
          <h1>JE BENT DOOD</h1>
          <p className="blink">Enter of R: opnieuw</p>
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
