import WebSocket, { RawData } from "ws"

import { PacketManagerSerializerMap, ServerPacketManagerEventMap } from "../packets/manager"
import { PING_PONG_PACKET_ID_LENGTH, ServerSerializerMap } from "../packets/server"
import { getForceLatency } from "../../lib/server-env"
import { EventCallbackOf, EventEmitter } from "../../common/events"
import { Connection } from "."
import { compress } from "../../lib/compression"
import { generateId } from "../../lib/utils"

export function initializeWebSockets<
    T extends PacketManagerSerializerMap,
    R extends Record<string, any>,
    P extends Record<string, any>,
>(connection: Connection<T, R, P>){

    const handleSocketMessage = (data: RawData) => {
        connection.events.emit("socketMessage", { data })
    }

    const handleSocketClose = () => {
        connection.removeWebSocket()
        connection.events.emit("socketClose")
    }

    
    connection.setWebSocket = (ws: WebSocket) => {
        connection.ws = ws
        connection.ws.on("message", handleSocketMessage)
        connection.ws.on("close", handleSocketClose)
        connection.stopIdle() // Emits statusChange 
    }

    connection.removeWebSocket = () => {
        if(typeof connection.ws !== "undefined"){
            connection.ws.off("message", handleSocketMessage)
            connection.ws.off("close", handleSocketClose)
            connection.ws.close()
        }
        connection.events.emit("statusChange", { status: connection.status })
        connection.startIdle() // Emits status
    }

    connection.send = (data: string | ArrayBuffer | Uint8Array) => {
        const send = async () => {
            if(typeof connection.ws !== "undefined"){
                if(connection.ws.readyState === connection.ws.OPEN){
                    const toSend = data instanceof ArrayBuffer ? new Uint8Array(await compress(data)) : data
                    connection.ws.send(toSend)
                }
            }
        }
        const latency = getForceLatency()
        if(latency === 0) send()
        else setTimeout(send, latency)
    }

    type PMSEM = ServerPacketManagerEventMap<ServerSerializerMap, R, P>
    const pe = connection.packets.events as EventEmitter<PMSEM>

    pe.on("ping", ({ data }) => {
        const { pong } = connection.server.packets.manager.serializers
        const code = new Uint8Array(pong.encode({
            id: data.id,
        }))
        connection.send(code)
    })

    connection.getPing = () => new Promise((resolve) => {
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

        const cb: EventCallbackOf<PMSEM, "pong"> = ({ data }) => {
            if(data.id === id) complete()
        }

        pe.on("pong", cb)

        const timeout = setTimeout(() => {
            if(completed === false) complete()
        }, connection.server.options.maxPing)

        const code = connection.server.packets.manager.serializers.ping.encode({ id })
        const buffer = new Uint8Array(code).buffer
        connection.send(buffer)
    })
}