import { envelopeAt, pitchJitter, SFX_TABLE, SfxName } from "./sfxDefs"

export type PlayOptions = {
    pitchSeed?: number
    pitchSemitones?: number
    gainScale?: number
}

// Procedural Web Audio synthesiser. Owns a single lazily-created AudioContext
// and a master GainNode. Every SFX is built from oscillators + optional white
// noise driven by the pure definitions in sfxDefs — no audio asset files exist.
export class AudioManager {
    private ctx?: AudioContext
    private masterGain?: GainNode

    private _volume = 0.8
    private _muted = false

    get volume(): number {
        return this._volume
    }

    get muted(): boolean {
        return this._muted
    }

    // Create the AudioContext + master gain. Browsers start the context in a
    // "suspended" state until a user gesture resumes it; that is fine here.
    init() {
        if (typeof window === "undefined") return
        if (this.ctx) return

        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (typeof Ctor === "undefined") return

        this.ctx = new Ctor()
        this.masterGain = this.ctx.createGain()
        this.masterGain.gain.value = this._muted ? 0 : this._volume
        this.masterGain.connect(this.ctx.destination)
    }

    // Resume a suspended context (call from a user-gesture handler).
    resume() {
        if (this.ctx && this.ctx.state === "suspended") {
            void this.ctx.resume()
        }
    }

    play(name: SfxName, opts: PlayOptions = {}) {
        if (!this.ctx || this.ctx.state !== "running") return
        if (!this.masterGain) return

        const def = SFX_TABLE[name]
        if (typeof def === "undefined") return

        const ctx = this.ctx
        const now = ctx.currentTime
        const end = now + def.duration

        const playGain = ctx.createGain()
        playGain.connect(this.masterGain)

        // Schedule the amplitude envelope. Each point's gain is scaled by the
        // definition gain and the optional per-play gainScale.
        const gainScale = def.gain * (opts.gainScale ?? 1)
        playGain.gain.cancelScheduledValues(now)
        for (const point of def.envelope) {
            const value = envelopeAt(def.envelope, point.t) * gainScale
            playGain.gain.setValueAtTime(value, now + point.t * def.duration)
        }

        // Oscillator: ramp frequency from start to end across the duration.
        const osc = ctx.createOscillator()
        osc.type = def.waveform
        osc.frequency.setValueAtTime(def.frequency, now)
        osc.frequency.linearRampToValueAtTime(def.frequencyEnd, end)

        const baseDetune = def.detune ?? 0
        const jitter = pitchJitter(opts.pitchSeed ?? 0, opts.pitchSemitones ?? 0)
        osc.detune.setValueAtTime(baseDetune + jitter, now)

        osc.connect(playGain)

        // Optional white-noise layer mixed in by noiseAmount.
        let noise: AudioBufferSourceNode | undefined
        let noiseGain: GainNode | undefined
        if (def.noiseAmount > 0) {
            const length = Math.max(1, Math.ceil(ctx.sampleRate * def.duration))
            const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
            const data = buffer.getChannelData(0)
            for (let i = 0; i < length; i++) {
                data[i] = Math.random() * 2 - 1
            }
            noise = ctx.createBufferSource()
            noise.buffer = buffer
            noiseGain = ctx.createGain()
            noiseGain.gain.setValueAtTime(def.noiseAmount, now)
            noise.connect(noiseGain)
            noiseGain.connect(playGain)
        }

        osc.onended = () => {
            osc.disconnect()
            noise?.disconnect()
            noiseGain?.disconnect()
            playGain.disconnect()
        }

        osc.start(now)
        osc.stop(end)
        noise?.start(now)
        noise?.stop(end)
    }

    setMasterVolume(v: number) {
        this._volume = Math.min(1, Math.max(0, v))
        if (this.masterGain && !this._muted) {
            this.masterGain.gain.value = this._volume
        }
    }

    setMuted(b: boolean) {
        this._muted = b
        if (this.masterGain) {
            this.masterGain.gain.value = b ? 0 : this._volume
        }
    }

    dispose() {
        if (this.ctx) {
            void this.ctx.close()
        }
        this.ctx = undefined
        this.masterGain = undefined
    }
}
