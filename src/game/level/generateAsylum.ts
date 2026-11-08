import { makeRng, type Rng } from '../rng'
import { validateLevel } from './validate'
import { CELL, cellCenter, type Cell, type Level, type Light, type Npc, type NpcBehavior, type Prop, type Room, type RoomPurpose, type Theme, type Thing } from './types'

/**
 * Level 3: een verlaten, griezelig gesticht.
 *
 * - Lange, koele gangen met witte tegels en cyaan lichtstrips langs de muren.
 * - Zalen met ziekenhuisbedden, kamerschermen en tv's aan het plafond.
 * - Onderzoekskamers met een onderzoekstafel, instrumentenkarretje en bloed op de vloer.
 * - Isoleercellen met gecapitonneerde wanden en een matras; oude cellen met een ijzeren bed,
 *   een raam en een po (je wordt wakker in zo'n cel).
 * - Een hoge hal met een loopbrug van roosters over een diepe schacht, met relingen.
 * - Patiënten lopen rond, staren je na of staan wiegend tegen de muur.
 */
const W = 60
const H = 60
const ROOM_GAP = 3
const CORRIDOR_CEIL = 3.2
const PIT_DEPTH = 3.5

const THEME_OF: Record<string, Theme> = { ward: 'asylum', exam: 'asylum', padded: 'padded', cell: 'oldward', atrium: 'atrium' }

const LIGHT = {
  corridor: [0.62, 0.92, 0.9] as [number, number, number],
  ward: [0.78, 0.92, 0.88] as [number, number, number],
  exam: [0.95, 0.98, 0.92] as [number, number, number],
  padded: [0.85, 0.85, 0.8] as [number, number, number],
  cell: [1.0, 0.92, 0.78] as [number, number, number],
  atrium: [0.55, 0.9, 0.95] as [number, number, number],
  pit: [0.25, 0.45, 0.5] as [number, number, number],
  alarm: [1.0, 0.15, 0.1] as [number, number, number],
  monitor: [1.0, 0.75, 0.4] as [number, number, number],
}

export function generateAsylumLevel(seed: string): Level {
  const rng = makeRng(`asylum:${seed}`)
  let lastProblems: string[] = ['te weinig kamers']
  for (let attempt = 0; attempt < 300; attempt++) {
    const level = tryGenerate(seed, rng)
    if (!level) continue
    const result = validateLevel(level)
    if (result.ok) return level
    lastProblems = result.problems
  }
  throw new Error(`Kon geen gesticht maken voor seed "${seed}": ${lastProblems.join(', ')}`)
}

type Spot = { x: number; y: number; nx: number; ny: number; corner: boolean }

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
    theme: 'asylum' as Theme,
  }))
  const idx = (x: number, y: number) => y * W + x
  const at = (x: number, y: number) => cells[idx(x, y)]
  const walkable = (c: Cell) => !c.solid && c.floor > -1

  // 1. Kamers: eerst de grote hal, dan zalen, onderzoekskamers en cellen
  const rooms: Room[] = []
  const overlaps = (x: number, y: number, w: number, h: number) =>
    rooms.some((r) => x < r.x + r.w + ROOM_GAP && x + w + ROOM_GAP > r.x && y < r.y + r.h + ROOM_GAP && y + h + ROOM_GAP > r.y)
  const tryPlace = (w: number, h: number) => {
    for (let i = 0; i < 80; i++) {
      const x = rng.int(2, W - w - 3)
      const y = rng.int(2, H - h - 3)
      if (overlaps(x, y, w, h)) continue
      rooms.push({ id: rooms.length, x, y, w, h, floor: 0, ceil: 0, theme: 'asylum', feature: 'none', depth: 0 })
      return true
    }
    return false
  }
  const atriumSize = rng.int(10, 12)
  if (!tryPlace(atriumSize, atriumSize)) return null
  const wanted = rng.shuffle(['ward', 'ward', 'exam', 'exam', 'small', 'small', 'small', 'small', 'medium', 'medium'])
  for (const kind of wanted) {
    let w: number
    let h: number
    if (kind === 'ward') [w, h] = [rng.int(8, 10), rng.int(6, 7)]
    else if (kind === 'exam') [w, h] = [rng.int(5, 6), rng.int(5, 6)]
    else if (kind === 'small') [w, h] = [3, rng.int(3, 4)]
    else [w, h] = [rng.int(5, 7), rng.int(5, 7)]
    if (rng.chance(0.5)) [w, h] = [h, w]
    tryPlace(w, h)
  }
  if (rooms.length < 8) return null

  const center = (r: Room) => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) })
  const dist = (a: Room, b: Room) => {
    const ca = center(a)
    const cb = center(b)
    return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y)
  }

  // 2. Minimum spanning tree
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

  // 3. Start (een oude cel), sleutel en exit op bladeren; de hal (kamer 0) is nooit een blad-doel
  const leaves = rooms.filter((r) => r.id !== 0 && adj[r.id].length === 1).map((r) => r.id)
  if (leaves.length < 3) return null
  const smallLeaves = leaves.filter((id) => rooms[id].w * rooms[id].h <= 30)
  const startRoom = rng.pick(smallLeaves.length ? smallLeaves : leaves)
  const order = [startRoom]
  const parent = new Array<number>(rooms.length).fill(-1)
  const pathLen = new Array<number>(rooms.length).fill(0)
  parent[startRoom] = startRoom
  for (let i = 0; i < order.length; i++) {
    for (const b of adj[order[i]]) {
      if (parent[b] !== -1) continue
      parent[b] = order[i]
      rooms[b].depth = rooms[order[i]].depth + 1
      pathLen[b] = pathLen[order[i]] + dist(rooms[order[i]], rooms[b])
      order.push(b)
    }
  }
  const byFar = leaves.filter((l) => l !== startRoom).sort((a, b) => pathLen[b] - pathLen[a])
  const exitRoom = byFar[0]
  const keyRoom = byFar[1]

  // 4. Functie, thema en hoogtes per kamer
  let smallCount = 0
  for (const r of rooms) {
    const area = r.w * r.h
    let purpose: RoomPurpose
    if (r.id === 0) purpose = 'atrium'
    else if (r.id === startRoom) purpose = 'cell'
    else if (r.id === exitRoom) purpose = 'exam'
    else if (area <= 16) purpose = smallCount++ % 2 === 0 ? 'padded' : 'cell'
    else if (area >= 42) purpose = 'ward'
    else purpose = rng.pick(['exam', 'ward', 'padded'] as const)
    r.purpose = purpose
    r.theme = THEME_OF[purpose]
    r.floor = 0
    r.ceil = purpose === 'atrium' ? 8 : purpose === 'ward' ? 4 : purpose === 'padded' ? 3 : 3.6
  }

  // extra lussen tussen de grotere kamers (niet via cellen of de exitkamer)
  const edges: [number, number][] = [...tree]
  const treeKey = new Set(tree.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`))
  const big = (r: Room) => r.purpose === 'ward' || r.purpose === 'exam' || r.purpose === 'atrium'
  const candidates: [number, number][] = []
  for (const a of rooms) {
    for (const b of rooms) {
      if (a.id >= b.id || a.id === exitRoom || b.id === exitRoom || !big(a) || !big(b)) continue
      if (treeKey.has(`${a.id}-${b.id}`) || dist(a, b) > 32) continue
      candidates.push([a.id, b.id])
    }
  }
  candidates.sort((p, q) => dist(rooms[p[0]], rooms[p[1]]) - dist(rooms[q[0]], rooms[q[1]]))
  for (const c of candidates) {
    if (edges.length - tree.length >= 2) break
    if (rng.chance(0.6)) edges.push(c)
  }

  // kamers uitgraven
  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) Object.assign(at(x, y), { solid: false, room: r.id, floor: 0, ceil: r.ceil, theme: r.theme })
    }
  }

  // 5. Gangen (2 breed), vlak, met een laag plafond
  edges.forEach(([ia, ib], e) => {
    const ca = center(rooms[ia])
    const cb = center(rooms[ib])
    let x = ca.x
    let y = ca.y
    const path: [number, number][] = [[x, y]]
    const walkTo = (tx: number, ty: number) => {
      while (x !== tx) path.push([(x += Math.sign(tx - x)), y])
      while (y !== ty) path.push([x, (y += Math.sign(ty - y))])
    }
    if (rng.chance(0.5)) walkTo(cb.x, ca.y)
    else walkTo(ca.x, cb.y)
    walkTo(cb.x, cb.y)
    for (const [px, py] of path) {
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        const c = at(px + dx, py + dy)
        c.path = true
        if (c.room >= 0 || (!c.solid && c.corridor !== e)) continue
        Object.assign(c, { solid: false, corridor: e, floor: 0, ceil: CORRIDOR_CEIL, theme: 'asylum' })
      }
    }
  })

  // 6. De hal: schacht in het midden, met loopbruggen waar de gangen binnenkomen
  const atrium = rooms[0]
  const ac = center(atrium)
  for (let y = atrium.y; y < atrium.y + atrium.h; y++) {
    for (let x = atrium.x; x < atrium.x + atrium.w; x++) {
      // altijd een kruis van loopbruggen door het midden
      if (x === ac.x || x === ac.x - 1 || y === ac.y || y === ac.y - 1) at(x, y).path = true
    }
  }
  for (let y = atrium.y + 1; y < atrium.y + atrium.h - 1; y++) {
    for (let x = atrium.x + 1; x < atrium.x + atrium.w - 1; x++) {
      const c = at(x, y)
      if (!c.path) c.floor = -PIT_DEPTH
    }
  }

  // deuren: gangcellen die aan de exitkamer grenzen
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const c = at(x, y)
      if (c.solid || c.room >= 0) continue
      if ([at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)].some((o) => !o.solid && o.room === exitRoom)) c.door = true
    }
  }

  // 7. Licht
  const lights: Light[] = []
  const props: Prop[] = []
  const occupied = new Set<number>()
  const light = (x: number, y: number, z: number, radius: number, color: [number, number, number], k = 1) =>
    lights.push({ x, y, z, radius, color: [color[0] * k, color[1] * k, color[2] * k] })

  for (const r of rooms) {
    const p = r.purpose!
    const cx = (r.x + r.w / 2) * CELL
    const cz = (r.y + r.h / 2) * CELL
    if (p === 'atrium') {
      for (const [fx, fz] of [
        [0.2, 0.2],
        [0.8, 0.2],
        [0.2, 0.8],
        [0.8, 0.8],
      ]) light((r.x + r.w * fx) * CELL, r.ceil - 1, (r.y + r.h * fz) * CELL, r.w * CELL * 0.55, LIGHT.atrium, 0.75)
      light(cx, -PIT_DEPTH + 1, cz, r.w * CELL * 0.5, LIGHT.pit)
      light(cx + 2, 2.5, cz - 2, 6, [1, 0.95, 0.85], 0.9) // de hangende cabine
    } else if (p === 'ward') {
      const n = Math.max(2, Math.round(Math.max(r.w, r.h) / 4))
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n
        const along = r.w >= r.h
        light(along ? (r.x + r.w * f) * CELL : cx, r.ceil - 0.5, along ? cz : (r.y + r.h * f) * CELL, 7.5, LIGHT.ward, 0.8)
      }
    } else if (p === 'exam') {
      light(cx, r.ceil - 0.5, cz, 9, r.id === exitRoom ? LIGHT.alarm : LIGHT.exam, r.id === exitRoom ? 1 : 1.05)
    } else if (p === 'padded') {
      light(cx, r.ceil - 0.4, cz, 6, LIGHT.padded, 0.75)
    } else {
      light(cx, r.ceil - 0.5, cz, 6.5, LIGHT.cell, 0.65)
    }
  }
  // gangverlichting: tl-panelen in het plafond, met hier en daar een kapotte
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const c = at(x, y)
      if (c.solid || c.room >= 0 || c.door || (x * 7 + y * 13) % 9 !== 0) continue
      const wc = cellCenter(x, y)
      const broken = rng.chance(0.22)
      props.push({ kind: 'ceillight', x: wc.x, y: c.ceil, z: wc.z, rot: 0, variant: broken ? 1 : 0 })
      if (!broken) light(wc.x, c.ceil - 0.3, wc.z, 7.5, LIGHT.corridor, 0.8)
    }
  }
  // rood alarmlicht boven de deur van de exit
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (!at(x, y).door || (x + y) % 2) continue
      const wc = cellCenter(x, y)
      light(wc.x, CORRIDOR_CEIL - 0.3, wc.z, 4.5, LIGHT.alarm, 0.8)
    }
  }

  // 8. Decor per kamer
  for (const r of rooms) decorate(r)

  function decorate(r: Room) {
    const purpose = r.purpose!
    // binnenkant van de ingangen vrijhouden
    const blocked = new Set<number>()
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const entrance = [at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)].some((c) => !c.solid && c.room !== r.id)
        if (!entrance && !at(x, y).path) continue
        if (at(x, y).path && !entrance) {
          blocked.add(idx(x, y))
          continue
        }
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) blocked.add(idx(x + dx, y + dy))
      }
    }
    const spots: Spot[] = []
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (blocked.has(idx(x, y)) || !walkable(at(x, y))) continue
        const left = !walkable(at(x - 1, y)) && at(x - 1, y).solid
        const right = !walkable(at(x + 1, y)) && at(x + 1, y).solid
        const top = !walkable(at(x, y - 1)) && at(x, y - 1).solid
        const bottom = !walkable(at(x, y + 1)) && at(x, y + 1).solid
        if (!left && !right && !top && !bottom) continue
        const nx = left ? 1 : right ? -1 : 0
        const ny = nx !== 0 ? 0 : top ? 1 : -1
        spots.push({ x, y, nx, ny, corner: (left || right) && (top || bottom) })
      }
    }
    rng.shuffle(spots)
    const take = (n: number, filter: (s: Spot) => boolean = () => true) => {
      const out: Spot[] = []
      for (let i = spots.length - 1; i >= 0 && out.length < n; i--) {
        if (filter(spots[i])) out.push(...spots.splice(i, 1))
      }
      return out
    }
    /** Decorstuk tegen de muur van deze plek; `depth` = diepte van het stuk. */
    const add = (kind: Extract<Prop, { x: number }>['kind'], s: Spot, depth: number, solid = true, variant = 0, len?: number) => {
      const c = at(s.x, s.y)
      const wc = cellCenter(s.x, s.y)
      const back = CELL / 2 - depth / 2 - 0.06
      props.push({ kind, x: wc.x - s.nx * back, y: c.floor, z: wc.z - s.ny * back, rot: Math.atan2(s.nx, s.ny), variant, len })
      if (solid) {
        c.prop = true
        occupied.add(idx(s.x, s.y))
      }
    }
    const cx = (r.x + r.w / 2) * CELL
    const cz = (r.y + r.h / 2) * CELL

    if (purpose === 'ward') {
      // bedden met het hoofdeinde tegen de lange muren, kamerschermen ertussen
      const beds = take(Math.ceil(spots.length * 0.55), (s) => !s.corner)
      beds.forEach((s, i) => {
        add('bed', s, 2.0, true, rng.int(0, 3))
        const side = Math.abs(s.nx) > 0 ? [0, 1] : [1, 0]
        const beside = at(s.x + side[0], s.y + side[1])
        if (i % 2 === 1 && rng.chance(0.7) && !beside.path && !blocked.has(idx(s.x + side[0], s.y + side[1]))) {
          const wc = cellCenter(s.x, s.y)
          // scherm naast het bed, haaks op de muur
          props.push({ kind: 'screen', x: wc.x + side[0] * 0.95, y: 0, z: wc.z + side[1] * 0.95, rot: Math.atan2(s.nx, s.ny) + Math.PI / 2, variant: rng.int(0, 2) })
        }
      })
      // tv's aan het plafond, boven het midden van de zaal
      const along = r.w >= r.h
      const n = Math.max(2, Math.floor(Math.max(r.w, r.h) / 3))
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n
        const x = along ? (r.x + r.w * f) * CELL : cx
        const z = along ? cz : (r.y + r.h * f) * CELL
        props.push({ kind: 'monitor', x, y: r.ceil, z, rot: rng.chance(0.5) ? 0 : Math.PI, variant: rng.int(0, 3) })
        if (i % 2 === 0) light(x, r.ceil - 1.1, z, 3.5, LIGHT.monitor, 0.6)
      }
      for (const s of take(1)) add('cabinet', s, 0.5, true, rng.int(0, 2))
      bloodIn(r, rng.int(1, 3))
    } else if (purpose === 'exam') {
      // onderzoekstafel in het midden, met een plas bloed eronder
      const tx = r.x + Math.floor(r.w / 2)
      const ty = r.y + Math.floor(r.h / 2)
      const cc = at(tx, ty)
      const rot = r.w >= r.h ? Math.PI / 2 : 0
      props.push({ kind: 'examtable', x: (tx + 0.5) * CELL, y: 0, z: (ty + 0.5) * CELL, rot, variant: 0 })
      props.push({ kind: 'blood', x: (tx + 0.5) * CELL + 0.3, y: 0, z: (ty + 0.5) * CELL - 0.2, rot: rng.next() * 6.28, variant: 0, len: 1.6 })
      cc.prop = true
      occupied.add(idx(tx, ty))
      props.push({ kind: 'monitor', x: (tx + 0.5) * CELL, y: r.ceil, z: (ty + 0.5) * CELL + 1.1, rot: Math.PI, variant: rng.int(0, 3) })
      for (const s of take(1, (s) => !s.corner)) add('trolley', s, 0.6, true)
      for (const s of take(2)) add('cabinet', s, 0.5, true, rng.int(0, 2))
      for (const s of take(1)) add('chair', s, 0.5, false)
      for (const s of take(1, (s) => !s.corner)) add('blood', s, 0.1, false, 2, 1.2)
      bloodIn(r, rng.int(1, 2))
    } else if (purpose === 'padded') {
      const s = take(1, (s) => s.corner)[0] ?? take(1)[0]
      if (s) add('mattress', s, 1.0, false)
    } else if (purpose === 'cell') {
      // ijzeren bed(den) tegen de muur, een raam, een po
      const beds = take(r.w * r.h > 16 ? Math.ceil(spots.length * 0.4) : 1, (s) => !s.corner)
      for (const s of beds) {
        add('ironbed', s, 2.0, true)
        const wc = cellCenter(s.x, s.y)
        props.push({ kind: 'pot', x: wc.x + (s.ny !== 0 ? 0.65 : 0) - s.nx * 0.2, y: 0, z: wc.z + (s.nx !== 0 ? 0.65 : 0) - s.ny * 0.2, rot: 0, variant: 0 })
      }
      for (const s of take(Math.max(1, Math.floor(r.w * r.h / 12)), (s) => !s.corner)) {
        add('window', s, 0.1, false)
        const wc = cellCenter(s.x, s.y)
        light(wc.x - s.nx * 0.7, 2.0, wc.z - s.ny * 0.7, 6, [0.95, 0.95, 1.0], 0.9)
      }
      if (rng.chance(0.4)) bloodIn(r, 1)
    } else if (purpose === 'atrium') {
      // hangende cabine boven de schacht
      props.push({ kind: 'pod', x: cx + 2, y: r.ceil, z: cz - 2, rot: rng.next() * 6.28, variant: 0 })
      // relingen langs de randen van de schacht
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const c = at(x, y)
          if (!walkable(c)) continue
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const o = at(x + dx, y + dy)
            if (o.solid || o.floor > -1) continue
            const wc = cellCenter(x, y)
            props.push({ kind: 'railing', x: wc.x + dx * (CELL / 2 - 0.05), y: c.floor, z: wc.z + dy * (CELL / 2 - 0.05), rot: dx !== 0 ? Math.PI / 2 : 0, variant: 0, len: CELL })
          }
        }
      }
      // bloed op de bodem van de schacht
      props.push({ kind: 'blood', x: cx - 1, y: -PIT_DEPTH, z: cz + 1.5, rot: rng.next() * 6.28, variant: 0, len: 2.2 })
    }
  }

  function bloodIn(r: Room, n: number) {
    for (let i = 0; i < n; i++) {
      const x = r.x + rng.int(0, r.w - 1)
      const y = r.y + rng.int(0, r.h - 1)
      if (!walkable(at(x, y))) continue
      const wc = cellCenter(x, y)
      props.push({ kind: 'blood', x: wc.x + rng.next() - 0.5, y: 0, z: wc.z + rng.next() - 0.5, rot: rng.next() * 6.28, variant: rng.int(0, 1), len: 0.8 + rng.next() * 0.9 })
    }
  }

  // 9. Gangen: rolstoelen, bloedsporen
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const c = at(x, y)
      if (c.solid || c.room >= 0 || c.door) continue
      const wc = cellCenter(x, y)
      if (rng.chance(0.012)) props.push({ kind: 'blood', x: wc.x, y: 0, z: wc.z, rot: rng.next() * 6.28, variant: 1, len: 1.2 + rng.next() })
      if (rng.chance(0.006)) {
        const sides = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].filter(([dx, dy]) => at(x + dx, y + dy).solid)
        if (!sides.length) continue
        const [dx, dy] = sides[0]
        props.push({ kind: 'wheelchair', x: wc.x + dx * 0.55, y: 0, z: wc.z + dy * 0.55, rot: Math.atan2(-dx, -dy) + (rng.next() - 0.5) * 0.8, variant: 0 })
      }
    }
  }

  // 10. Lichtstrips (cyaan) langs de muren van gangen, zalen, onderzoekskamers en de hal
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const c = at(x, y)
      if (!walkable(c) || c.door || (c.theme !== 'asylum' && c.theme !== 'atrium')) continue
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        if (!at(x + dx, y + dy).solid) continue
        if (rng.chance(0.08)) continue // kapot
        const wc = cellCenter(x, y)
        props.push({ kind: 'strip', x: wc.x + dx * (CELL / 2 - 0.03), y: c.floor + 1.05, z: wc.z + dy * (CELL / 2 - 0.03), rot: dx !== 0 ? Math.PI / 2 : 0, variant: 0, len: CELL })
      }
    }
  }

  // 11. Things
  const things: Thing[] = []
  const used = new Set<number>(occupied)
  const place = (kind: Thing['kind'], x: number, y: number) => {
    const i = idx(x, y)
    used.add(i)
    const wc = cellCenter(x, y)
    things.push({ kind, x: wc.x, y: at(x, y).floor, z: wc.z, cell: i })
  }
  const free = (r: Room) => {
    const out: [number, number][] = []
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const c = at(x, y)
        if (walkable(c) && !c.prop && !used.has(idx(x, y))) out.push([x, y])
      }
    }
    return rng.shuffle(out)
  }

  const sr = rooms[startRoom]
  const firstFree = free(sr)
  const sc = center(sr)
  const [sx, sy] = walkable(at(sc.x, sc.y)) && !at(sc.x, sc.y).prop ? [sc.x, sc.y] : firstFree[0]
  if (sx === undefined) return null
  const toward = center(rooms[adj[startRoom][0]])
  const sw = cellCenter(sx, sy)
  const spawn = { x: sw.x, y: 0, z: sw.z, yaw: Math.atan2(-(toward.x - sx), -(toward.y - sy)), cell: idx(sx, sy) }
  used.add(spawn.cell)

  const keySpot = free(rooms[keyRoom])[0]
  const exitSpot = free(rooms[exitRoom])[0]
  if (!keySpot || !exitSpot) return null
  place('key', ...keySpot)
  place('exit', ...exitSpot)
  for (const r of rooms) {
    const spots = free(r)
    const n = rng.int(0, 2) + (r.purpose === 'ward' ? 1 : 0)
    for (let i = 0; i < n && spots.length; i++) place(rng.pick(['health', 'ammo', 'ammo', 'armor'] as const), ...spots.pop()!)
  }

  // 12. Patiënten
  const npcs: Npc[] = []
  const addNpc = (x: number, y: number, behavior: NpcBehavior, yaw = rng.next() * Math.PI * 2) => {
    const i = idx(x, y)
    if (used.has(i)) return
    used.add(i)
    const wc = cellCenter(x, y)
    npcs.push({ x: wc.x, y: at(x, y).floor, z: wc.z, yaw, cell: i, behavior, variant: npcs.length })
  }
  /** kijkrichting naar de dichtstbijzijnde muur (staan tegen de muur) */
  const faceWall = (x: number, y: number) => {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) if (at(x + dx, y + dy).solid) return Math.atan2(-dx, -dy)
    return rng.next() * Math.PI * 2
  }
  for (const r of rooms) {
    if (r.id === startRoom || r.id === exitRoom) continue
    const spots = free(r).filter(([x, y]) => !rooms.some((o) => o.id === startRoom && x >= o.x - 2 && x < o.x + o.w + 2 && y >= o.y - 2 && y < o.y + o.h + 2))
    const pick = () => spots.pop()
    if (r.purpose === 'ward') {
      for (let i = 0; i < rng.int(2, 3); i++) {
        const s = pick()
        if (s) addNpc(s[0], s[1], rng.pick(['wander', 'wander', 'stander', 'rocker'] as const))
      }
    } else if (r.purpose === 'padded') {
      const s = pick()
      if (s) addNpc(s[0], s[1], 'rocker', faceWall(s[0], s[1]))
    } else if (r.purpose === 'cell') {
      const s = pick()
      if (s && rng.chance(0.6)) addNpc(s[0], s[1], 'stander', faceWall(s[0], s[1]))
    } else if (r.purpose === 'exam') {
      const s = pick()
      if (s && rng.chance(0.5)) addNpc(s[0], s[1], 'stander')
    } else if (r.purpose === 'atrium') {
      for (let i = 0; i < 2; i++) {
        const s = pick()
        if (s) addNpc(s[0], s[1], i === 0 ? 'pacer' : 'stander')
      }
    }
  }
  // een paar in de gangen
  const corridorCells: [number, number][] = []
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const c = at(x, y)
      if (walkable(c) && c.room < 0 && !c.door && !used.has(idx(x, y))) corridorCells.push([x, y])
    }
  }
  rng.shuffle(corridorCells)
  const startR = rooms[startRoom]
  let corridorNpcs = 0
  for (const [x, y] of corridorCells) {
    if (corridorNpcs >= 4) break
    if (Math.abs(x - (startR.x + startR.w / 2)) + Math.abs(y - (startR.y + startR.h / 2)) < 8) continue
    addNpc(x, y, rng.pick(['pacer', 'wander', 'stander'] as const), rng.chance(0.5) ? faceWall(x, y) : undefined)
    corridorNpcs++
  }

  return { seed, width: W, height: H, cells, rooms, edges, things, lights, spawn, startRoom, keyRoom, exitRoom, kind: 'asylum', props, npcs }
}
