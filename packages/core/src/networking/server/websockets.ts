import WebSocket, { RawData } from "ws"

import { PacketManagerSerializerMap } from "../packets/manager"
import { getForceLatency } from "../../lib/server-env"
import { Connection } from "../connection"
import { Server } from "."
import { decompress } from "../../lib/compression"

export function initializeWebSockets<
    T extends PacketManagerSerializerMap,
    R extends Record<string, any>,
    P extends Record<string, any>,
>(server: Server<T, R, P>){
    server.wss.on("connection", (ws: WebSocket) => {
        if(server.wss.clients.size >= server.options.maxConnections){
            ws.close()
            console.warn("WebSocket connected but max connections has already been reached.")
            return
        }

        const verifyTimeout = setTimeout(() => {
            ws.close()
        }, server.options.verifyTimeLimit) // 10 second verify timeout
        let verified = false
        let connection: Connection<T, R, P>

        server.events.emit("socketOpen", { ws })

        ws.on("error", (error) => {
            server.events.emit("socketError", { ws, error })
        })

        ws.binaryType = "arraybuffer"

        ws.on("message", (data: RawData) => {
            const receive = async () => {
                server.events.emit("socketMessage", { ws, data, connection })
                if(verified === true){
                    if(data instanceof ArrayBuffer){
                        try{
                            const packets = server.packets.manager.decode(await decompress(data))
                            for(const key in packets){
                                const values = packets[key] || []
                                for(const value of values){
                                    const event: any = { connection, data: value, ws, packets } // TODO: Fix typing
                                    server.packets.events.emit(key, event)
                                    connection.packets.events.emit(key, event)
                                    connection.lobby?.packets.events.emit(key, event)
                                }
                            }
                            const packetEvent = {
                                packets, ws, connection,
                            }
                            server.events.emit("packetMessage", packetEvent)
                            connection.events.emit("packetMessage", packetEvent)
                            connection.lobby?.events.emit("packetMessage", packetEvent)
                        } catch(e){
                            console.warn(e)
                        }
                    }
                } else{
                // Handle handshake
                    const websocketToken = data.toString()
                    const targetConnection = server.getConnectionByWebSocketToken(websocketToken)
                    if(typeof targetConnection === "undefined"){
                        ws.close()
                    } else{
                        clearTimeout(verifyTimeout)
                        verified = true
                        connection = targetConnection
                        connection.setWebSocket(ws)
                        connection.send(connection.id) // Complete handhsake
                        server.events.emit("socketReady", { ws, connection })
                    }
                }
            }

            const latency = getForceLatency()
            if(latency === 0) receive()
            else setTimeout(receive, latency)
        })

        ws.on("close", () => {
            clearTimeout(verifyTimeout)
            if(verified && typeof connection !== "undefined"){
                server.events.emit("socketClose", { ws, connection })
            } else{
                server.events.emit("socketVerifyFail", { ws })
            }
        })

    })

    server.wss.on("error", console.warn)
}