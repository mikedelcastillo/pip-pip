import { Float16Array, Float16ArrayConstructor } from "@petamoriken/float16"

export type PacketSerializer<T = any> = {
    readonly length?: number,
    // Byte width of the little-endian length prefix a VARIABLE-length serializer
    // writes ahead of its body. $varstring/$json use the implicit default of 2;
    // $largejson sets 4 so it can carry a body past the 2-byte (65535) ceiling.
    // Fixed-length serializers (those with a `length`) ignore this. The Packet
    // framing reads this to know how many prefix bytes to skip, so it must match
    // exactly what the serializer's own encode/decode write/read.
    readonly prefixBytes?: number,
    // Hard upper bound on the on-wire BODY byte length for a variable-length
    // serializer (excludes the prefix). The Packet framing rejects any declared
    // length over this BEFORE slicing, so a hostile prefix can never drive a huge
    // read. $varstring/$json leave it unset and fall back to MAX_VARSTRING;
    // $largejson sets it to MAX_LARGE_JSON.
    readonly maxLength?: number,
    encode: (value: T) => Uint8Array,
    decode: (value: Uint8Array | number[]) => T,
}

type NumberArrayConstructor = 
    Uint8ArrayConstructor | 
    Uint16ArrayConstructor | 
    Uint32ArrayConstructor | 
    Float16ArrayConstructor | 
    Float32ArrayConstructor | 
    Float64ArrayConstructor

const numberTypes = {
    uint8: [1, Uint8Array],
    uint16: [2, Uint16Array],
    uint32: [4, Uint32Array],
    float16: [2, Float16Array],
    float32: [4, Float32Array],
    float64: [8, Float64Array],
}

function createNumberSerializer(type: keyof typeof numberTypes): PacketSerializer<number>{
    const [length, NumberArray] = numberTypes[type] as [number, NumberArrayConstructor]
    return {
        length,
        encode(value){
            return new Uint8Array(new NumberArray([value]).buffer)
        },
        decode(value){
            const output = new NumberArray(1)
            const int = new Uint8Array(output.buffer)
            for(let i = 0; i < value.length; i++){
                int[i] = value[i]
            }
            return output[0]
        },
    }
}

const internalTextEncoder = new TextEncoder()
const internalTextDecoder = new TextDecoder()

// Hard upper bound on the on-wire byte length of a single variable-length field
// ($varstring, and $json which is built on it). The 2-byte length prefix can
// claim up to 65535 bytes; without a cap a hostile peer can declare a huge
// length and force a large allocation per field (and many fields per message).
// Legit payloads (chat <= 80 chars, names, small JSON) are far under this, so
// 4096 bytes is comfortably permissive while keeping a single field bounded.
export const MAX_VARSTRING = 4096

export const $uint8 = createNumberSerializer("uint8")
export const $uint16 = createNumberSerializer("uint16")
export const $uint32 = createNumberSerializer("uint32")
export const $float16 = createNumberSerializer("float16")
export const $float32 = createNumberSerializer("float32")
export const $float64 = createNumberSerializer("float64")

export const $biguint64: PacketSerializer<number> = {
    length: 8,
    encode(value){
        return new Uint8Array(new BigUint64Array([BigInt(value)]).buffer)
    },
    decode(value){
        const output = new BigUint64Array(1)
        const int = new Uint8Array(output.buffer)
        for(let i = 0; i < value.length; i++){
            int[i] = value[i]
        }
        return Number(output[0])
    }
}

export const $bool: PacketSerializer<boolean> = {
    length: 1,
    encode(value){
        return $uint8.encode(value === true ? 1 : 0)
    },
    decode(value){
        return $uint8.decode(value) === 1
    }
}

export const $varstring: PacketSerializer<string> = {
    encode(value){
        // Write the 2-byte little-endian length prefix + the UTF-8 body straight
        // into ONE preallocated buffer. The old path allocated a Uint16Array, its
        // byte view, an intermediate spread array literal AND the outer Uint8Array
        // per call; this allocates only the final buffer (plus the TextEncoder
        // result). Byte-identical: the prefix is the SAME little-endian uint16 of
        // encoded.length the old `new Uint16Array([len]).buffer` view produced
        // (low byte first), and the body bytes are copied verbatim - exactly what
        // the spread emitted. decode still reads `arr[0] | (arr[1] << 8)`.
        const encoded = internalTextEncoder.encode(value)
        const len = encoded.length
        const out = new Uint8Array(2 + len)
        out[0] = len & 0xFF
        out[1] = (len >> 8) & 0xFF
        out.set(encoded, 2)
        return out
    },
    decode(value){
        const arr = Array.from(value)
        // Little-endian 2-byte length. Building Uint16Array from a number[] would
        // treat each byte as its own element and read only the low byte, so any
        // payload >= 256 bytes was truncated and desynced the batch.
        const length = (arr[0] | (arr[1] << 8)) >>> 0
        // Reject a declared length that overruns the buffer we were handed or
        // exceeds the hard cap BEFORE allocating/slicing - a hostile length must
        // never drive a large allocation. The cap covers MAX_VARSTRING; the
        // remaining-bytes clamp covers a length that claims past this field.
        const available = Math.max(0, arr.length - 2)
        if(length > MAX_VARSTRING || length > available){
            throw new Error("varstring length exceeds bounds")
        }
        const stringCode = arr.slice(2, 2 + length)
        return internalTextDecoder.decode(new Uint8Array(stringCode))
    },
}

export const $json = <T extends Record<string, any>>(): PacketSerializer<T> => ({
    encode(value){
        return $varstring.encode(JSON.stringify(value))
    },
    decode(value){
        return JSON.parse($varstring.decode(value))
    },
})

// Hard upper bound on the on-wire BODY byte length of a single $largejson field.
// Distinct from MAX_VARSTRING: $largejson exists precisely because a custom map
// JSON easily blows past the 4096-byte $varstring cap (and the 65535-byte ceiling
// a 2-byte prefix can even express). 256 KiB comfortably holds a large authored
// map's GridMapData while still bounding a single field so a hostile peer cannot
// declare a length that drives a huge allocation. Kept separate so the $varstring
// cap (and every existing packet) is untouched.
export const MAX_LARGE_JSON = 256 * 1024

// $largevarstring: like $varstring but with a 4-byte (uint32) little-endian length
// prefix and the MAX_LARGE_JSON cap, so it can carry bodies far past the 2-byte
// 65535-byte ceiling. The same hostile-length protection $varstring has applies:
// a declared length over the cap OR past the bytes actually handed in is rejected
// BEFORE allocating/slicing, so a malicious prefix can never drive a large read.
// prefixBytes=4 / maxLength tell the Packet framing how to skip the prefix and
// where to reject. Not exported on its own; $largejson is the public surface.
const $largevarstring: PacketSerializer<string> = {
    prefixBytes: 4,
    maxLength: MAX_LARGE_JSON,
    encode(value){
        const encoded = internalTextEncoder.encode(value)
        if(encoded.length > MAX_LARGE_JSON){
            throw new Error("largejson length exceeds cap")
        }
        const len = encoded.length >>> 0
        return new Uint8Array([
            len & 0xFF,
            (len >> 8) & 0xFF,
            (len >> 16) & 0xFF,
            (len >> 24) & 0xFF,
            ...encoded,
        ])
    },
    decode(value){
        const arr = Array.from(value)
        // Little-endian 4-byte length. >>> 0 keeps it an unsigned 32-bit int even
        // when the high byte sets the sign bit.
        const length = ((arr[0] | (arr[1] << 8) | (arr[2] << 16) | (arr[3] << 24)) >>> 0)
        // Reject a declared length that exceeds the hard cap or overruns the bytes
        // we were handed BEFORE allocating/slicing - a hostile length must never
        // drive a large allocation. Mirrors the $varstring guard, scaled to the
        // 4-byte prefix and MAX_LARGE_JSON.
        const available = Math.max(0, arr.length - 4)
        if(length > MAX_LARGE_JSON || length > available){
            throw new Error("largejson length exceeds bounds")
        }
        const stringCode = arr.slice(4, 4 + length)
        return internalTextDecoder.decode(new Uint8Array(stringCode))
    },
}

// $largejson: a JSON serializer for payloads too big for $json/$varstring (custom
// maps). Built on $largevarstring so it inherits the 4-byte prefix, the
// MAX_LARGE_JSON cap and the hostile-length rejection.
export const $largejson = <T extends Record<string, any>>(): PacketSerializer<T> => ({
    prefixBytes: 4,
    maxLength: MAX_LARGE_JSON,
    encode(value){
        return $largevarstring.encode(JSON.stringify(value))
    },
    decode(value){
        return JSON.parse($largevarstring.decode(value))
    },
})

export const $string = (length: number): PacketSerializer<string> => ({
    length,
    encode(value){
        // Pad/truncate to exactly `length` BYTES, not characters. The old code
        // substring'd to `length` chars THEN UTF-8 encoded, so a multi-byte
        // value (emoji/CJK) emitted more than `length` bytes and overflowed its
        // fixed slot - desyncing every following field in the packet (the same
        // class of bug as the C1 $varstring fix). Space-padding (0x20) and the
        // output bytes are identical to before for ASCII inputs (1 char = 1
        // byte), so this is wire-compatible for the connection/powerup ids that
        // actually use $string; only the multi-byte overflow path changes.
        const out = new Uint8Array(length).fill(0x20)
        out.set(internalTextEncoder.encode(String(value)).subarray(0, length))
        return out
    },
    decode(value){
        return internalTextDecoder.decode(new Uint8Array(value))
    }
})

/**
 * Fixed-point number serialized into 2 bytes (uint16) across a symmetric
 * range [-range, range]. Unlike $float16 the precision is uniform across the
 * whole range (≈ 2*range / 65535 units), so it does not lose precision at
 * large world coordinates the way a half-float does. Use a single shared
 * `range` for every field that must decode against the same lattice.
 */
export const $quant16 = (range: number): PacketSerializer<number> => ({
    length: 2,
    encode(value){
        const clamped = Math.max(-range, Math.min(range, value))
        const normalized = (clamped + range) / (2 * range)
        return $uint16.encode(Math.round(normalized * 0xFFFF))
    },
    decode(value){
        const normalized = $uint16.decode(value) / 0xFFFF
        return normalized * (2 * range) - range
    },
})