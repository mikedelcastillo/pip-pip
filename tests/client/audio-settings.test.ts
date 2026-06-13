import { describe, expect, it } from "vitest"
import {
    DEFAULT_AUDIO_SETTINGS,
    parseAudioSettings,
    serializeAudioSettings,
} from "../../packages/client/src/store/audioSettings"

describe("parseAudioSettings", () => {
    it("returns defaults for null", () => {
        expect(parseAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS)
    })

    it("returns defaults for malformed JSON", () => {
        expect(parseAudioSettings("{not json")).toEqual(DEFAULT_AUDIO_SETTINGS)
    })

    it("returns defaults for non-object JSON", () => {
        expect(parseAudioSettings("42")).toEqual(DEFAULT_AUDIO_SETTINGS)
        expect(parseAudioSettings("null")).toEqual(DEFAULT_AUDIO_SETTINGS)
    })

    it("clamps a volume above 1 down to 1", () => {
        expect(parseAudioSettings(JSON.stringify({ volume: 5, muted: false })).volume).toBe(1)
    })

    it("clamps a volume below 0 up to 0", () => {
        expect(parseAudioSettings(JSON.stringify({ volume: -3, muted: false })).volume).toBe(0)
    })

    it("defaults the volume when non-finite", () => {
        expect(parseAudioSettings(JSON.stringify({ volume: "loud", muted: false })).volume)
            .toBe(DEFAULT_AUDIO_SETTINGS.volume)
    })

    it("defaults the volume when missing", () => {
        expect(parseAudioSettings(JSON.stringify({ muted: true })).volume)
            .toBe(DEFAULT_AUDIO_SETTINGS.volume)
    })

    it("defaults muted when not a boolean", () => {
        expect(parseAudioSettings(JSON.stringify({ volume: 0.5, muted: "yes" })).muted)
            .toBe(DEFAULT_AUDIO_SETTINGS.muted)
    })

    it("defaults muted when missing", () => {
        expect(parseAudioSettings(JSON.stringify({ volume: 0.5 })).muted)
            .toBe(DEFAULT_AUDIO_SETTINGS.muted)
    })

    it("passes through a valid settings object", () => {
        expect(parseAudioSettings(JSON.stringify({ volume: 0.3, muted: true })))
            .toEqual({ volume: 0.3, muted: true })
    })
})

describe("serializeAudioSettings -> parseAudioSettings", () => {
    it("round-trips a valid settings object", () => {
        const settings = { volume: 0.42, muted: true }
        expect(parseAudioSettings(serializeAudioSettings(settings))).toEqual(settings)
    })

    it("round-trips the defaults", () => {
        expect(parseAudioSettings(serializeAudioSettings(DEFAULT_AUDIO_SETTINGS)))
            .toEqual(DEFAULT_AUDIO_SETTINGS)
    })
})
