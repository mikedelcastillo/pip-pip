import { describe, expect, it } from "vitest"
import {
    $bool,
    $quant16,
    $string,
    $uint16,
    $uint8,
    $varstring,
} from "@pip-pip/core/src/networking/packets/serializer"
import { Packet } from "@pip-pip/core/src/networking/packets/packet"
import { PacketManager } from "@pip-pip/core/src/networking/packets/manager"

describe("primitive serializers round-trip", () => {
    it("$uint8", () => {
        expect($uint8.decode($uint8.encode(0))).toBe(0)
        expect($uint8.decode($uint8.encode(200))).toBe(200)
        expect($uint8.decode($uint8.encode(255))).toBe(255)
    })

    it("$uint16", () => {
        expect($uint16.decode($uint16.encode(1000))).toBe(1000)
        expect($uint16.decode($uint16.encode(65535))).toBe(65535)
    })

    it("$bool", () => {
        expect($bool.decode($bool.encode(true))).toBe(true)
        expect($bool.decode($bool.encode(false))).toBe(false)
    })

    it("$varstring of arbitrary length", () => {
        expect($varstring.decode($varstring.encode("hello world"))).toBe("hello world")
        expect($varstring.decode($varstring.encode(""))).toBe("")
        expect($varstring.decode($varstring.encode("ünïcödé ✦"))).toBe("ünïcödé ✦")
    })

    it("$varstring round-trips payloads of 256+ bytes (2-byte length prefix)", () => {
        const big = "x".repeat(300)
        expect($varstring.decode($varstring.encode(big))).toBe(big)
        const huge = "y".repeat(1000)
        expect($varstring.decode($varstring.encode(huge))).toBe(huge)
    })

    it("$string of fixed length round-trips an exact-width value", () => {
        expect($string(4).decode($string(4).encode("abcd"))).toBe("abcd")
    })

    it("$string encodes to EXACTLY `length` bytes regardless of input", () => {
        // The framing relies on this invariant — a fixed-length field must
        // occupy exactly its declared byte width or it desyncs the packet.
        expect($string(4).encode("ab").length).toBe(4)        // short → padded
        expect($string(4).encode("abcdef").length).toBe(4)    // long → truncated
        expect($string(4).encode("").length).toBe(4)          // empty → padded
        expect($string(2).encode("🙂").length).toBe(2)        // multi-byte (4 UTF-8 bytes) → truncated, never overflows
        expect($string(8).encode("café").length).toBe(8)      // é is 2 bytes → still exactly 8
    })

    it("$string space-pads a short value (wire-compatible with the old encoder)", () => {
        expect(Array.from($string(4).encode("ab"))).toEqual([0x61, 0x62, 0x20, 0x20])
    })

    it("$string round-trips a multi-byte value that fits within the byte width", () => {
        // "café" is 5 UTF-8 bytes; a width of 5 holds it exactly.
        expect($string(5).decode($string(5).encode("café"))).toBe("café")
    })
})

describe("$quant16 fixed-point", () => {
    const range = 1000
    const q = $quant16(range)
    const precision = (2 * range) / 0xFFFF

    it("preserves values within the range to lattice precision", () => {
        for(const value of [0, 250.5, -737.25, range, -range]){
            const decoded = q.decode(q.encode(value))
            expect(Math.abs(decoded - value)).toBeLessThanOrEqual(precision)
        }
    })

    it("clamps values outside the range", () => {
        expect(q.decode(q.encode(5000))).toBeCloseTo(range, 1)
        expect(q.decode(q.encode(-5000))).toBeCloseTo(-range, 1)
    })
})

describe("PacketManager encode/decode", () => {
    const manager = new PacketManager({
        sample: new Packet({
            count: $uint8,
            label: $varstring,
            flag: $bool,
        }),
        tag: new Packet({
            id: $uint16,
        }),
    })

    it("round-trips a single packet", () => {
        const bytes = manager.encode("sample", { count: 7, label: "pip", flag: true })
        const decoded = manager.decode(bytes)
        expect(decoded.sample?.[0]).toEqual({ count: 7, label: "pip", flag: true })
    })

    it("round-trips a batch of the same packet", () => {
        const bytes = manager.encode("tag", [{ id: 1 }, { id: 2 }, { id: 65000 }])
        const decoded = manager.decode(bytes)
        expect(decoded.tag).toEqual([{ id: 1 }, { id: 2 }, { id: 65000 }])
    })

    it("decodes a stream of concatenated, differently-typed packets", () => {
        const bytes = [
            ...manager.encode("sample", { count: 3, label: "a", flag: false }),
            ...manager.encode("tag", { id: 42 }),
            ...manager.encode("sample", { count: 9, label: "bb", flag: true }),
        ]
        const decoded = manager.decode(bytes)
        expect(decoded.sample).toEqual([
            { count: 3, label: "a", flag: false },
            { count: 9, label: "bb", flag: true },
        ])
        expect(decoded.tag).toEqual([{ id: 42 }])
    })

    it("keeps batch framing intact when a varstring field exceeds 255 bytes", () => {
        const label = "z".repeat(500)
        const bytes = [
            ...manager.encode("sample", { count: 1, label, flag: true }),
            ...manager.encode("tag", { id: 4242 }),
        ]
        const decoded = manager.decode(bytes)
        expect(decoded.sample?.[0]).toEqual({ count: 1, label, flag: true })
        expect(decoded.tag).toEqual([{ id: 4242 }])
    })
})
