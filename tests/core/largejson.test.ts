import { describe, expect, it } from "vitest"
import {
    $largejson,
    MAX_LARGE_JSON,
} from "@pip-pip/core/src/networking/packets/serializer"

// Build the little-endian 4-byte length prefix $largejson writes, then append a
// `body`. Lets a test forge a hostile length prefix independent of body length.
function largeBytes(declaredLength: number, body: number[]): number[]{
    return [
        declaredLength & 0xFF,
        (declaredLength >> 8) & 0xFF,
        (declaredLength >> 16) & 0xFF,
        (declaredLength >> 24) & 0xFF,
        ...body,
    ]
}

describe("$largejson serializer", () => {
    const json = $largejson<Record<string, unknown>>()

    it("declares a 4-byte prefix and the MAX_LARGE_JSON cap", () => {
        // The Packet framing reads these off the serializer, so they must be set.
        expect(json.prefixBytes).toBe(4)
        expect(json.maxLength).toBe(MAX_LARGE_JSON)
    })

    it("round-trips a payload larger than the 4096-byte varstring cap", () => {
        // A JSON object whose serialized form comfortably exceeds 4096 bytes - the
        // exact case $varstring/$json cannot carry and $largejson exists for.
        const big = { blob: "x".repeat(10000), n: 42, list: [1, 2, 3] }
        const encoded = json.encode(big)
        expect(encoded.length).toBeGreaterThan(4096)
        expect(json.decode(encoded)).toEqual(big)
    })

    it("round-trips a payload whose body is EXACTLY at the cap boundary", () => {
        // A JSON string body sized so its UTF-8 byte length is exactly
        // MAX_LARGE_JSON. {"s":"<cap-10 chars>"} -> the wrapping adds 8 bytes for
        // the quotes/braces/key, so the inner string is MAX_LARGE_JSON-8 chars.
        const inner = "y".repeat(MAX_LARGE_JSON - 8)
        const value = { s: inner }
        const encoded = json.encode(value)
        // Body is exactly the cap; total adds the 4-byte prefix.
        expect(encoded.length).toBe(MAX_LARGE_JSON + 4)
        expect(json.decode(encoded)).toEqual(value)
    })

    it("throws when the declared length exceeds the cap (before allocating)", () => {
        // Declare a length over MAX_LARGE_JSON but hand only a few bytes - must
        // reject before trying to slice the claimed span.
        const hostile = largeBytes(MAX_LARGE_JSON + 1, [1, 2, 3])
        expect(() => json.decode(hostile)).toThrow()
    })

    it("throws when the declared length overruns the buffer it was given", () => {
        // Length claims 100000 bytes (under the cap) but only 4 follow.
        const hostile = largeBytes(100000, [123, 125, 32, 32])
        expect(() => json.decode(hostile)).toThrow()
    })

    it("does not throw for a length exactly matching the remaining bytes", () => {
        const value = { hi: 1 }
        expect(json.decode(json.encode(value))).toEqual(value)
    })
})
