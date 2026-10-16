import { useEffect, useMemo, useRef } from 'react'
import type { Level } from '../game/level/types'
import { CELL } from '../game/level/types'
import { player, useGame } from '../game/store'

const SCALE = 4

const THING_COLORS: Record<string, string> = {
  enemy: '#ff4040',
  health: '#ffffff',
  ammo: '#e0b020',
  armor: '#40d060',
  key: '#ff00ff',
  exit: '#00ffff',
}

/** Debug-/automap: vloerhoogte als helderheid, deuren rood, nukage groen. */
export function Minimap({ level }: { level: Level }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const show = useGame((s) => s.showMap)

  const base = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = level.width * SCALE
    c.height = level.height * SCALE
    const ctx = c.getContext('2d')!
    const floors = level.cells.filter((cell) => !cell.solid).map((cell) => cell.floor)
    const lo = Math.min(...floors)
    const hi = Math.max(...floors)
    level.cells.forEach((cell, i) => {
      if (cell.solid) return
      const x = i % level.width
      const y = Math.floor(i / level.width)
      const t = hi > lo ? (cell.floor - lo) / (hi - lo) : 0.5
      const v = Math.round(60 + t * 150)
      ctx.fillStyle = cell.door ? '#c02020' : cell.liquid ? '#30a020' : `rgb(${v},${v},${Math.round(v * 0.9)})`
      ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE)
    })
    for (const t of level.things) {
      ctx.fillStyle = THING_COLORS[t.kind]
      const s = t.kind === 'key' || t.kind === 'exit' ? 4 : 2
      ctx.fillRect((t.x / CELL) * SCALE - s / 2, (t.z / CELL) * SCALE - s / 2, s, s)
    }
    return c
  }, [level])

  useEffect(() => {
    if (!show) return
    let frame = 0
    const draw = () => {
      const ctx = canvas.current?.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
        ctx.drawImage(base, 0, 0)
        const px = (player.position.x / CELL) * SCALE
        const pz = (player.position.z / CELL) * SCALE
        const fx = -Math.sin(player.yaw)
        const fz = -Math.cos(player.yaw)
        ctx.strokeStyle = '#00ff00'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(px, pz)
        ctx.lineTo(px + fx * 10, pz + fz * 10)
        ctx.stroke()
        ctx.fillStyle = '#00ff00'
        ctx.fillRect(px - 2, pz - 2, 4, 4)
      }
      frame = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(frame)
  }, [base, show])

  if (!show) return null
  return <canvas ref={canvas} className="minimap" width={level.width * SCALE} height={level.height * SCALE} />
}
