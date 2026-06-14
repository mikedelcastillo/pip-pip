import WebSocket from "ws"

import { PacketManagerSerializerMap, ServerPacketManagerEventMap } from "../packets/manager"
import { ServerSerializerMap } from "../packets/server"
import { ConnectionEventMap } from "../server/events"
import { EventEmitter } from "../../common/events"
import { initializeWebSockets } from "./websockets"
import { ConnectionJSON } from "../api/types"
import { generateId } from "../../lib/utils"
import { Server } from "../server"
import { Lobby } from "../lobby"

export type ConnectionLatencyRecord = {
    amount: number,
    timestamp: ReturnType<typeof Date["now"]>,
}

/*
status
idling
connected
disconnected
timedout

*/

export enum ConnectionStatus {
    IDLE = "idle",
    READY = "ready",
    DESTROYED = "destroyed",
}

export class Connection<
    T extends PacketManagerSerializerMap,
    R extends Record<string, any>,
    P extends Record<string, any>,
>{
    id: string
    token = {
        connection: generateId(64),
        websocket: generateId(64),
    }

    server: Server<T, R, P>
    lobby?: Lobby<T, R, P>

    events: EventEmitter<ConnectionEventMap<T, R, P>> = new EventEmitter("Connection")

    locals = {} as R

    packets: {
        events: EventEmitter<ServerPacketManagerEventMap<T & ServerSerializerMap, R, P>>
    }

    latencyHistory: ConnectionLatencyRecord[] = []

    ws?: WebSocket

    idleTimeout?: NodeJS.Timeout

    destroyed = false

    constructor(server: Server<T, R, P>){
        this.server = server
        this.id = generateId(this.server.options.connectionIdLength, Object.keys(this.server.connections))
        this.packets = {
            events: new EventEmitter("ConnectionPackets")
        }
        this.startIdle()
        initializeWebSockets(this)
    }

    get latency(): ConnectionLatencyRecord{
        if(0 in this.latencyHistory){
            return this.latencyHistory[0]
        }
        return {
            amount: 0,
            timestamp: Date.now(),
        }
    }

    get status(): ConnectionStatus{
        if(this.destroyed) return ConnectionStatus.DESTROYED
        if(typeof this.idleTimeout !== "undefined") return ConnectionStatus.IDLE
        return ConnectionStatus.READY
        
    }

    get isIdle(){ return this.status === ConnectionStatus.IDLE }
    get isReady(){ return this.status === ConnectionStatus.READY }
    get isDestroyed(){ return this.status === ConnectionStatus.DESTROYED }

    statusChangeTimeout?: NodeJS.Timeout
    emitStatusChange(){
        if(typeof this.statusChangeTimeout !== "undefined"){
            clearTimeout(this.statusChangeTimeout)
        }
        this.statusChangeTimeout = setTimeout(() => {
            this.events.emit("statusChange", { status: this.status })
            this.server.events.emit("connectionStatusChange", { connection: this })
            this.lobby?.events.emit("connectionStatusChange", { connection: this })
        }, 0)
    }

    startIdle(){
        // A destroyed connection must never (re-)arm its idle timer. destroy()
        // calls removeWebSocket(), which ends in startIdle(); the timer's closure
        // captures `this` (and via it the server), so without this guard every
        // disconnect / kick / lobby-close would pin the torn-down connection in
        // memory for the full idle lifespan (~10 min) and hold a live timer the
        // whole time.
        if(this.destroyed) return
        this.stopIdle()
        this.idleTimeout = setTimeout(() => {
            this.destroy()
        }, this.server.options.connectionIdleLifespan)
        this.events.emit("idleStart")
        this.emitStatusChange()
    }

    stopIdle(){
        if(typeof this.idleTimeout === "undefined") return
        clearTimeout(this.idleTimeout)
        this.idleTimeout = undefined
        this.events.emit("idleEnd")
        this.emitStatusChange()
    }

    destroy(){
        if(this.destroyed === false){
            this.destroyed = true
            if(typeof this.lobby !== "undefined"){
                this.lobby.removeConnection(this)
            }
            this.server.removeConnection(this)

            this.removeWebSocket()
            // removeWebSocket() ends in startIdle() (now a no-op once destroyed),
            // but also clear any idle timer that was already pending so nothing
            // keeps this torn-down connection alive past teardown.
            clearTimeout(this.idleTimeout)
            this.idleTimeout = undefined

            this.events.emit("destroy")
            this.emitStatusChange()
        }
    }

    setLobby(lobby: Lobby<T, R, P>){
        if(typeof this.lobby !== "undefined"){
            this.lobby.removeConnection(this)
        }
        this.lobby = lobby
        this.events.emit("lobbyJoin", { lobby })
    }

    removeLobby(){
        if(this.lobby !== undefined){
            const lobby = this.lobby
            this.lobby = undefined
            this.events.emit("lobbyLeave", { lobby })
        }
    }

    toJson(showSensitive = false){
        const output: ConnectionJSON = {
            connectionId: this.id,
            lobbyId: this.lobby?.id,
            status: this.status,
        }

        if(showSensitive){
            output.connectionToken = this.token.connection
            output.websocketToken = this.token.websocket
        }

        return output
    }
}

export interface Connection<
    T extends PacketManagerSerializerMap,
    R extends Record<string, any>,
    P extends Record<string, any>,
>{
    // websockets.ts
    setWebSocket: (ws: WebSocket) => void
    removeWebSocket: () => void
    send: (data: string | ArrayBuffer | Uint8Array) => void
    getPing: () => Promise<number>
}