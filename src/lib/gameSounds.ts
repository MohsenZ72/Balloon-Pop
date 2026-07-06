/**
 * Procedural game UI and throw sounds — no external assets.
 */
export function createGameSounds() {
  let ctx: AudioContext | null = null

  const ensureContext = () => {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  }

  const tone = (
    freq: number,
    start: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    decay = true,
  ) => {
    const ac = ensureContext()
    const osc = ac.createOscillator()
    const g = ac.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, start)
    g.gain.setValueAtTime(gain, start)
    if (decay) g.gain.exponentialRampToValueAtTime(0.001, start + dur)
    osc.connect(g).connect(ac.destination)
    osc.start(start)
    osc.stop(start + dur + 0.02)
  }

  return {
    resume() {
      ensureContext()
    },

    playStart() {
      const ac = ensureContext()
      const t = ac.currentTime
      tone(523, t, 0.18, 'triangle', 0.22)
      tone(784, t + 0.1, 0.28, 'triangle', 0.28)
      tone(1047, t + 0.2, 0.35, 'sine', 0.18)
    },

    playCountdown(tick: number | 'go') {
      const ac = ensureContext()
      const t = ac.currentTime
      if (tick === 'go') {
        tone(880, t, 0.35, 'square', 0.2)
        tone(1320, t + 0.05, 0.4, 'triangle', 0.24)
        return
      }
      tone(tick === 1 ? 660 : 520, t, 0.22, 'square', 0.16)
    },

    playWhoosh(scale = 1) {
      const ac = ensureContext()
      const t = ac.currentTime
      const s = Math.min(2, Math.max(0.5, scale))
      const samples = Math.floor(ac.sampleRate * 0.14)
      const buffer = ac.createBuffer(1, samples, ac.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < samples; i++) {
        const env = 1 - i / samples
        data[i] = (Math.random() * 2 - 1) * env * env
      }
      const noise = ac.createBufferSource()
      noise.buffer = buffer
      const filter = ac.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.setValueAtTime(400 + s * 120, t)
      filter.frequency.exponentialRampToValueAtTime(1800 + s * 200, t + 0.12)
      filter.Q.value = 0.7
      const g = ac.createGain()
      g.gain.setValueAtTime(0.08 + s * 0.06, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14)
      noise.connect(filter).connect(g).connect(ac.destination)
      noise.start(t)
    },

    playMiss() {
      const ac = ensureContext()
      const t = ac.currentTime
      const osc = ac.createOscillator()
      const g = ac.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(320, t)
      osc.frequency.exponentialRampToValueAtTime(140, t + 0.35)
      g.gain.setValueAtTime(0.1, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.38)
      osc.connect(g).connect(ac.destination)
      osc.start(t)
      osc.stop(t + 0.4)
    },

    dispose() {
      void ctx?.close()
      ctx = null
    },
  }
}
