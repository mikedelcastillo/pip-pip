
import { GetPacketInput, Packet, PacketSerializerMap } from "./packet"
import { serverPackets, ServerSerializerMap } from "./server"
import { Connection } from "../connection"

export type PacketManagerSerializerMap = {
    [packetName: string]: Packet<PacketSerializerMap>,
}

export type GetPacketSerializerMap<T> = T extends Packet<infer R> ? R : never 

export type PacketManagerDecoded<T extends PacketManagerSerializerMap> = {
    [K in keyof T]?: GetPacketInput<GetPacketSerializerMap<T[K]>>[]
}

export class BasePacketManager<T extends PacketManagerSerializerMap>{
    serializers: T

    constructor(serializers: T){
        this.serializers = serializers

        const p = Object.values(this.serializers)
        if(p.length > 256) throw new Error("Packet manager can only handle 256 packet types.")
        for(let i = 0; i < p.length; i++){
            p[i].setId(i)
        }
    }

    encode<K extends keyof T, I extends GetPacketInput<GetPacketSerializerMap<T[K]>>>(serializer: K, input: I | I[]){
        return this.serializers[serializer].encode(input)
    }

    decode(value: number[] | Uint8Array | ArrayBuffer): PacketManagerDecoded<T>{
        const arr = Array.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value)
        const output: PacketManagerDecoded<T> = {}

        // Walk the buffer with a cursor instead of `arr.splice(0, length)` per
        // packet. splice shifts every remaining element down on each call, so a
        // message carrying N packets was O(N^2) — a flood of tiny packets in one
        // message could pin the event loop. decodable/peekLength take the cursor
        // as an offset (no per-packet re-slice of the tail), so the whole walk is
        // O(total bytes). The packet count is also bounded so a single message can
        // never spin the decode loop unboundedly even if framing is pathological.
        const maxPackets = arr.length + 1
        let cursor = 0
        let processed = 0

        while(cursor < arr.length && processed < maxPackets){
            processed++
            let serializerId: keyof T | undefined = undefined
            for(const id in this.serializers){
                if(this.serializers[id].decodable(arr, cursor)){
                    serializerId = id
                    break
                }
            }
            if(typeof serializerId === "undefined") break
            const serializer = this.serializers[serializerId]
            const length = serializer.peekLength(arr, cursor)
            // A non-positive length would not advance the cursor — bail rather
            // than loop forever on malformed framing.
            if(length <= 0) break
            // Slice only this packet's own bytes (proportional to the packet, so
            // the total across the message stays O(total bytes)).
            const slice = arr.slice(cursor, cursor + length)
            const decoded = serializer.decode(slice) as GetPacketInput<GetPacketSerializerMap<T[keyof T]>>
            if(typeof output[serializerId] === "undefined") output[serializerId] = []
            output[serializerId]?.push(decoded)
            cursor += length
        }

        return output
    }
}

export class PacketManager<T extends PacketManagerSerializerMap> 
    extends BasePacketManager<T & ServerSerializerMap>{
    constructor(packets: T){
        super({
            ...packets,
            ...serverPackets,
        })
    }
}

export type ExtractSerializerMap<T> = T extends PacketManager<infer R> ? R : never

export type ServerPacketManager = BasePacketManager<ServerSerializerMap>

export type ServerPacketManagerEventMap<
    T extends PacketManagerSerializerMap,
    R extends Record<string, any>,
    P extends Record<string, any>,
> = {
    [K in keyof T]: {
        ws: WebSocket,
        data: GetPacketInput<GetPacketSerializerMap<T[K]>>,
        connection: Connection<T, R, P>,
        packets: PacketManagerDecoded<T & ServerSerializerMap>,
    }
}

export type ClientPacketManagerEventMap<T extends PacketManagerSerializerMap> = {
    [K in keyof T]: {
        data: GetPacketInput<GetPacketSerializerMap<T[K]>>,
        packets: PacketManagerDecoded<T & ServerSerializerMap>,
    }
}