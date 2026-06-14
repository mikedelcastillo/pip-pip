import { MAX_VARSTRING, PacketSerializer } from "./serializer"

export type PacketSerializerMap = {
    [dataKey: string]: PacketSerializer,
}

// A variable-length serializer writes a little-endian length prefix ahead of its
// body. $varstring/$json use 2 bytes implicitly; $largejson sets prefixBytes=4 so
// it can carry a body past the 65535-byte ceiling a 2-byte prefix can express.
// These helpers read the prefix width + the per-field cap straight off the
// serializer so the framing here matches exactly what the serializer encodes,
// instead of hardcoding 2 bytes / MAX_VARSTRING for every variable field.
function prefixBytesOf(serializer: PacketSerializer): number{
    return typeof serializer.prefixBytes === "number" ? serializer.prefixBytes : 2
}
function maxLengthOf(serializer: PacketSerializer): number{
    return typeof serializer.maxLength === "number" ? serializer.maxLength : MAX_VARSTRING
}
// Read a little-endian unsigned length of `bytes` width starting at `at`. >>> 0
// keeps a 4-byte value unsigned even when the high byte sets the sign bit.
function readLengthPrefix(value: number[], at: number, bytes: number): number{
    let length = 0
    for(let i = 0; i < bytes; i++){
        length |= (value[at + i] ?? 0) << (i * 8)
    }
    return length >>> 0
}

export type GetPacketInput<T extends PacketSerializerMap> = {
    [K in keyof T]: T[K] extends PacketSerializer<infer R> ? R : never
}

export class Packet<T extends PacketSerializerMap>{
    id = 0
    serializers: T
    keyOrder: string[] = [] // Array<keyof T>
    
    get dataLength(){
        let sum = 0

        for(const key of this.keyOrder){
            const serializer = this.serializers[key]
            if(typeof serializer.length === "number"){
                sum += serializer.length
            }
        }

        return sum
    }

    get isFixedLength(){
        return this.keyOrder.every(key => typeof this.serializers[key].length === "number")
    }

    constructor(serializers: T){
        this.serializers = serializers
        this.keyOrder = Object.keys(serializers).sort()
    }

    setId(id: number){
        if(id < 0 || id > 255) throw new Error("ID must be an unsigned int8.")
        this.id = id
    }

    encode<I extends GetPacketInput<T>>(inputs: I | I[]){
        const output = []

        if(!Array.isArray(inputs)) inputs = [inputs]

        for(const inp of inputs){
            output.push(this.id)
            for(const key of this.keyOrder){
                const value = inp[key]
                const arr = this.serializers[key].encode(value)
                output.push(...arr)
            }
        }

        return output
    }

    decode(value: number[]){
        if(!this.decodable(value)) throw new Error("Cannot decode this message. Wrong ID.")

        const output: GetPacketInput<T> = {} as GetPacketInput<T>
        let index = 1

        for(const key of this.keyOrder){
            const serializer = this.serializers[key]
            if(typeof serializer.length === "number"){
                const slice = value.slice(index, index + serializer.length)
                output[key as keyof typeof output] = serializer.decode(slice)
                index += serializer.length
            } else{
                const prefix = prefixBytesOf(serializer)
                const cap = maxLengthOf(serializer)
                const length = readLengthPrefix(value, index, prefix)
                // A field length over the hard cap is hostile framing - reject
                // before slicing/decoding (the serializer would throw anyway, but
                // failing here keeps the cap enforced in one obvious place). The
                // cap is per-serializer ($varstring: MAX_VARSTRING, $largejson:
                // MAX_LARGE_JSON) so each variable field is bounded by its own.
                if(length > cap) throw new Error("varstring length exceeds bounds")
                const totalLength = length + prefix
                const slice = value.slice(index, index + totalLength)
                output[key as keyof typeof output] = serializer.decode(slice)
                index += totalLength
            }
        }

        return output
    }
    
    // `offset` lets the manager peek at a packet starting mid-buffer without
    // re-slicing the whole remaining tail each iteration (which would make the
    // decode loop O(n^2) again). Defaults to 0 so existing callers are unchanged.
    decodable(value: number[], offset = 0){
        if(offset >= value.length) return false
        if(value[offset] === this.id) return true
        return false
    }

    // Get length of message including first ID byte. `offset` is the index of
    // this packet's ID byte within `value`; the returned length is still the
    // packet's own byte span (not an absolute end index).
    peekLength(value: number[], offset = 0){
        if(!this.decodable(value, offset)) return 0
        if(this.isFixedLength) return this.dataLength + 1
        if(Object.values(this.serializers).length === 0) return 1
        let sum = 1

        for(const key of this.keyOrder){
            const serializer = this.serializers[key]
            if(typeof serializer.length === "number"){
                sum += serializer.length
            } else{
                const prefix = prefixBytesOf(serializer)
                const cap = maxLengthOf(serializer)
                const at = offset + sum
                const length = readLengthPrefix(value, at, prefix)
                // Clamp the on-wire length to the bytes actually remaining and
                // reject anything over the hard cap. This stops a hostile length
                // prefix from making peekLength report an absurd span (which the
                // manager would otherwise try to read out of the buffer). The cap
                // and prefix width are per-serializer ($varstring: 2 byte /
                // MAX_VARSTRING, $largejson: 4 byte / MAX_LARGE_JSON).
                if(length > cap) throw new Error("varstring length exceeds bounds")
                const remaining = Math.max(0, value.length - (at + prefix))
                sum += Math.min(length, remaining) + prefix
            }
        }

        return sum
    }
}