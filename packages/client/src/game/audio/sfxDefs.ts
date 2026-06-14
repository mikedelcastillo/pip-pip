// Pure, side-effect-free sound definitions and helpers. NO Web Audio here -
// this module is safe to import in tests and on any platform. The AudioManager
// consumes SFX_TABLE to synthesise procedural audio at runtime.
//
// Loudness note: the AudioManager scales every `gain` below by a global
// MASTER_SFX_GAIN softening factor and routes the master bus through a low-pass
// + limiter, so these numbers are relative balance, not absolute output. The
// harshest repeated cue (shoot) uses a triangle rather than a square wave to
// stay easy on the ears even when fired in long bursts.

export type Waveform = "square" | "sawtooth" | "triangle" | "sine"

export type EnvelopePoint = {
    t: number // normalised time in [0, 1]
    gain: number
}

export type SfxDefinition = {
    waveform: Waveform
    frequency: number
    frequencyEnd: number
    duration: number
    envelope: EnvelopePoint[]
    gain: number
    noiseAmount: number
    detune?: number
}

export type SfxName =
    | "shoot"
    | "shootTactical"
    | "hit"
    | "explosion"
    | "spawn"
    | "reloadStart"
    | "reloadEnd"
    | "uiClick"
    | "uiHover"
    | "phaseChange"
    | "pip"

// Piecewise-linear interpolation of an envelope at normalised time t (clamped to
// [0, 1]). Assumes envelope points are ordered by ascending t and start at t=0.
export function envelopeAt(envelope: EnvelopePoint[], t: number): number {
    if (envelope.length === 0) return 0
    const clamped = Math.min(1, Math.max(0, t))

    if (clamped <= envelope[0].t) return envelope[0].gain
    const last = envelope[envelope.length - 1]
    if (clamped >= last.t) return last.gain

    for (let i = 0; i < envelope.length - 1; i++) {
        const a = envelope[i]
        const b = envelope[i + 1]
        if (clamped >= a.t && clamped <= b.t) {
            const span = b.t - a.t
            if (span <= 0) return b.gain
            const ratio = (clamped - a.t) / span
            return a.gain + (b.gain - a.gain) * ratio
        }
    }

    return last.gain
}

// Deterministic pseudo-random pitch offset in cents derived from a seed. Returns
// a value in [-semitones*100, +semitones*100]. Never uses Math.random so the
// same seed always yields the same offset (handy for client/server agreement and
// reproducible tests). Returns 0 when semitones is 0.
export function pitchJitter(seed: number, semitones: number): number {
    if (semitones === 0) return 0

    // Simple deterministic integer hash (xorshift-style mixing).
    let h = Math.floor(seed) | 0
    h = (h ^ 0x9e3779b9) | 0
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) | 0
    h = Math.imul(h ^ (h >>> 13), 0x45d9f3b) | 0
    h = (h ^ (h >>> 16)) | 0

    // Map hash to [0, 1) then to [-1, 1].
    const unit = (h >>> 0) / 0xffffffff
    const signed = unit * 2 - 1

    return signed * semitones * 100
}

// Standard MIDI note number to frequency in Hz (A4 = note 69 = 440 Hz).
export function midiToHz(note: number): number {
    return 440 * Math.pow(2, (note - 69) / 12)
}

export const SFX_TABLE: Record<SfxName, SfxDefinition> = {
    shoot: {
        // Triangle, not square: shoot fires constantly, so the softer triangle
        // harmonics keep rapid fire from becoming fatiguing.
        waveform: "triangle",
        frequency: 880,
        frequencyEnd: 220,
        duration: 0.08,
        envelope: [{ t: 0, gain: 1 }, { t: 0.1, gain: 0.8 }, { t: 1, gain: 0 }],
        gain: 0.35,
        noiseAmount: 0.05,
    },
    shootTactical: {
        waveform: "sawtooth",
        frequency: 220,
        frequencyEnd: 80,
        duration: 0.25,
        envelope: [{ t: 0, gain: 1 }, { t: 0.05, gain: 0.9 }, { t: 0.6, gain: 0.4 }, { t: 1, gain: 0 }],
        gain: 0.55,
        noiseAmount: 0.15,
    },
    hit: {
        waveform: "square",
        frequency: 440,
        frequencyEnd: 110,
        duration: 0.12,
        envelope: [{ t: 0, gain: 1 }, { t: 0.05, gain: 0.7 }, { t: 1, gain: 0 }],
        gain: 0.4,
        noiseAmount: 0.3,
    },
    explosion: {
        waveform: "sawtooth",
        frequency: 180,
        frequencyEnd: 40,
        duration: 0.6,
        envelope: [{ t: 0, gain: 1 }, { t: 0.05, gain: 0.8 }, { t: 0.4, gain: 0.5 }, { t: 1, gain: 0 }],
        gain: 0.8,
        noiseAmount: 0.7,
    },
    spawn: {
        waveform: "triangle",
        frequency: 330,
        frequencyEnd: 660,
        duration: 0.3,
        envelope: [{ t: 0, gain: 0 }, { t: 0.1, gain: 1 }, { t: 0.8, gain: 0.8 }, { t: 1, gain: 0 }],
        gain: 0.5,
        noiseAmount: 0,
    },
    reloadStart: {
        // Triangle keeps these high beeps from being shrill.
        waveform: "triangle",
        frequency: 660,
        frequencyEnd: 550,
        duration: 0.06,
        envelope: [{ t: 0, gain: 0.8 }, { t: 0.5, gain: 0.6 }, { t: 1, gain: 0 }],
        gain: 0.25,
        noiseAmount: 0,
    },
    reloadEnd: {
        // Triangle keeps these high beeps from being shrill.
        waveform: "triangle",
        frequency: 880,
        frequencyEnd: 990,
        duration: 0.1,
        envelope: [{ t: 0, gain: 0.9 }, { t: 0.6, gain: 0.7 }, { t: 1, gain: 0 }],
        gain: 0.3,
        noiseAmount: 0,
    },
    uiClick: {
        // Fires on EVERY button press app-wide, so it has to stay near-subliminal:
        // a sine (the gentlest waveform, no upper harmonics), a brief 50 ms
        // duration, and a low peak gain. A small downward sweep softens it
        // further so the cue reads as a quiet "tick" rather than a beep.
        waveform: "sine",
        frequency: 660,
        frequencyEnd: 520,
        duration: 0.05,
        envelope: [{ t: 0, gain: 1 }, { t: 0.4, gain: 0.4 }, { t: 1, gain: 0 }],
        gain: 0.12,
        noiseAmount: 0,
    },
    uiHover: {
        waveform: "triangle",
        frequency: 880,
        frequencyEnd: 880,
        duration: 0.04,
        envelope: [{ t: 0, gain: 0.6 }, { t: 1, gain: 0 }],
        gain: 0.1,
        noiseAmount: 0,
    },
    phaseChange: {
        waveform: "triangle",
        frequency: 440,
        frequencyEnd: 880,
        duration: 0.5,
        envelope: [{ t: 0, gain: 0 }, { t: 0.05, gain: 1 }, { t: 0.7, gain: 0.6 }, { t: 1, gain: 0 }],
        gain: 0.6,
        noiseAmount: 0,
    },
    pip: {
        waveform: "sine",
        frequency: 1568,
        frequencyEnd: 1568,
        duration: 0.18,
        envelope: [
            { t: 0, gain: 0 },
            { t: 0.05, gain: 1 },
            { t: 0.2, gain: 0 },
            { t: 0.5, gain: 0 },
            { t: 0.55, gain: 1 },
            { t: 0.7, gain: 0 },
            { t: 1, gain: 0 },
        ],
        gain: 0.4,
        noiseAmount: 0,
    },
}
