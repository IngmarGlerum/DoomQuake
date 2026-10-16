/**
 * Gesynthetiseerde retro-geluiden via WebAudio, dus geen audiobestanden nodig.
 * Later te vervangen door samples (bijv. Kenney/freesound, CC0).
 */
let ctx: AudioContext | null = null

function audio() {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function noiseBuffer(ac: AudioContext, seconds: number) {
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * seconds), ac.sampleRate)
  const data = buf.getChannelData(0)
  // 8-bit-achtige ruis: samples een paar keer herhalen voor een grovere klank
  let v = 0
  for (let i = 0; i < data.length; i++) {
    if (i % 3 === 0) v = Math.random() * 2 - 1
    data[i] = v
  }
  return buf
}

function noiseBurst(duration: number, freq: number, gain: number) {
  const ac = audio()
  const src = ac.createBufferSource()
  src.buffer = noiseBuffer(ac, duration)
  const filter = ac.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(freq, ac.currentTime)
  filter.frequency.exponentialRampToValueAtTime(120, ac.currentTime + duration)
  const g = ac.createGain()
  g.gain.setValueAtTime(gain, ac.currentTime)
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration)
  src.connect(filter).connect(g).connect(ac.destination)
  src.start()
}

function tone(type: OscillatorType, from: number, to: number, duration: number, gain: number, delay = 0) {
  const ac = audio()
  const t = ac.currentTime + delay
  const osc = ac.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(from, t)
  osc.frequency.exponentialRampToValueAtTime(to, t + duration)
  const g = ac.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + duration)
  osc.connect(g).connect(ac.destination)
  osc.start(t)
  osc.stop(t + duration)
}

export const sfx = {
  shotgun() {
    noiseBurst(0.45, 3000, 0.6)
    tone('square', 120, 40, 0.2, 0.3)
  },
  click() {
    tone('square', 900, 700, 0.04, 0.1)
  },
  pickup() {
    tone('square', 440, 880, 0.08, 0.15)
    tone('square', 660, 1320, 0.1, 0.12, 0.07)
  },
  key() {
    ;[523, 659, 784, 1046].forEach((f, i) => tone('square', f, f, 0.12, 0.12, i * 0.08))
  },
  door() {
    noiseBurst(1.0, 500, 0.25)
    tone('sawtooth', 60, 90, 1.0, 0.1)
  },
  denied() {
    tone('square', 220, 200, 0.15, 0.15)
    tone('square', 160, 150, 0.2, 0.15, 0.12)
  },
  hurt() {
    tone('sawtooth', 300, 100, 0.2, 0.15)
  },
  jump() {
    tone('triangle', 200, 320, 0.08, 0.05)
  },
  exit() {
    ;[392, 523, 659, 784, 1046].forEach((f, i) => tone('square', f, f, 0.18, 0.12, i * 0.1))
  },
}
