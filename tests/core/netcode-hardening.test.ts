import { describe, expect, it } from "vitest"
import {
    $bool,
    $uint8,
    $uint16,
    $varstring,
    MAX_VARSTRING,
} from "@pip-pip/core/src/networking/packets/serializer"
import { Packet } from "@pip-pip/core/src/networking/packets/packet"
import { PacketManager } from "@pip-pip/core/src/networking/packets/manager"
import { generateId } from "@pip-pip/core/src/lib/utils"

// Build the little-endian length prefix used by $varstring on the wire, then
// append `body` bytes. Lets a test forge a hostile length prefix independent of
// the actual body length.
function varstringBytes(declaredLength: number, body: number[]){
    return [declaredLength & 0xFF, (declaredLength >> 8) & 0xFF, ...body]
}

describe("$varstring decode bounds (C1/C2)", () => {
    it("still round-trips legit payloads, including >= 256 bytes", () => {
        expect($varstring.decode($varstring.encode("hello"))).toBe("hello")
        const big = "x".repeat(300)
        expect($varstring.decode($varstring.encode(big))).toBe(big)
        const atCap = "y".repeat(MAX_VARSTRING)
        expect($varstring.decode($varstring.encode(atCap))).toBe(atCap)
    })

    it("throws when the declared length exceeds MAX_VARSTRING", () => {
        // Declare a length over the cap but hand it only a few bytes — must throw
        // BEFORE trying to allocate/slice the claimed span.
        const hostile = varstringBytes(MAX_VARSTRING + 1, [1, 2, 3])
        expect(() => $varstring.decode(hostile)).toThrow()
    })

    it("throws when the declared length overruns the buffer it was given", () => {
        // Length claims 1000 bytes but only 4 follow.
        const hostile = varstringBytes(1000, [65, 66, 67, 68])
        expect(() => $varstring.decode(hostile)).toThrow()
    })

    it("does not throw for a length exactly matching the remaining bytes", () => {
        const body = [104, 105] // "hi"
        const exact = varstringBytes(body.length, body)
        expect($varstring.decode(exact)).toBe("hi")
    })
})

describe("Packet decode/peekLength reject hostile varstring framing", () => {
    const packet = new Packet({ message: $varstring })
    packet.setId(7)

    it("decode throws on an over-cap length prefix", () => {
        const bytes = [7, ...varstringBytes(MAX_VARSTRING + 100, [1, 2, 3])]
        expect(() => packet.decode(bytes)).toThrow()
    })

    it("peekLength throws on an over-cap length prefix", () => {
        const bytes = [7, ...varstringBytes(MAX_VARSTRING + 100, [1, 2, 3])]
        expect(() => packet.peekLength(bytes)).toThrow()
    })

    it("peekLength clamps a length that overruns the remaining buffer", () => {
        // Declare 5000 (over cap would throw) — use a value under the cap that
        // still overruns the 3-byte body, and check peekLength does not report a
        // span past the end of the buffer.
        const bytes = [7, ...varstringBytes(2000, [1, 2, 3])]
        const len = packet.peekLength(bytes)
        expect(len).toBeLessThanOrEqual(bytes.length)
    })

    it("peekLength honours an offset (mid-buffer packet)", () => {
        const tail = [7, ...varstringBytes(2, [104, 105])]
        const bytes = [99, 99, ...tail] // two junk bytes, then the real packet
        // From offset 2 the packet's own span is 1 (id) + 2 (len) + 2 (body) = 5.
        expect(packet.peekLength(bytes, 2)).toBe(5)
        expect(packet.decodable(bytes, 2)).toBe(true)
        expect(packet.decodable(bytes, 0)).toBe(false)
    })
})

describe("PacketManager.decode handles many packets without O(n^2) blowup", () => {
    const manager = new PacketManager({
        tag: new Packet({ id: $uint16 }),
        sample: new Packet({ count: $uint8, label: $varstring, flag: $bool }),
    })

    it("decodes a large batch of tiny packets correctly and quickly", () => {
        const N = 20000
        const bytes: number[] = []
        for(let i = 0; i < N; i++){
            bytes.push(...manager.encode("tag", { id: i & 0xFFFF }))
        }

        const start = Date.now()
        const decoded = manager.decode(bytes)
        const elapsed = Date.now() - start

        expect(decoded.tag?.length).toBe(N)
        expect(decoded.tag?.[0]).toEqual({ id: 0 })
        expect(decoded.tag?.[N - 1]).toEqual({ id: (N - 1) & 0xFFFF })
        // The cursor walk is O(total bytes); the old splice was O(N^2). 20k tiny
        // packets must decode well under a second — a generous bound that still
        // fails loudly if the quadratic behaviour ever returns.
        expect(elapsed).toBeLessThan(1000)
    })

    it("keeps mixed-type, variable-length framing intact across a stream", () => {
        const bytes = [
            ...manager.encode("sample", { count: 1, label: "z".repeat(500), flag: true }),
            ...manager.encode("tag", { id: 4242 }),
            ...manager.encode("sample", { count: 2, label: "", flag: false }),
        ]
        const decoded = manager.decode(bytes)
        expect(decoded.sample).toEqual([
            { count: 1, label: "z".repeat(500), flag: true },
            { count: 2, label: "", flag: false },
        ])
        expect(decoded.tag).toEqual([{ id: 4242 }])
    })

    it("stops cleanly (does not hang) on a hostile oversized length prefix", () => {
        // A sample packet whose varstring claims far more than is present. decode
        // must reject (throw) rather than loop forever or splice past the end.
        const bytes = [
            manager.serializers.sample.id,
            5, // count
            ...varstringBytes(60000, [1, 2, 3]), // hostile label length
        ]
        expect(() => manager.decode(bytes)).toThrow()
    })
})

describe("generateId (M1: crypto-backed, same shape)", () => {
    const POOL = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMOPQRSTUVWXYZ"

    it("returns the requested length", () => {
        expect(generateId(4).length).toBe(4)
        expect(generateId(1).length).toBe(1)
        expect(generateId(64).length).toBe(64)
        expect(generateId().length).toBe(4) // default
    })

    it("only uses characters from the original charset", () => {
        const id = generateId(200)
        for(const ch of id){
            expect(POOL.includes(ch)).toBe(true)
        }
    })

    it("avoids collisions against a reference set", () => {
        const reference: string[] = []
        for(let i = 0; i < 50; i++){
            const id = generateId(4, reference)
            expect(reference.includes(id)).toBe(false)
            reference.push(id)
        }
    })

    it("produces varied output (not a constant)", () => {
        const ids = new Set<string>()
        for(let i = 0; i < 100; i++) ids.add(generateId(8))
        // Vanishingly unlikely to collide if the RNG is working at all.
        expect(ids.size).toBeGreaterThan(90)
    })
})
