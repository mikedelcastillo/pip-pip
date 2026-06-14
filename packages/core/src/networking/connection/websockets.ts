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

    // The close handler bound to the CURRENT socket, tracked so removeWebSocket can
    // detach exactly that handler. Each adopted socket gets its OWN close handler so
    // a stale socket's late close can never tear down a newer one (see setWebSocket).
    let currentClose: (() => void) | undefined

    // Detach our listeners from a socket and close it WITHOUT running the idle /
    // teardown path. Used to discard a socket that a newer one has superseded.
    const detachSocket = (ws: WebSocket, onClose?: () => void) => {
        ws.off("message", handleSocketMessage)
        if(typeof onClose !== "undefined") ws.off("close", onClose)
        ws.close()
    }

    connection.setWebSocket = (ws: WebSocket) => {
        const previous = connection.ws
        const previousClose = currentClose

        // A close handler SPECIFIC to this socket: it only tears the connection down
        // if `ws` is still the live socket when it fires. On a flaky network the old
        // socket's OS-level "close" can arrive seconds AFTER the client has already
        // reconnected on a new socket; without this identity guard that late close
        // would run removeWebSocket() against the new socket and kill the fresh
        // session, stranding the player.
        const onClose = () => {
            if(connection.ws !== ws) return
            connection.removeWebSocket()
            connection.events.emit("socketClose")
        }

        connection.ws = ws
        currentClose = onClose
        ws.on("message", handleSocketMessage)
        ws.on("close", onClose)

        // Replacing an existing socket on reconnect: discard the old one so it can
        // neither leak its listeners nor later fire a close/message at this
        // connection. Its close handler is detached first, so closing it is silent.
        if(typeof previous !== "undefined" && previous !== ws){
            detachSocket(previous, previousClose)
        }

        connection.stopIdle() // Emits statusChange
    }

    connection.removeWebSocket = () => {
        if(typeof connection.ws !== "undefined"){
            connection.ws.off("message", handleSocketMessage)
            if(typeof currentClose !== "undefined") connection.ws.off("close", currentClose)
            connection.ws.close()
            connection.ws = undefined
            currentClose = undefined
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