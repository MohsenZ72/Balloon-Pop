/**
 * Procedural pop — pitch and volume scale with object size.
 * Larger → deeper tone and louder; smaller → higher and quieter.
 */
export function createBubblePopSound() {
  let ctx: AudioContext | null = null

  const ensureContext = () => {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  }

  return {
    /** @param sizeScale ~0.35 tiny … ~2.5 huge (from world radius) */
    play(sizeScale = 1) {
      const ac = ensureContext()
      const t = ac.currentTime
      const s = Math.min(2.5, Math.max(0.35, sizeScale))

      const master = ac.createGain()
      master.connect(ac.destination)
      master.gain.setValueAtTime(0.14 + s * 0.16, t)
      master.gain.exponentialRampToValueAtTime(0.001, t + 0.12 + s * 0.04)

      const samples = Math.floor(ac.sampleRate * (0.07 + s * 0.025))
      const buffer = ac.createBuffer(1, samples, ac.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < samples; i++) {
        const env = 1 - i / samples
        data[i] = (Math.random() * 2 - 1) * env * env
      }
      const noise = ac.createBufferSource()
      noise.buffer = buffer
      const band = ac.createBiquadFilter()
      band.type = 'bandpass'
      band.frequency.value = 1150 - s * 380
      band.Q.value = 0.9 + s * 0.2
      noise.connect(band).connect(master)
      noise.start(t)
      noise.stop(t + 0.07 + s * 0.03)

      const tone = ac.createOscillator()
      tone.type = 'sine'
      const base = 520 - s * 200
      tone.frequency.setValueAtTime(base, t)
      tone.frequency.exponentialRampToValueAtTime(Math.max(60, 140 - s * 30), t + 0.06 + s * 0.02)
      const toneGain = ac.createGain()
      toneGain.gain.setValueAtTime(0.08 + s * 0.06, t)
      toneGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07 + s * 0.02)
      tone.connect(toneGain).connect(master)
      tone.start(t)
      tone.stop(t + 0.08 + s * 0.02)
    },
    dispose() {
      void ctx?.close()
      ctx = null
    },
  }
}
