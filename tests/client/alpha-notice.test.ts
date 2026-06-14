import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
    ALPHA_NOTICE_KEY,
    DEFAULT_ALPHA_SEEN,
    parseAlphaSeen,
    readAlphaSeen,
    serializeAlphaSeen,
    writeAlphaSeen,
} from "../../packages/client/src/store/alphaNotice"

describe("parseAlphaSeen", () => {
    it("defaults to not-seen for null", () => {
        expect(parseAlphaSeen(null)).toBe(DEFAULT_ALPHA_SEEN)
        expect(DEFAULT_ALPHA_SEEN).toBe(false)
    })

    it("reads the literal \"true\" as seen", () => {
        expect(parseAlphaSeen("true")).toBe(true)
    })

    it("reads anything else as not-seen", () => {
        expect(parseAlphaSeen("false")).toBe(false)
        expect(parseAlphaSeen("1")).toBe(false)
        expect(parseAlphaSeen("yes")).toBe(false)
        expect(parseAlphaSeen("")).toBe(false)
    })
})

describe("serializeAlphaSeen -> parseAlphaSeen", () => {
    it("round-trips true", () => {
        expect(parseAlphaSeen(serializeAlphaSeen(true))).toBe(true)
    })

    it("round-trips false", () => {
        expect(parseAlphaSeen(serializeAlphaSeen(false))).toBe(false)
    })
})

// The pure parse/serialize layer above never touches the DOM. These cases
// exercise the localStorage-backed read/write helpers with a tiny in-memory
// stub so they run under the plain node environment.
describe("readAlphaSeen / writeAlphaSeen", () => {
    let store: Record<string, string>

    beforeEach(() => {
        store = {}
        vi.stubGlobal("localStorage", {
            getItem: (key: string) => (key in store ? store[key] : null),
            setItem: (key: string, value: string) => { store[key] = value },
            removeItem: (key: string) => { delete store[key] },
            clear: () => { store = {} },
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it("defaults to not-seen when nothing is stored", () => {
        expect(readAlphaSeen()).toBe(false)
    })

    it("persists and reads back the seen flag under the expected key", () => {
        writeAlphaSeen(true)
        expect(store[ALPHA_NOTICE_KEY]).toBe("true")
        expect(readAlphaSeen()).toBe(true)
    })

    it("can clear the flag back to not-seen", () => {
        writeAlphaSeen(true)
        writeAlphaSeen(false)
        expect(readAlphaSeen()).toBe(false)
    })

    it("survives a throwing localStorage by returning the default", () => {
        vi.stubGlobal("localStorage", {
            getItem: () => { throw new Error("blocked") },
            setItem: () => { throw new Error("blocked") },
        })
        expect(readAlphaSeen()).toBe(DEFAULT_ALPHA_SEEN)
        expect(() => writeAlphaSeen(true)).not.toThrow()
    })
})
