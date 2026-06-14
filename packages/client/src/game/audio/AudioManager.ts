import { readAudioSettings } from "../../store/audioSettings"
import { envelopeAt, pitchJitter, SFX_TABLE, SfxName } from "./sfxDefs"

export type PlayOptions = {
    pitchSeed?: number
    pitchSemitones?: number
    gainScale?: number
}

// Single global softening factor applied to every voice's peak gain. The raw
// per-SFX gains in sfxDefs were tuned by ear and turned out far too hot; rather
// than hand-edit a dozen numbers we scale them all here. 0.55 roughly halves
// the loudness while preserving the relative balance between cues.
const MASTER_SFX_GAIN = 0.55

// Minimum attack applied to every voice so the onset ramps up from silence
// instead of stepping on instantly (instant steps read as a click and add to
// the perceived harshness). Capped per-voice so very short SFX still trigger.
const ATTACK_TIME = 0.006

// Procedural Web Audio synthesiser. Owns a single lazily-created AudioContext
// and a master signal chain. Every SFX is built from oscillators + optional
// white noise driven by the pure definitions in sfxDefs - no audio asset files
// exist.
//
// Master chain (every voice routes through it, nothing bypasses):
//   playGain -> masterGain -> masterLowpass -> masterLimiter -> destination
//
// The GainNode is the user-facing volume/mute control. The low-pass shaves off
// the brittle high end that made the square/sawtooth cues feel harsh. The
// limiter is a brick-wall safety net: no matter how many SFX stack up, peaks
// can never blast the speakers.
export class AudioManager {
    private ctx?: AudioContext
    private masterGain?: GainNode
    private masterLowpass?: BiquadFilterNode
    private masterLimiter?: DynamicsCompressorNode

    // Keep this in sync with DEFAULT_AUDIO_SETTINGS.volume; init() immediately
    // overwrites it with the persisted value, so this only matters before init.
    private _volume = 0.35
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

        // Brick-wall-ish limiter at the end of the chain. A low threshold plus a
        // hard ratio and zero knee turns this DynamicsCompressorNode into a
        // ceiling: transients above ~-8 dB get clamped instead of clipping the
        // speakers. Fast attack catches the percussive shoot/explosion onsets;
        // the short release lets it recover between bursts without pumping.
        this.masterLimiter = this.ctx.createDynamicsCompressor()
        this.masterLimiter.threshold.value = -8
        this.masterLimiter.knee.value = 0
        this.masterLimiter.ratio.value = 20
        this.masterLimiter.attack.value = 0.003
        this.masterLimiter.release.value = 0.1
        this.masterLimiter.connect(this.ctx.destination)

        // Gentle one-pole low-pass to take the edge off the square/sawtooth
        // cues. 4 kHz keeps the sounds bright and recognisable while removing
        // the brittle, ear-piercing top end that made them feel harsh.
        this.masterLowpass = this.ctx.createBiquadFilter()
        this.masterLowpass.type = "lowpass"
        this.masterLowpass.frequency.value = 4000
        this.masterLowpass.connect(this.masterLimiter)

        this.masterGain = this.ctx.createGain()
        this.masterGain.connect(this.masterLowpass)

        // Apply the persisted settings so the actual audio output matches the
        // UI on a fresh load, instead of falling back to the 0.8/unmuted
        // defaults until the user touches the slider.
        const persisted = readAudioSettings()
        this.setMasterVolume(persisted.volume)
        this.setMuted(persisted.muted)
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
        // definition gain, the global MASTER_SFX_GAIN softening factor, and the
        // optional per-play gainScale.
        //
        // We ramp *between* points rather than stepping with setValueAtTime so
        // there are no instant on/off clicks. The very first point is forced
        // through a tiny attack ramp (ATTACK_TIME) from silence, and the tail
        // always lands on (near-)zero, so every voice fades in and out smoothly.
        const gainScale = def.gain * MASTER_SFX_GAIN * (opts.gainScale ?? 1)
        playGain.gain.cancelScheduledValues(now)
        // A floor above absolute zero so we can use exponentialRampToValueAtTime,
        // which sounds more natural on decays than a linear ramp but cannot
        // target exactly 0.
        const floor = 0.0001
        const attack = Math.min(ATTACK_TIME, def.duration * 0.25)
        playGain.gain.setValueAtTime(floor, now)
        for (let i = 0; i < def.envelope.length; i++) {
            const point = def.envelope[i]
            const value = Math.max(floor, envelopeAt(def.envelope, point.t) * gainScale)
            // Offset the first point by a short attack so the onset is not a
            // hard step from silence (the source of clicky harshness).
            const t = i === 0 ? now + attack : now + point.t * def.duration
            playGain.gain.exponentialRampToValueAtTime(value, t)
        }
        // Smooth exponential release to the floor at the very end so the voice
        // never cuts off abruptly even if the last envelope point is non-zero.
        playGain.gain.exponentialRampToValueAtTime(floor, end)

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
        this.masterLowpass = undefined
        this.masterLimiter = undefined
    }
}
