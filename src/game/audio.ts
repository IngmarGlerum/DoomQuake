import { player } from './store'

/**
 * Gesynthetiseerde retro-geluiden via WebAudio, dus geen audiobestanden nodig.
 * Geluiden met een positie worden zachter op afstand en links/rechts gepand t.o.v. de speler.
 */
let ctx: AudioContext | null = null
let master: GainNode | null = null

function audio() {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = 0.8
    // lichte compressie zodat de machine gun niet clipt
    const comp = ctx.createDynamicsCompressor()
    master.connect(comp).connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export interface Pos {
  x: number
  y?: number
  z: number
}

/** Uitgang voor één geluid: volume op afstand + stereo-pan op hoek t.o.v. kijkrichting. */
function output(pos?: Pos, volume = 1): AudioNode | null {
  const ac = audio()
  const g = ac.createGain()
  let gain = volume
  if (pos) {
    const dx = pos.x - player.position.x
    const dz = pos.z - player.position.z
    const d = Math.hypot(dx, dz)
    gain *= 1 / (1 + (d / 7) ** 1.5)
    if (gain < 0.01) return null
    const pan = ac.createStereoPanner()
    // rechts-vector van de speler: (cos yaw, -sin yaw)
    const right = (dx * Math.cos(player.yaw) - dz * Math.sin(player.yaw)) / Math.max(d, 0.001)
    pan.pan.value = Math.max(-0.85, Math.min(0.85, right))
    g.connect(pan).connect(master!)
  } else {
    g.connect(master!)
  }
  g.gain.value = gain
  return g
}

const noiseCache = new Map<number, AudioBuffer>()
function noiseBuffer(ac: AudioContext, seconds: number) {
  const key = Math.round(seconds * 100)
  let buf = noiseCache.get(key)
  if (buf) return buf
  buf = ac.createBuffer(1, Math.floor(ac.sampleRate * seconds), ac.sampleRate)
  const data = buf.getChannelData(0)
  // 8-bit-achtige ruis: samples een paar keer herhalen voor een grovere klank
  let v = 0
  for (let i = 0; i < data.length; i++) {
    if (i % 3 === 0) v = Math.random() * 2 - 1
    data[i] = v
  }
  noiseCache.set(key, buf)
  return buf
}

function noise(out: AudioNode, duration: number, from: number, to: number, gain: number, type: BiquadFilterType = 'lowpass', delay = 0) {
  const ac = audio()
  const t = ac.currentTime + delay
  const src = ac.createBufferSource()
  src.buffer = noiseBuffer(ac, duration)
  const filter = ac.createBiquadFilter()
  filter.type = type
  filter.frequency.setValueAtTime(from, t)
  filter.frequency.exponentialRampToValueAtTime(to, t + duration)
  const g = ac.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + duration)
  src.connect(filter).connect(g).connect(out)
  src.start(t)
}

function tone(out: AudioNode, type: OscillatorType, from: number, to: number, duration: number, gain: number, delay = 0) {
  const ac = audio()
  const t = ac.currentTime + delay
  const osc = ac.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(from, t)
  osc.frequency.exponentialRampToValueAtTime(to, t + duration)
  const g = ac.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + duration)
  osc.connect(g).connect(out)
  osc.start(t)
  osc.stop(t + duration)
}

/** Maakt een geluidsfunctie met optionele positie. */
const sound =
  (volume: number, play: (out: AudioNode) => void) =>
  (pos?: Pos): void => {
    const out = output(pos, volume)
    if (out) play(out)
  }

export const sfx = {
  // wapens van de speler
  pistol: sound(0.9, (o) => {
    noise(o, 0.22, 4000, 300, 0.7)
    tone(o, 'square', 180, 50, 0.12, 0.35)
  }),
  shotgun: sound(1, (o) => {
    noise(o, 0.45, 3000, 120, 0.6)
    tone(o, 'square', 120, 40, 0.2, 0.3)
  }),
  machinegun: sound(0.7, (o) => {
    noise(o, 0.11, 5000, 400, 0.6)
    tone(o, 'square', 220, 70, 0.06, 0.25)
  }),
  click: sound(0.6, (o) => tone(o, 'square', 900, 700, 0.04, 0.1)),
  weaponSwitch: sound(0.5, (o) => {
    noise(o, 0.06, 2500, 1500, 0.3, 'bandpass')
    noise(o, 0.06, 1800, 900, 0.3, 'bandpass', 0.1)
  }),

  // inslagen
  ricochet: sound(0.6, (o) => {
    noise(o, 0.07, 6000, 1500, 0.4, 'highpass')
    if (Math.random() < 0.45) tone(o, 'sine', 2600 + Math.random() * 1500, 700, 0.18, 0.12, 0.01)
  }),
  flesh: sound(0.8, (o) => {
    noise(o, 0.12, 700, 120, 0.8)
    tone(o, 'sine', 140, 60, 0.08, 0.3)
  }),
  explosion: sound(1, (o) => {
    noise(o, 0.7, 1800, 60, 0.9)
    tone(o, 'sawtooth', 90, 30, 0.5, 0.25)
  }),

  // vijanden
  alert: sound(0.7, (o) => {
    tone(o, 'sawtooth', 160, 90, 0.35, 0.25)
    tone(o, 'square', 240, 120, 0.3, 0.12, 0.05)
  }),
  growl: sound(0.8, (o) => {
    tone(o, 'sawtooth', 90, 55, 0.5, 0.3)
    noise(o, 0.5, 600, 200, 0.25)
  }),
  enemyShot: sound(0.8, (o) => {
    noise(o, 0.2, 3500, 250, 0.6)
    tone(o, 'square', 160, 60, 0.1, 0.25)
  }),
  fireball: sound(0.7, (o) => {
    noise(o, 0.5, 400, 2500, 0.4, 'bandpass')
    tone(o, 'triangle', 200, 500, 0.3, 0.1)
  }),
  bite: sound(0.9, (o) => {
    noise(o, 0.15, 1200, 200, 0.7)
    tone(o, 'square', 100, 70, 0.1, 0.3)
  }),
  pain: sound(0.7, (o) => tone(o, 'sawtooth', 320, 140, 0.18, 0.25)),
  death: sound(0.9, (o) => {
    tone(o, 'sawtooth', 300, 40, 0.7, 0.3)
    noise(o, 0.5, 900, 100, 0.3, 'lowpass', 0.1)
  }),

  // speler en wereld
  pickup: sound(1, (o) => {
    tone(o, 'square', 440, 880, 0.08, 0.15)
    tone(o, 'square', 660, 1320, 0.1, 0.12, 0.07)
  }),
  key: sound(1, (o) => [523, 659, 784, 1046].forEach((f, i) => tone(o, 'square', f, f, 0.12, 0.12, i * 0.08))),
  door: sound(1, (o) => {
    noise(o, 1.0, 500, 120, 0.25)
    tone(o, 'sawtooth', 60, 90, 1.0, 0.1)
  }),
  denied: sound(1, (o) => {
    tone(o, 'square', 220, 200, 0.15, 0.15)
    tone(o, 'square', 160, 150, 0.2, 0.15, 0.12)
  }),
  hurt: sound(1, (o) => {
    tone(o, 'sawtooth', 300, 100, 0.2, 0.2)
    noise(o, 0.15, 900, 200, 0.3)
  }),
  jump: sound(1, (o) => tone(o, 'triangle', 200, 320, 0.08, 0.05)),
  exit: sound(1, (o) => [392, 523, 659, 784, 1046].forEach((f, i) => tone(o, 'square', f, f, 0.18, 0.12, i * 0.1))),
}
