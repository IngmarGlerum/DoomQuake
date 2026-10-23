import { makeRng, type Rng } from '../rng'
import { validateLevel } from './validate'
import {
  CELL,
  STEP,
  cellCenter,
  type Cell,
  type Level,
  type Light,
  type Prop,
  type Room,
  type RoomPurpose,
  type Thing,
} from './types'

/**
 * Level 2: een kronkelig grottenstelsel met daarin een kwaadaardige basis.
 *
 * - Grotkamers zijn organische blobs met een hobbelige vloer en een grillig plafond.
 * - Ze worden verbonden door slingerende tunnels ("wormen" die al zwalkend naar hun doel kruipen).
 * - Basiskamers zijn rechthoekig, met een korte aansluitgang en een automatische schuifdeur.
 *   Elke kamer heeft een functie (servers, controle, lab, opslag, reactor) die het decor bepaalt.
 * - Door de tunnels lopen pijpen en kabels, met hier en daar een industriële lamp.
 */
const W = 64
const H = 64
const ROOM_GAP = 4

type Side = 'n' | 's' | 'e' | 'w'

interface Node {
  room: Room
  /** middelpunt in cel-coördinaten (float) */
  cx: number
  cy: number
  /** straal van een grotkamer */
  radius: number
}

interface Tunnel {
  /** punten in cel-coördinaten met vloerhoogte */
  points: { x: number; y: number; floor: number }[]
}

const LIGHT: Record<RoomPurpose | 'cave' | 'tunnel' | 'door' | 'alarm', [number, number, number]> = {
  server: [0.5, 0.72, 1.0],
  control: [0.85, 0.92, 1.0],
  lab: [0.5, 1.0, 0.58],
  storage: [1.0, 0.88, 0.66],
  reactor: [1.0, 0.32, 0.22],
  cave: [0.55, 0.6, 0.75],
  tunnel: [1.0, 0.7, 0.35],
  door: [1.0, 0.68, 0.2],
  alarm: [1.0, 0.12, 0.08],
}

export function generateCaveLevel(seed: string): Level {
  const rng = makeRng(`caves:${seed}`)
  let lastProblems: string[] = ['te weinig ruimte']
  for (let attempt = 0; attempt < 400; attempt++) {
    const level = tryGenerate(seed, rng)
    if (!level) continue
    const result = validateLevel(level)
    if (result.ok) return level
    lastProblems = result.problems
  }
  throw new Error(`Kon geen grotlevel maken voor seed "${seed}": ${lastProblems.join(', ')}`)
}

/** Gladde waarde-ruis over het grid (0..1), periode `scale` cellen. */
function gridNoise(rng: Rng, scale: number) {
  const gw = Math.ceil(W / scale) + 2
  const gh = Math.ceil(H / scale) + 2
  const lattice = Array.from({ length: gw * gh }, () => rng.next())
  const g = (x: number, y: number) => lattice[Math.min(gh - 1, Math.max(0, y)) * gw + Math.min(gw - 1, Math.max(0, x))]
  return (x: number, y: number) => {
    const fx = x / scale
    const fy = y / scale
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    const sx = tx * tx * (3 - 2 * tx)
    const sy = ty * ty * (3 - 2 * ty)
    const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * sx
    const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * sx
    return a + (b - a) * sy
  }
}

function tryGenerate(seed: string, rng: Rng): Level | null {
  const cells: Cell[] = Array.from({ length: W * H }, () => ({
    solid: true,
    floor: 0,
    ceil: 0,
    room: -1,
    corridor: -1,
    path: false,
    liquid: false,
    door: false,
    theme: 'cave',
  }))
  const idx = (x: number, y: number) => y * W + x
  const at = (x: number, y: number) => cells[idx(x, y)]
  const inside = (x: number, y: number) => x >= 1 && y >= 1 && x < W - 1 && y < H - 1
  const quant = (h: number) => Math.round(h / STEP) * STEP

  const bumpNoise = gridNoise(rng, 4)
  const ceilNoise = gridNoise(rng, 5)

  // 1. Basiskamers en grotkamers plaatsen
  const nodes: Node[] = []
  const wantBase = rng.int(5, 6)
  const wantCave = rng.int(5, 7)
  let bases = 0
  let caves = 0
  const overlaps = (x: number, y: number, w: number, h: number) =>
    nodes.some(({ room: r }) => x < r.x + r.w + ROOM_GAP && x + w + ROOM_GAP > r.x && y < r.y + r.h + ROOM_GAP && y + h + ROOM_GAP > r.y)
  for (let i = 0; i < 800 && (bases < wantBase || caves < wantCave); i++) {
    const makeBase = bases < wantBase && (caves >= wantCave || rng.chance(0.5))
    if (makeBase) {
      const w = rng.int(5, 8)
      const h = rng.int(5, 8)
      const x = rng.int(4, W - w - 5)
      const y = rng.int(4, H - h - 5)
      if (overlaps(x, y, w, h)) continue
      const room: Room = { id: nodes.length, x, y, w, h, floor: 0, ceil: 0, theme: 'base', feature: 'none', depth: 0, kind: 'base' }
      nodes.push({ room, cx: x + w / 2, cy: y + h / 2, radius: 0 })
      bases++
    } else {
      const radius = rng.int(25, 42) / 10
      const cx = rng.next() * (W - 2 * radius - 10) + radius + 5
      const cy = rng.next() * (H - 2 * radius - 10) + radius + 5
      const x = Math.floor(cx - radius - 1)
      const y = Math.floor(cy - radius - 1)
      const size = Math.ceil(radius * 2 + 2)
      if (overlaps(x, y, size, size)) continue
      const room: Room = { id: nodes.length, x, y, w: size, h: size, floor: 0, ceil: 0, theme: 'cave', feature: 'none', depth: 0, kind: 'cave' }
      nodes.push({ room, cx, cy, radius })
      caves++
    }
  }
  if (bases < 4 || caves < 4) return null
  const rooms = nodes.map((n) => n.room)

  // 2. Minimum spanning tree tussen alle kamers
  const dist = (a: Node, b: Node) => Math.hypot(a.cx - b.cx, a.cy - b.cy)
  const tree: [number, number][] = []
  const inTree = new Set([0])
  while (inTree.size < nodes.length) {
    let best: [number, number] = [-1, -1]
    let bestD = Infinity
    for (const a of inTree) {
      for (const b of nodes) {
        if (inTree.has(b.room.id)) continue
        const d = dist(nodes[a], b)
        if (d < bestD) {
          bestD = d
          best = [a, b.room.id]
        }
      }
    }
    tree.push(best)
    inTree.add(best[1])
  }
  const adj: number[][] = nodes.map(() => [])
  for (const [a, b] of tree) {
    adj[a].push(b)
    adj[b].push(a)
  }

  // 3. Start in een grot; sleutel en exit in basiskamers aan de uiteinden
  const leaves = nodes.filter((n) => adj[n.room.id].length === 1).map((n) => n.room.id)
  const caveLeaves = leaves.filter((id) => rooms[id].kind === 'cave')
  if (!caveLeaves.length) return null
  const startRoom = rng.pick(caveLeaves)
  const order = [startRoom]
  const parent = new Array<number>(nodes.length).fill(-1)
  const pathLen = new Array<number>(nodes.length).fill(0)
  parent[startRoom] = startRoom
  for (let i = 0; i < order.length; i++) {
    const a = order[i]
    for (const b of adj[a]) {
      if (parent[b] !== -1) continue
      parent[b] = a
      rooms[b].depth = rooms[a].depth + 1
      pathLen[b] = pathLen[a] + dist(nodes[a], nodes[b])
      order.push(b)
    }
  }
  const far = (ids: number[]) => [...ids].sort((a, b) => pathLen[b] - pathLen[a])
  const baseLeaves = far(leaves.filter((id) => rooms[id].kind === 'base' && id !== startRoom))
  if (baseLeaves.length < 1) return null
  const exitRoom = baseLeaves[0]
  const keyCandidates = far(
    rooms.filter((r) => r.kind === 'base' && r.id !== exitRoom).map((r) => r.id),
  ).filter((id) => leaves.includes(id) || rng.chance(0.4))
  if (!keyCandidates.length) return null
  const keyRoom = keyCandidates[0]

  // functies van de basiskamers
  const others = rng.shuffle(rooms.filter((r) => r.kind === 'base' && r.id !== exitRoom && r.id !== keyRoom))
  const purposes: RoomPurpose[] = ['server', 'lab', 'storage', 'server', 'lab']
  others.forEach((r, i) => (r.purpose = purposes[i % purposes.length]))
  rooms[exitRoom].purpose = 'reactor'
  rooms[keyRoom].purpose = 'control'

  // 4. Hoogtes
  for (const id of order) {
    const r = rooms[id]
    if (id === startRoom) r.floor = 0
    else r.floor = Math.max(-2, Math.min(3, rooms[parent[id]].floor + rng.pick([-1, -0.5, 0, 0, 0.5, 1])))
    r.ceil = r.floor + (r.kind === 'base' ? 4 : 5)
  }

  // extra lussen (niet via de exitkamer)
  const edges: [number, number][] = [...tree]
  const treeKey = new Set(tree.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`))
  const loopCandidates: [number, number][] = []
  for (const a of nodes) {
    for (const b of nodes) {
      const ia = a.room.id
      const ib = b.room.id
      if (ia >= ib || ia === exitRoom || ib === exitRoom || treeKey.has(`${ia}-${ib}`)) continue
      if (Math.abs(a.room.floor - b.room.floor) > 1 || dist(a, b) > 24) continue
      loopCandidates.push([ia, ib])
    }
  }
  rng.shuffle(loopCandidates)
  edges.push(...loopCandidates.slice(0, rng.int(1, 2)))

  // 5. Kamers uitgraven
  const protectedCell = new Uint8Array(W * H)
  for (const n of nodes) {
    const r = n.room
    if (r.kind === 'base') {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) Object.assign(at(x, y), { solid: false, room: r.id, floor: r.floor, ceil: r.ceil, theme: 'base' })
      }
      // ring van één cel rond de kamer blijft rots, behalve waar een aansluitgang komt
      for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) protectedCell[idx(x, y)] = 1
    } else {
      const p1 = rng.next() * 6.28
      const p2 = rng.next() * 6.28
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if (!inside(x, y)) continue
          const dx = x + 0.5 - n.cx
          const dy = y + 0.5 - n.cy
          const a = Math.atan2(dy, dx)
          const radius = n.radius * (1 + 0.22 * Math.sin(3 * a + p1) + 0.14 * Math.sin(5 * a + p2))
          if (Math.hypot(dx, dy) > radius) continue
          const floor = r.floor + quant((bumpNoise(x, y) - 0.5) * 1.0)
          Object.assign(at(x, y), {
            solid: false,
            room: r.id,
            floor,
            ceil: floor + 3.4 + quant(ceilNoise(x, y) * 3.2),
            theme: 'cave',
          })
        }
      }
      // het midden is altijd begaanbaar en op kamerhoogte
      const c = at(Math.floor(n.cx), Math.floor(n.cy))
      if (c.solid) return null
      c.floor = r.floor
    }
  }

  // 6. Aansluitgangen van basiskamers (2 breed, 3 lang) met deur
  const stubs = new Map<string, { x: number; y: number }>()
  const doorCells: { x: number; y: number; room: number }[] = []
  const entrance = (n: Node, toward: Node): { x: number; y: number } => {
    const r = n.room
    const dx = toward.cx - n.cx
    const dy = toward.cy - n.cy
    const side: Side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : dy > 0 ? 's' : 'n'
    const key = `${r.id}-${side}`
    const known = stubs.get(key)
    if (known) return known
    const midX = r.x + Math.floor(r.w / 2) - 1
    const midY = r.y + Math.floor(r.h / 2) - 1
    const cellsOut: [number, number][] = []
    for (let k = 0; k < 3; k++) {
      for (let j = 0; j < 2; j++) {
        if (side === 'e') cellsOut.push([r.x + r.w + k, midY + j])
        if (side === 'w') cellsOut.push([r.x - 1 - k, midY + j])
        if (side === 's') cellsOut.push([midX + j, r.y + r.h + k])
        if (side === 'n') cellsOut.push([midX + j, r.y - 1 - k])
      }
    }
    for (const [x, y] of cellsOut) {
      if (!inside(x, y)) return { x: -1, y: -1 }
      const c = at(x, y)
      if (c.room >= 0) return { x: -1, y: -1 }
      Object.assign(c, { solid: false, corridor: 1000 + r.id, floor: r.floor, ceil: r.floor + 3.2, theme: 'base', path: true })
    }
    // de eerste rij buiten de kamer wordt de deur
    for (const [x, y] of cellsOut.slice(0, 2)) doorCells.push({ x, y, room: r.id })
    const end = cellsOut[cellsOut.length - 1]
    const other = cellsOut[cellsOut.length - 2]
    const p = { x: (end[0] + other[0]) / 2 + 0.5, y: (end[1] + other[1]) / 2 + 0.5 }
    stubs.set(key, p)
    return p
  }

  // 7. Slingerende tunnels
  const tunnels: Tunnel[] = []
  for (let e = 0; e < edges.length; e++) {
    const A = nodes[edges[e][0]]
    const B = nodes[edges[e][1]]
    const pa = A.room.kind === 'base' ? entrance(A, B) : { x: A.cx, y: A.cy }
    const pb = B.room.kind === 'base' ? entrance(B, A) : { x: B.cx, y: B.cy }
    if (pa.x < 0 || pb.x < 0) return null

    const points: { x: number; y: number }[] = [{ ...pa }]
    let px = pa.x
    let py = pa.y
    let heading = Math.atan2(pb.y - py, pb.x - px)
    let steps = 0
    while (Math.hypot(pb.x - px, pb.y - py) > 1.2) {
      if (++steps > 600) return null
      const d = Math.hypot(pb.x - px, pb.y - py)
      const desired = Math.atan2(pb.y - py, pb.x - px)
      const diff = Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading))
      const near = d < 6
      heading += diff * (near ? 0.6 : 0.22) + (rng.next() - 0.5) * (near ? 0.3 : 1.1)
      px = Math.max(2, Math.min(W - 3, px + Math.cos(heading) * 0.6))
      py = Math.max(2, Math.min(H - 3, py + Math.sin(heading) * 0.6))
      points.push({ x: px, y: py })
    }
    points.push({ ...pb })

    // hoogtes: ankers in kamers en eerder gegraven tunnels, ertussen geleidelijk
    const anchor = points.map(({ x, y }) => {
      const c = at(Math.floor(x), Math.floor(y))
      if (!c.solid && (c.room >= 0 || (c.corridor >= 0 && c.corridor !== e))) return c.floor
      return null
    })
    if (anchor[0] === null || anchor[anchor.length - 1] === null) return null
    const heights = new Array<number>(points.length)
    let prev = 0
    for (let i = 0; i < points.length; i++) {
      const h1 = anchor[i]
      if (h1 === null) continue
      const h0 = anchor[prev]!
      for (let k = prev; k <= i; k++) heights[k] = k === i ? h1 : quant(h0 + ((h1 - h0) * (k - prev)) / (i - prev))
      prev = i
    }

    points.forEach(({ x, y }, i) => {
      for (let cy = Math.floor(y - 1.6); cy <= Math.floor(y + 1.6); cy++) {
        for (let cx = Math.floor(x - 1.6); cx <= Math.floor(x + 1.6); cx++) {
          if (!inside(cx, cy) || protectedCell[idx(cx, cy)]) continue
          if (Math.hypot(cx + 0.5 - x, cy + 0.5 - y) > 1.15) continue
          const c = at(cx, cy)
          if (c.room >= 0) continue
          if (!c.solid && c.corridor !== e) continue
          const floor = heights[i]
          Object.assign(c, {
            solid: false,
            corridor: e,
            path: true,
            floor,
            ceil: floor + 3.1 + quant(ceilNoise(cx + 17, cy + 5) * 1.6),
            theme: 'cave',
          })
        }
      }
    })
    tunnels.push({ points: points.map((p, i) => ({ ...p, floor: heights[i] })) })
  }

  // deuren markeren: schuifdeuren, behalve bij de exitkamer (die zit op slot)
  for (const d of doorCells) {
    const c = at(d.x, d.y)
    if (d.room === exitRoom) c.door = true
    else c.slide = true
  }

  // 8. Decor, lampen en licht
  const lights: Light[] = []
  const props: Prop[] = []
  const occupied = new Set<number>()
  const addLight = (x: number, y: number, z: number, radius: number, color: [number, number, number], k = 1) =>
    lights.push({ x, y, z, radius, color: [color[0] * k, color[1] * k, color[2] * k] })

  for (const n of nodes) {
    const r = n.room
    if (r.kind === 'cave') {
      const c = cellCenter(n.cx - 0.5, n.cy - 0.5)
      addLight(c.x, r.floor + 3.2, c.z, n.radius * CELL * 1.4 + 3, LIGHT.cave, 0.7)
      continue
    }
    decorateBaseRoom(r, cells, rng, props, occupied, lights)
  }

  // lichtje boven elke schuifdeur
  for (const d of doorCells) {
    const c = cellCenter(d.x, d.y)
    addLight(c.x, at(d.x, d.y).ceil - 0.3, c.z, 4.5, d.room === exitRoom ? LIGHT.alarm : LIGHT.door, 0.8)
  }

  // pijpen, kabels en lampen door de tunnels
  for (const t of tunnels) decorateTunnel(t, cells, rng, props, lights)

  // 9. Things
  const things: Thing[] = []
  const used = new Set<number>(occupied)
  const place = (kind: Thing['kind'], x: number, y: number) => {
    const i = idx(x, y)
    used.add(i)
    const wc = cellCenter(x, y)
    things.push({ kind, x: wc.x, y: at(x, y).floor, z: wc.z, cell: i })
  }
  const centerCell = (n: Node) => [Math.floor(n.cx), Math.floor(n.cy)] as const

  const [sx, sy] = centerCell(nodes[startRoom])
  const toward = nodes[adj[startRoom][0]]
  const sc = cellCenter(sx, sy)
  const spawn = {
    x: sc.x,
    y: at(sx, sy).floor,
    z: sc.z,
    yaw: Math.atan2(-(toward.cx - nodes[startRoom].cx), -(toward.cy - nodes[startRoom].cy)),
    cell: idx(sx, sy),
  }
  used.add(spawn.cell)
  place('key', ...centerCell(nodes[keyRoom]))
  place('exit', ...centerCell(nodes[exitRoom]))

  for (const n of nodes) {
    const r = n.room
    const free: [number, number][] = []
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const c = at(x, y)
        if (!c.solid && c.room === r.id && !c.liquid && !used.has(idx(x, y))) free.push([x, y])
      }
    }
    rng.shuffle(free)
    const count = r.kind === 'base' ? rng.int(1, 2) : rng.int(0, 2)
    for (let i = 0; i < count && free.length; i++) {
      const [x, y] = free.pop()!
      place(rng.pick(['health', 'ammo', 'ammo', 'armor'] as const), x, y)
    }
  }

  return {
    seed,
    width: W,
    height: H,
    cells,
    rooms,
    edges,
    things,
    lights,
    spawn,
    startRoom,
    keyRoom,
    exitRoom,
    kind: 'caves',
    props,
    cornerJitter: 0.55,
  }
}

/** Zet decor in een basiskamer, afhankelijk van zijn functie. */
function decorateBaseRoom(r: Room, cells: Cell[], rng: Rng, props: Prop[], occupied: Set<number>, lights: Light[]) {
  const at = (x: number, y: number) => cells[y * W + x]
  const purpose = r.purpose ?? 'storage'

  // binnenkant van de deuren vrijhouden (en een cel eromheen)
  const blocked = new Set<number>()
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const nearDoor = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ].some(([nx, ny]) => {
        const c = at(nx, ny)
        return c.slide || c.door || (c.corridor >= 1000 && !c.solid)
      })
      if (!nearDoor) continue
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) blocked.add((y + dy) * W + (x + dx))
    }
  }

  // randcellen met hun richting de kamer in
  const spots: { x: number; y: number; nx: number; ny: number; corner: boolean }[] = []
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (blocked.has(y * W + x)) continue
      const left = x === r.x
      const right = x === r.x + r.w - 1
      const top = y === r.y
      const bottom = y === r.y + r.h - 1
      if (!left && !right && !top && !bottom) continue
      const corner = (left || right) && (top || bottom)
      // muur aan de x-kant heeft voorrang
      const nx = left ? 1 : right ? -1 : 0
      const ny = nx !== 0 ? 0 : top ? 1 : -1
      spots.push({ x, y, nx, ny, corner })
    }
  }
  rng.shuffle(spots)

  const add = (kind: Extract<Prop, { x: number }>['kind'], s: (typeof spots)[number], depth: number, solid = true, variant = 0) => {
    const c = at(s.x, s.y)
    const wc = cellCenter(s.x, s.y)
    const back = CELL / 2 - depth / 2 - 0.08
    props.push({
      kind,
      x: wc.x - s.nx * back,
      y: c.floor,
      z: wc.z - s.ny * back,
      rot: Math.atan2(s.nx, s.ny),
      variant,
    })
    if (solid) {
      c.prop = true
      occupied.add(s.y * W + s.x)
    }
  }
  const take = (n: number, filter: (s: (typeof spots)[number]) => boolean = () => true) => {
    const out: typeof spots = []
    for (let i = spots.length - 1; i >= 0 && out.length < n; i--) {
      if (!filter(spots[i])) continue
      out.push(...spots.splice(i, 1))
    }
    return out
  }

  if (purpose === 'server') {
    for (const s of take(Math.ceil(spots.length * 0.8))) add('rack', s, 1.0, true, rng.int(0, 3))
  } else if (purpose === 'control') {
    for (const s of take(Math.max(2, Math.floor(spots.length * 0.35)), (s) => !s.corner)) add('terminal', s, 0.75, true, rng.int(0, 3))
    for (const s of take(Math.max(2, Math.floor(spots.length * 0.25)))) add('switchboard', s, 0.22, false, rng.int(0, 3))
  } else if (purpose === 'lab') {
    const cages = take(rng.int(3, 4), (s) => s.corner || rng.chance(0.5))
    for (const s of cages) {
      add('cage', s, 1.7, true, rng.int(0, 3))
      const wc = cellCenter(s.x, s.y)
      lights.push({ x: wc.x, y: r.ceil - 0.4, z: wc.z, radius: 5, color: [LIGHT.alarm[0], LIGHT.alarm[1], LIGHT.alarm[2]] })
    }
    for (const s of take(2, (s) => !s.corner)) add('terminal', s, 0.75, true, rng.int(0, 3))
    for (const s of take(1)) add('switchboard', s, 0.22, false, rng.int(0, 3))
  } else if (purpose === 'storage') {
    for (const s of take(Math.ceil(spots.length * 0.55))) add('crate', s, 1.3, true, rng.int(0, 3))
    for (const s of take(1)) add('switchboard', s, 0.22, false, rng.int(0, 3))
  } else if (purpose === 'reactor') {
    for (const s of take(4)) add('switchboard', s, 0.22, false, rng.int(0, 3))
    for (const s of take(2, (s) => !s.corner)) add('terminal', s, 0.75, true, rng.int(0, 3))
  }

  // pijpen langs twee muren, net onder het plafond
  const x0 = r.x * CELL + 0.3
  const x1 = (r.x + r.w) * CELL - 0.3
  const z0 = r.y * CELL + 0.3
  const z1 = (r.y + r.h) * CELL - 0.3
  const y = r.ceil - 0.35
  const colors = [0x8a3a22, 0x55684a, 0x6e7680]
  props.push({ kind: 'pipe', points: [[x0, y, z0], [x1, y, z0]], radius: 0.12, color: rng.pick(colors) })
  props.push({ kind: 'pipe', points: [[x0, y - 0.3, z0 + 0.05], [x0, y - 0.3, z1]], radius: 0.08, color: rng.pick(colors) })
  props.push({ kind: 'cable', points: [[x1, y + 0.1, z0 + 0.2], [x1, y - 0.4, (z0 + z1) / 2], [x1, y + 0.1, z1]], radius: 0.06, color: 0x1a1a1a })

  // licht
  const color = LIGHT[purpose]
  const spots4: [number, number][] =
    r.w * r.h >= 40
      ? [
          [0.28, 0.28],
          [0.72, 0.28],
          [0.28, 0.72],
          [0.72, 0.72],
        ]
      : [
          [0.35, 0.5],
          [0.65, 0.5],
        ]
  for (const [fx, fy] of spots4) {
    lights.push({ x: (r.x + r.w * fx) * CELL, y: r.ceil - 0.5, z: (r.y + r.h * fy) * CELL, radius: Math.max(r.w, r.h) * CELL * 0.7 + 4, color: [...color] })
  }
}

/** Pijpen en kabels langs een tunnel, plus lampen aan het plafond. */
function decorateTunnel(t: Tunnel, cells: Cell[], rng: Rng, props: Prop[], lights: Light[]) {
  const pts = t.points
  if (pts.length < 6) return
  const at = (x: number, y: number) => cells[Math.floor(y) * W + Math.floor(x)]
  const side = (i: number, offset: number, height: number): [number, number, number] => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l = Math.hypot(dx, dy) || 1
    // loodrecht op de looprichting
    const ox = (-dy / l) * offset
    const oy = (dx / l) * offset
    return [(pts[i].x + ox) * CELL, pts[i].floor + height, (pts[i].y + oy) * CELL]
  }

  if (rng.chance(0.75)) {
    const pipe: [number, number, number][] = []
    for (let i = 0; i < pts.length; i += 3) pipe.push(side(i, 0.68, 2.35))
    props.push({ kind: 'pipe', points: pipe, radius: rng.pick([0.1, 0.14, 0.18]), color: rng.pick([0x8a3a22, 0x55684a, 0x6e7680, 0x6a5a30]) })
  }
  if (rng.chance(0.65)) {
    // kabelbundel die tussen beugels doorhangt
    const cable: [number, number, number][] = []
    for (let i = 0; i < pts.length; i += 3) {
      const p = side(i, -0.7, 2.65)
      if ((i / 3) % 2 === 1) p[1] -= 0.35
      cable.push(p)
    }
    props.push({ kind: 'cable', points: cable, radius: 0.07, color: 0x151515 })
  }

  // lampen hier en daar aan het plafond
  for (let i = 5; i < pts.length - 3; i += 12) {
    const c = at(pts[i].x, pts[i].y)
    if (c.solid) continue
    const x = pts[i].x * CELL
    const z = pts[i].y * CELL
    props.push({ kind: 'lamp', x, y: c.ceil, z, rot: 0, variant: 0 })
    lights.push({ x, y: c.ceil - 0.5, z, radius: 9, color: [...LIGHT.tunnel] })
  }
}
