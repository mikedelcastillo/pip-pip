import { PacketSerializer } from "./serializer"

export type PacketSerializerMap = {
    [dataKey: string]: PacketSerializer,
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
                const lenCode = value.slice(index, index + 2)
                const length = new Uint8Array(new Uint16Array(lenCode).buffer)[0]
                const totalLength = length + 2
                const slice = value.slice(index, index + totalLength)
                output[key as keyof typeof output] = serializer.decode(slice)
                index += totalLength
            }
        }

        return output
    }
    
    decodable(value: number[]){
        if(value.length === 0) return false
        if(value[0] === this.id) return true
        return false
    }

    // Get length of message including first ID byte
    peekLength(value: number[]){
        if(!this.decodable(value)) return 0
        if(this.isFixedLength) return this.dataLength + 1
        if(Object.values(this.serializers).length === 0) return 1
        let sum = 1

        for(const key of this.keyOrder){
            const serializer = this.serializers[key]
            if(typeof serializer.length === "number"){
                sum += serializer.length
            } else{
                const lenCode = value.slice(sum, sum + 2)
                const length = new Uint8Array(new Uint16Array(lenCode).buffer)[0]
                sum += length + 2
            }
        }

        return sum
    }
}