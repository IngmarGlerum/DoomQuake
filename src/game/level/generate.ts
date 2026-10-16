import { makeRng, type Rng } from '../rng'
import { validateLevel } from './validate'
import {
  CELL,
  STEP,
  cellCenter,
  type Cell,
  type EnemyKind,
  type Level,
  type Light,
  type Room,
  type RoomFeature,
  type Theme,
  type Thing,
} from './types'

export interface GenOptions {
  width?: number
  height?: number
  maxRooms?: number
}

const THEME_LIGHT: Record<Theme, [number, number, number]> = {
  tech: [0.8, 0.88, 1.0],
  brick: [1.0, 0.82, 0.55],
  hell: [1.0, 0.42, 0.28],
}

const THEME_ENEMIES: Record<Theme, EnemyKind[]> = {
  tech: ['grunt', 'grunt', 'grunt', 'imp'],
  brick: ['grunt', 'imp', 'imp'],
  hell: ['imp', 'demon', 'demon'],
}

const ROOM_GAP = 2
const CORRIDOR_HEADROOM = 3.5

/**
 * Genereert een speelbaar level uit een seed. Dezelfde seed geeft altijd hetzelfde level.
 *
 * Opzet (klassiek "rooms & corridors", maar met hoogteverschillen):
 * 1. Kamers willekeurig plaatsen zonder overlap.
 * 2. Minimum spanning tree tussen de kamers + een paar extra lussen (Doom-achtige rondjes).
 * 3. Start, sleutel en exit op bladeren van de boom; de exitkamer krijgt deuren.
 * 4. Kamers krijgen elk een vloerhoogte; gangen interpoleren daartussen als trappen.
 * 5. Features in grote kamers: pilaren, verhoogd platform (dais) of een put met nukage.
 * 6. Valideren (bereikbaarheid met/zonder sleutel); mislukt het, dan opnieuw proberen.
 */
export function generateLevel(seed: string, opts: GenOptions = {}): Level {
  const rng = makeRng(seed)
  let lastProblems: string[] = ['te weinig kamers']
  for (let attempt = 0; attempt < 200; attempt++) {
    const level = tryGenerate(seed, rng, opts)
    if (!level) continue
    const result = validateLevel(level)
    if (result.ok) return level
    lastProblems = result.problems
  }
  throw new Error(`Kon geen speelbaar level maken voor seed "${seed}": ${lastProblems.join(', ')}`)
}

function tryGenerate(seed: string, rng: Rng, opts: GenOptions): Level | null {
  const W = opts.width ?? 56
  const H = opts.height ?? 56
  const maxRooms = opts.maxRooms ?? 12

  const cells: Cell[] = Array.from({ length: W * H }, () => ({
    solid: true,
    floor: 0,
    ceil: 0,
    room: -1,
    corridor: -1,
    path: false,
    liquid: false,
    door: false,
    theme: 'tech' as Theme,
  }))
  const idx = (x: number, y: number) => y * W + x
  const at = (x: number, y: number) => cells[idx(x, y)]

  // 1. Kamers plaatsen
  const rooms: Room[] = []
  for (let i = 0; i < 400 && rooms.length < maxRooms; i++) {
    const w = rng.int(4, 11)
    const h = rng.int(4, 11)
    const x = rng.int(1, W - w - 1)
    const y = rng.int(1, H - h - 1)
    const overlaps = rooms.some(
      (r) => x < r.x + r.w + ROOM_GAP && x + w + ROOM_GAP > r.x && y < r.y + r.h + ROOM_GAP && y + h + ROOM_GAP > r.y,
    )
    if (overlaps) continue
    rooms.push({ id: rooms.length, x, y, w, h, floor: 0, ceil: 0, theme: 'tech', feature: 'none', depth: 0 })
  }
  if (rooms.length < 6) return null

  const center = (r: Room) => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) })
  const dist = (a: Room, b: Room) => {
    const ca = center(a)
    const cb = center(b)
    return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y)
  }

  // 2. Minimum spanning tree (Prim)
  const tree: [number, number][] = []
  const inTree = new Set([0])
  while (inTree.size < rooms.length) {
    let best: [number, number] = [-1, -1]
    let bestD = Infinity
    for (const a of inTree) {
      for (const b of rooms) {
        if (inTree.has(b.id)) continue
        const d = dist(rooms[a], b)
        if (d < bestD) {
          bestD = d
          best = [a, b.id]
        }
      }
    }
    tree.push(best)
    inTree.add(best[1])
  }
  const adj: number[][] = rooms.map(() => [])
  for (const [a, b] of tree) {
    adj[a].push(b)
    adj[b].push(a)
  }

  // 3. Start, exit en sleutel kiezen op bladeren van de boom
  const leaves = rooms.filter((r) => adj[r.id].length === 1).map((r) => r.id)
  if (leaves.length < 3) return null
  const startRoom = rng.pick(leaves)

  const order: number[] = [startRoom]
  const parent = new Array<number>(rooms.length).fill(-1)
  const pathLen = new Array<number>(rooms.length).fill(0)
  parent[startRoom] = startRoom
  for (let i = 0; i < order.length; i++) {
    const a = order[i]
    for (const b of adj[a]) {
      if (parent[b] !== -1) continue
      parent[b] = a
      rooms[b].depth = rooms[a].depth + 1
      pathLen[b] = pathLen[a] + dist(rooms[a], rooms[b])
      order.push(b)
    }
  }
  const byFar = leaves.filter((l) => l !== startRoom).sort((a, b) => pathLen[b] - pathLen[a])
  const exitRoom = byFar[0]
  const keyRoom = byFar[1]

  // 4. Hoogtes en thema's per kamer
  const maxDepth = Math.max(...rooms.map((r) => r.depth))
  for (const id of order) {
    const r = rooms[id]
    if (id === startRoom) {
      r.floor = 0
    } else {
      const level = Math.round(rooms[parent[id]].floor) + rng.pick([-1, 0, 0, 1, 1])
      r.floor = Math.max(-1, Math.min(3, level))
    }
    const area = r.w * r.h
    r.ceil = r.floor + 4 + (area >= 50 ? 2 : 0) + rng.int(0, 2)
    const f = r.depth / maxDepth
    r.theme = f < 0.34 ? 'tech' : f < 0.67 ? 'brick' : 'hell'
  }

  // Extra lussen, zodat het level niet puur een boom is
  const edges: [number, number][] = [...tree]
  const treeKey = new Set(tree.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`))
  const candidates: [number, number][] = []
  for (const a of rooms) {
    for (const b of rooms) {
      if (a.id >= b.id || a.id === exitRoom || b.id === exitRoom) continue
      if (treeKey.has(`${a.id}-${b.id}`)) continue
      if (Math.abs(a.floor - b.floor) > 1 || dist(a, b) > 30) continue
      candidates.push([a.id, b.id])
    }
  }
  candidates.sort((p, q) => dist(rooms[p[0]], rooms[p[1]]) - dist(rooms[q[0]], rooms[q[1]]))
  const loopCount = Math.round(rooms.length / 4)
  for (const c of candidates) {
    if (edges.length - tree.length >= loopCount) break
    if (rng.chance(0.6)) edges.push(c)
  }

  // Kamers uitgraven
  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        Object.assign(at(x, y), { solid: false, room: r.id, floor: r.floor, ceil: r.ceil, theme: r.theme })
      }
    }
  }

  // Gangen uitgraven (2 cellen breed) met trappen tussen de kamerhoogtes
  const lights: Light[] = []
  const quant = (h: number) => Math.round(h / STEP) * STEP
  edges.forEach(([ia, ib], e) => {
    const A = rooms[ia]
    const B = rooms[ib]
    const theme = A.depth >= B.depth ? A.theme : B.theme
    const ca = center(A)
    const cb = center(B)

    const path: [number, number][] = [[ca.x, ca.y]]
    let x = ca.x
    let y = ca.y
    const walkTo = (tx: number, ty: number) => {
      while (x !== tx) {
        x += Math.sign(tx - x)
        path.push([x, y])
      }
      while (y !== ty) {
        y += Math.sign(ty - y)
        path.push([x, y])
      }
    }
    if (rng.chance(0.5)) walkTo(cb.x, ca.y)
    else walkTo(ca.x, cb.y)
    walkTo(cb.x, cb.y)

    // Ankers: kamers en eerder gegraven gangen hebben al een vaste hoogte
    const anchors = path.map(([px, py]) => {
      const c = at(px, py)
      if (c.room >= 0) return c.floor
      if (!c.solid && c.corridor !== e) return c.floor
      return null
    })
    const heights = new Array<number>(path.length)
    let prev = 0
    for (let i = 0; i < path.length; i++) {
      const h1 = anchors[i]
      if (h1 === null) continue
      const h0 = anchors[prev]!
      for (let k = prev; k <= i; k++) heights[k] = k === i ? h1 : quant(h0 + ((h1 - h0) * (k - prev)) / (i - prev))
      prev = i
    }

    path.forEach(([px, py], i) => {
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        const c = at(px + dx, py + dy)
        if (c.room >= 0) {
          c.path = true
          continue
        }
        if (!c.solid && c.corridor !== e) continue
        Object.assign(c, {
          solid: false,
          corridor: e,
          path: true,
          floor: heights[i],
          ceil: heights[i] + CORRIDOR_HEADROOM,
          theme,
        })
      }
      const c = at(px, py)
      if (i % 6 === 3 && c.corridor === e) {
        const wc = cellCenter(px + 0.5, py + 0.5)
        const [r, g, b] = THEME_LIGHT[theme]
        lights.push({ x: wc.x, y: c.ceil - 0.4, z: wc.z, radius: 9, color: [r * 0.75, g * 0.75, b * 0.75] })
      }
    })
  })

  // 5. Features in grote kamers
  const forInset = (r: Room, inset: number, fn: (c: Cell, x: number, y: number) => void) => {
    for (let y = r.y + inset; y < r.y + r.h - inset; y++) {
      for (let x = r.x + inset; x < r.x + r.w - inset; x++) fn(at(x, y), x, y)
    }
  }
  for (const r of rooms) {
    if (r.w < 6 || r.h < 6) continue
    let feature: RoomFeature = rng.pick(['none', 'pillars', 'dais', 'dais', 'pit', 'pit'])
    if (r.id === startRoom && feature === 'pit') feature = 'pillars'
    r.feature = feature
    if (feature === 'pillars') {
      forInset(r, 1, (c, x, y) => {
        if (!c.path && (x - r.x) % 3 === 1 && (y - r.y) % 3 === 1) c.solid = true
      })
    } else if (feature === 'dais') {
      forInset(r, 1, (c) => !c.path && (c.floor = r.floor + 0.5))
      forInset(r, 2, (c) => !c.path && (c.floor = r.floor + 1))
    } else if (feature === 'pit') {
      forInset(r, 1, (c) => !c.path && (c.floor = r.floor - 0.5))
      forInset(r, 2, (c) => {
        if (c.path) return
        c.floor = r.floor - 1
        c.liquid = true
      })
    }
    // Hoog middenplafond in grote zalen
    if (r.w >= 8 && r.h >= 8) forInset(r, 2, (c) => (c.ceil = r.ceil + 2))
  }

  // Deuren: elke gangcel die aan de exitkamer grenst
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const c = at(x, y)
      if (c.solid || c.room >= 0) continue
      const n = [at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)]
      if (n.some((o) => !o.solid && o.room === exitRoom)) c.door = true
    }
  }

  // 6. Lampen per kamer
  for (const r of rooms) {
    const [cr, cg, cb] = THEME_LIGHT[r.theme]
    const radius = Math.max(r.w, r.h) * CELL * 0.75 + 5
    const spots: [number, number][] =
      r.w * r.h >= 40
        ? [
            [0.25, 0.25],
            [0.75, 0.25],
            [0.25, 0.75],
            [0.75, 0.75],
          ]
        : [[0.5, 0.5]]
    for (const [fx, fy] of spots) {
      lights.push({ x: (r.x + r.w * fx) * CELL, y: r.ceil - 0.6, z: (r.y + r.h * fy) * CELL, radius, color: [cr, cg, cb] })
    }
    if (r.feature === 'pit') {
      lights.push({ x: (r.x + r.w / 2) * CELL, y: r.floor - 0.6, z: (r.y + r.h / 2) * CELL, radius: 9, color: [0.3, 0.9, 0.2] })
    }
    if (r.id === exitRoom) {
      lights.push({ x: (r.x + r.w / 2) * CELL, y: r.floor + 1.5, z: (r.y + r.h / 2) * CELL, radius: 10, color: [1, 0.2, 0.15] })
    }
  }

  // 7. Things: spawn, sleutel, exit, vijanden en pickups
  const used = new Set<number>()
  const things: Thing[] = []
  const place = (kind: Thing['kind'], x: number, y: number, extra: Partial<Thing> = {}) => {
    const i = idx(x, y)
    used.add(i)
    const wc = cellCenter(x, y)
    things.push({ kind, x: wc.x, y: at(x, y).floor, z: wc.z, cell: i, ...extra })
  }
  const roomCells = (r: Room) => {
    const out: [number, number][] = []
    forInset(r, 0, (c, x, y) => {
      if (!c.solid && !c.liquid && !used.has(idx(x, y))) out.push([x, y])
    })
    return out
  }

  const sc = center(rooms[startRoom])
  const firstNeighbour = center(rooms[adj[startRoom][0]])
  const spawnPos = cellCenter(sc.x, sc.y)
  const spawn = {
    x: spawnPos.x,
    y: at(sc.x, sc.y).floor,
    z: spawnPos.z,
    yaw: Math.atan2(-(firstNeighbour.x - sc.x), -(firstNeighbour.y - sc.y)),
    cell: idx(sc.x, sc.y),
  }
  used.add(spawn.cell)

  // Sleutel bij voorkeur bovenop het platform
  const kr = rooms[keyRoom]
  const keySpots = roomCells(kr)
  const top = Math.max(...keySpots.map(([x, y]) => at(x, y).floor))
  const keySpot = kr.feature === 'dais' ? keySpots.find(([x, y]) => at(x, y).floor === top)! : [center(kr).x, center(kr).y]
  place('key', keySpot[0], keySpot[1])

  const ec = center(rooms[exitRoom])
  place('exit', ec.x, ec.y)

  for (const r of rooms) {
    if (r.id === startRoom) continue
    const spots = rng.shuffle(roomCells(r))
    const enemies = Math.max(1, Math.min(6, Math.round((r.w * r.h) / 14) + Math.floor(r.depth / 2)))
    for (let i = 0; i < enemies && spots.length; i++) {
      const [x, y] = spots.pop()!
      place('enemy', x, y, { enemy: rng.pick(THEME_ENEMIES[r.theme]) })
    }
  }
  for (const r of rooms) {
    const spots = rng.shuffle(roomCells(r))
    const n = rng.int(0, 2) + (r.id === startRoom ? 1 : 0)
    for (let i = 0; i < n && spots.length; i++) {
      const [x, y] = spots.pop()!
      place(rng.pick(['health', 'ammo', 'ammo', 'armor'] as const), x, y)
    }
  }

  return { seed, width: W, height: H, cells, rooms, edges, things, lights, spawn, startRoom, keyRoom, exitRoom }
}
