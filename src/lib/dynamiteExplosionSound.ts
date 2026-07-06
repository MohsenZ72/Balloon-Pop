/**
 * Procedural dynamite boom — low rumble + crack, no audio files.
 */
export function createDynamiteExplosionSound() {
  let ctx: AudioContext | null = null

  const ensureContext = () => {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  }

  return {
    play() {
      const ac = ensureContext()
      const t = ac.currentTime
      const master = ac.createGain()
      master.connect(ac.destination)
      master.gain.setValueAtTime(0.65, t)
      master.gain.exponentialRampToValueAtTime(0.001, t + 1.1)

      const rumble = ac.createOscillator()
      rumble.type = 'sine'
      rumble.frequency.setValueAtTime(110, t)
      rumble.frequency.exponentialRampToValueAtTime(28, t + 0.5)
      const rumbleGain = ac.createGain()
      rumbleGain.gain.setValueAtTime(0.5, t)
      rumbleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.55)
      rumble.connect(rumbleGain).connect(master)
      rumble.start(t)
      rumble.stop(t + 0.55)

      const samples = Math.floor(ac.sampleRate * 0.35)
      const buffer = ac.createBuffer(1, samples, ac.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < samples; i++) {
        const env = Math.pow(1 - i / samples, 1.4)
        data[i] = (Math.random() * 2 - 1) * env
      }
      const crack = ac.createBufferSource()
      crack.buffer = buffer
      const crackFilter = ac.createBiquadFilter()
      crackFilter.type = 'lowpass'
      crackFilter.frequency.setValueAtTime(2200, t)
      crackFilter.frequency.exponentialRampToValueAtTime(180, t + 0.3)
      crack.connect(crackFilter).connect(master)
      crack.start(t)
      crack.stop(t + 0.35)

      const hit = ac.createOscillator()
      hit.type = 'square'
      hit.frequency.setValueAtTime(90, t)
      hit.frequency.exponentialRampToValueAtTime(40, t + 0.08)
      const hitGain = ac.createGain()
      hitGain.gain.setValueAtTime(0.22, t)
      hitGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12)
      hit.connect(hitGain).connect(master)
      hit.start(t)
      hit.stop(t + 0.12)
    },
    dispose() {
      void ctx?.close()
      ctx = null
    },
  }
}
