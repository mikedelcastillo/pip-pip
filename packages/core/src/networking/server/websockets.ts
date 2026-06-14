import WebSocket, { RawData } from "ws"

import { PacketManagerSerializerMap } from "../packets/manager"
import { getForceLatency } from "../../lib/server-env"
import { Connection } from "../connection"
import { Server } from "."
import { decompress } from "../../lib/compression"

// Hard ceiling on the decoded (post-decompress) byte length of a single client
// message. A legit batch — inputs, chat, ship/name changes — is well under a
// kilobyte; 64KB leaves enormous headroom while stopping one socket from
// shipping a multi-megabyte payload that would stall the lobby decode or OOM
// the process. Breaching this closes the socket (the peer is misbehaving).
export const MAX_MESSAGE_BYTES = 64 * 1024

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
                        // Reject oversized payloads BEFORE allocating/decoding so a
                        // single socket cannot OOM or stall the lobby. Checked both
                        // on the raw frame (cheap, pre-decompress bomb guard) and on
                        // the decoded bytes; either breach closes the socket.
                        if(data.byteLength > MAX_MESSAGE_BYTES){
                            ws.close()
                            return
                        }
                        try{
                            const decoded = await decompress(data)
                            if(decoded.byteLength > MAX_MESSAGE_BYTES){
                                ws.close()
                                return
                            }
                            const packets = server.packets.manager.decode(decoded)
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