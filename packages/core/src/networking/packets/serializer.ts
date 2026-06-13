import { Float16Array, Float16ArrayConstructor } from "@petamoriken/float16"

export type PacketSerializer<T = any> = {
    readonly length?: number,
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
        const encoded = internalTextEncoder.encode(value)
        return new Uint8Array([
            ...new Uint8Array(new Uint16Array([encoded.length]).buffer),
            ...encoded,
        ])
    },
    decode(value){
        const arr = Array.from(value)
        // Little-endian 2-byte length. Building Uint16Array from a number[] would
        // treat each byte as its own element and read only the low byte, so any
        // payload >= 256 bytes was truncated and desynced the batch.
        const length = (arr[0] | (arr[1] << 8)) >>> 0
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

export const $string = (length: number): PacketSerializer<string> => ({
    length,
    encode(value){
        const safeValue = String(value + " ".repeat(length)).substring(0, length)
        return internalTextEncoder.encode(safeValue)
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