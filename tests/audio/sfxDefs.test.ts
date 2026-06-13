import { describe, expect, it } from "vitest"
import {
    envelopeAt,
    midiToHz,
    pitchJitter,
    SFX_TABLE,
    SfxName,
} from "@pip-pip/client/src/game/audio/sfxDefs"

const ALL_NAMES: SfxName[] = [
    "shoot",
    "shootTactical",
    "hit",
    "explosion",
    "spawn",
    "reloadStart",
    "reloadEnd",
    "uiClick",
    "uiHover",
    "phaseChange",
    "pip",
]

describe("SFX_TABLE", () => {
    it("has an entry for every SfxName", () => {
        for (const name of ALL_NAMES) {
            expect(SFX_TABLE[name]).toBeDefined()
        }
        expect(Object.keys(SFX_TABLE).sort()).toEqual([...ALL_NAMES].sort())
    })

    it("every definition has duration > 0 and frequency > 0", () => {
        for (const name of ALL_NAMES) {
            const def = SFX_TABLE[name]
            expect(def.duration).toBeGreaterThan(0)
            expect(def.frequency).toBeGreaterThan(0)
        }
    })

    it("every envelope starts at t=0 and ends at t=1", () => {
        for (const name of ALL_NAMES) {
            const env = SFX_TABLE[name].envelope
            expect(env.length).toBeGreaterThan(0)
            expect(env[0].t).toBe(0)
            expect(env[env.length - 1].t).toBe(1)
        }
    })
})

describe("envelopeAt", () => {
    const env = [
        { t: 0, gain: 0 },
        { t: 0.5, gain: 1 },
        { t: 1, gain: 0 },
    ]

    it("returns the first point's gain at t=0", () => {
        expect(envelopeAt(env, 0)).toBe(0)
    })

    it("returns the peak gain in the middle", () => {
        expect(envelopeAt(env, 0.5)).toBeCloseTo(1, 10)
    })

    it("returns ~0 at the end", () => {
        expect(envelopeAt(env, 1)).toBeCloseTo(0, 10)
    })

    it("interpolates linearly between points", () => {
        expect(envelopeAt(env, 0.25)).toBeCloseTo(0.5, 10)
        expect(envelopeAt(env, 0.75)).toBeCloseTo(0.5, 10)
    })

    it("clamps t outside [0, 1]", () => {
        expect(envelopeAt(env, -1)).toBe(0)
        expect(envelopeAt(env, 2)).toBeCloseTo(0, 10)
    })
})

describe("pitchJitter", () => {
    it("stays within +/- semitones * 100 cents", () => {
        for (let seed = 0; seed < 1000; seed++) {
            const cents = pitchJitter(seed, 2)
            expect(cents).toBeGreaterThanOrEqual(-200)
            expect(cents).toBeLessThanOrEqual(200)
        }
    })

    it("is deterministic per seed", () => {
        expect(pitchJitter(42, 1)).toBe(pitchJitter(42, 1))
        expect(pitchJitter(7, 0.5)).toBe(pitchJitter(7, 0.5))
    })

    it("returns 0 when semitones is 0", () => {
        expect(pitchJitter(123, 0)).toBe(0)
        expect(pitchJitter(0, 0)).toBe(0)
    })
})

describe("midiToHz", () => {
    it("maps A4 (69) to 440 Hz", () => {
        expect(midiToHz(69)).toBeCloseTo(440, 6)
    })

    it("maps A5 (81) to 880 Hz", () => {
        expect(midiToHz(81)).toBeCloseTo(880, 6)
    })
})
