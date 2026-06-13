import { describe, expect, it } from "vitest"
import {
    DEFAULT_GRAPHICS_SETTINGS,
    parseGraphicsSettings,
    serializeGraphicsSettings,
} from "../../packages/client/src/store/graphicsSettings"

describe("parseGraphicsSettings", () => {
    it("returns defaults for null", () => {
        expect(parseGraphicsSettings(null)).toEqual(DEFAULT_GRAPHICS_SETTINGS)
    })

    it("defaults crt to OFF", () => {
        expect(DEFAULT_GRAPHICS_SETTINGS.crt).toBe(false)
    })

    it("returns defaults for malformed JSON", () => {
        expect(parseGraphicsSettings("{not json")).toEqual(DEFAULT_GRAPHICS_SETTINGS)
    })

    it("returns defaults for non-object JSON", () => {
        expect(parseGraphicsSettings("42")).toEqual(DEFAULT_GRAPHICS_SETTINGS)
        expect(parseGraphicsSettings("null")).toEqual(DEFAULT_GRAPHICS_SETTINGS)
    })

    it("defaults crt when not a boolean", () => {
        expect(parseGraphicsSettings(JSON.stringify({ crt: "yes" })).crt)
            .toBe(DEFAULT_GRAPHICS_SETTINGS.crt)
    })

    it("defaults crt when missing", () => {
        expect(parseGraphicsSettings(JSON.stringify({})).crt)
            .toBe(DEFAULT_GRAPHICS_SETTINGS.crt)
    })

    it("passes through crt true", () => {
        expect(parseGraphicsSettings(JSON.stringify({ crt: true }))).toEqual({ crt: true })
    })
})

describe("serializeGraphicsSettings -> parseGraphicsSettings", () => {
    it("round-trips crt on", () => {
        expect(parseGraphicsSettings(serializeGraphicsSettings({ crt: true })))
            .toEqual({ crt: true })
    })

    it("round-trips the defaults", () => {
        expect(parseGraphicsSettings(serializeGraphicsSettings(DEFAULT_GRAPHICS_SETTINGS)))
            .toEqual(DEFAULT_GRAPHICS_SETTINGS)
    })
})
