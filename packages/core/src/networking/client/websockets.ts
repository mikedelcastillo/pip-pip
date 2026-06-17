import { RawData, WebSocket as NodeWebSocket } from "ws"

import { ClientPacketManagerEventMap, PacketManagerSerializerMap } from "../packets/manager"
import { PING_PONG_PACKET_ID_LENGTH, ServerSerializerMap } from "../packets/server"
import { EventCallbackOf, EventEmitter } from "../../common/events"
import { Client } from "."
import { compress, decompress } from "../../lib/compression"
import { generateId } from "../../lib/utils"

export function initializeWebSockets<T extends PacketManagerSerializerMap>(client: Client<T>){
    const isBrowser = typeof window !== "undefined"

    client.send = async (data: string | ArrayBuffer | Uint8Array) => {
        if(typeof client.ws === "undefined") return
        if(client.ws.readyState !== client.ws.OPEN) return
        
        const toSend = data instanceof ArrayBuffer ? new Uint8Array(await compress(data)) : data
        // TS 5.7+ types typed arrays as Uint8Array<ArrayBufferLike>, which no longer
        // satisfies the DOM WebSocket.send BufferSource type; runtime accepts it fine.
        client.ws.send(toSend as string | Uint8Array<ArrayBuffer>)
    }

    client.connectWebSocket = () => new Promise((resolve, reject) => {
        if(typeof client.websocketToken === "undefined") reject(new Error("Client token not set."))
        let verified = false

        const openHandler = () => {
            client.send(client.websocketToken as string)
        }

        const closeHandler = () => {
            if(verified){
                client.events.emit("socketClose")
            } else{
                reject()
            }
        }

        const messageHandler = async (data: string | ArrayBuffer) => {
            client.events.emit("socketMessage", { data, verified })
            if(verified === true){
                if(data instanceof ArrayBuffer){
                    try{
                        const packets = client.packets.manager.decode(await decompress(data))
                        for(const key in packets){
                            const values = packets[key] || []
                            for(const value of values){
                                client.packets.events.emit(key, {
                                    data: value, packets,
                                } as any)
                            }
                        }
                        client.events.emit("packetMessage", { packets })
                    } catch(e){
                        console.warn(e)
                    }
                }
            } else{
                if(typeof data === "string"){
                    const connectionId = data
                    if(connectionId === client.connectionId){
                        verified = true
                        client.events.emit("socketReady")
                        resolve()
                    }
                }
            }
        }

        if(isBrowser){
            const ws = new WebSocket(client.wsUrl)
            ws.binaryType = "arraybuffer"
            ws.addEventListener("open", openHandler)
            ws.addEventListener("close", closeHandler)
            ws.addEventListener("message", ({ data }) => {
                messageHandler(data instanceof ArrayBuffer ? data : data.toString())
            })
            client.ws = ws
        } else{
            const ws = new NodeWebSocket(client.wsUrl)
            ws.binaryType = "arraybuffer"
            ws.on("open", openHandler)
            ws.on("close", closeHandler)
            ws.on("message", (data: RawData) => {
                messageHandler(data instanceof ArrayBuffer ? data : data.toString())
            })
            client.ws = ws
        }
    })

    client.connect = async () => {
        if(client.isReady) return
        await client.requestConnectionIfNeeded()
        await client.connectWebSocket()
    }

    client.disconnect = async () => {
        if(!client.isReady) return
        if(typeof client.ws !== "undefined"){
            client.ws.close()
        }
    }

    type PMCEM = ClientPacketManagerEventMap<ServerSerializerMap>
    const pe = client.packets.events as EventEmitter<PMCEM>

    pe.on("ping", ({ data }) => {
        const code = new Uint8Array(client.packets.manager.serializers.pong.encode({
            id: data.id,
        }))
        client.send(code)
    })

    client.getPing = () => new Promise((resolve) => {
        let completed = false

        const now = Date.now()
        const id = generateId(PING_PONG_PACKET_ID_LENGTH)

        const complete = () => {
            const ping = Date.now() - now
            completed = true
            pe.off("pong", cb)
            clearTimeout(timeout)
            resolve(ping)
        }

        const cb: EventCallbackOf<PMCEM, "pong"> = ({ data }) => {
            if(data.id === id) complete()
        }

        pe.on("pong", cb)

        const timeout = setTimeout(() => {
            if(completed === false) complete()
        }, client.options.maxPing)

        const code = client.packets.manager.serializers.ping.encode({ id })
        const buffer = new Uint8Array(code).buffer
        client.send(buffer)
    })
}