import { PacketManagerSerializerMap, ServerPacketManagerEventMap } from "../packets/manager"
import { ServerSerializerMap } from "../packets/server"
import { EventEmitter } from "../../common/events"
import { LobbyEventMap } from "../server/events"
import { generateId } from "../../lib/utils"
import { Connection } from "../connection"
import { LobbyJSON } from "../api/types"
import { Server } from "../server"

export type LobbyInitializer<
    T extends PacketManagerSerializerMap,
    R extends Record<string, any>,
    P extends Record<string, any>,
> = (args: {
    lobby: Lobby<T, R, P>,
    server: Server<T, R, P>,
}) => void

export type LobbyTypeOptions = {
    maxInstances: number,
    maxConnections: number,
    userCreatable: boolean,
}

export type LobbyType<
    T extends PacketManagerSerializerMap,
    R extends Record<string, any>,
    P extends Record<string, any>,
> = {
    options: LobbyTypeOptions,
    initializer: LobbyInitializer<T, R, P>,
}

export enum LobbyStatus {
    IDLE = "idle",
    ACTIVE = "active",
    DESTROYED = "destroyed",
}

export class Lobby<
    T extends PacketManagerSerializerMap,
    R extends Record<string, any>,
    P extends Record<string, any>,
>{
    id: string
    type: string

    events: EventEmitter<LobbyEventMap<T, R, P>> = new EventEmitter("Lobby")

    server: Server<T, R, P>
    connections: Record<string, Connection<T, R, P>> = {}

    locals = {} as P

    packets: {
        events: EventEmitter<ServerPacketManagerEventMap<T & ServerSerializerMap, R, P>>
    }

    idleTimeout?: NodeJS.Timeout
    destroyed = false

    constructor(server: Server<T, R, P>, type: string){
        this.type = type
        this.server = server
        this.id = generateId(this.server.options.lobbyIdLength, Object.keys(this.server.lobbies))
        this.packets = {
            events: new EventEmitter("LobbyPackets")
        }
        this.startIdle()
    }

    get status(){
        if(this.destroyed === true) return LobbyStatus.DESTROYED
        if(typeof this.idleTimeout !== "undefined") return LobbyStatus.IDLE
        return LobbyStatus.ACTIVE
    }

    statusChangeTimeout?: NodeJS.Timeout
    emitStatusChange(){
        if(typeof this.statusChangeTimeout !== "undefined"){
            clearTimeout(this.statusChangeTimeout)
        }
        this.statusChangeTimeout = setTimeout(() => {
            this.events.emit("statusChange", { status: this.status })
            this.server.events.emit("lobbyStatusChange", { lobby: this })
            for(const connectionId in this.connections){
                this.connections[connectionId].events.emit("lobbyStatusChange", { lobby: this })
            }
        }, 0)
    }

    addConnection(connection: Connection<T, R, P>){
        if(connection.id in this.connections) throw new Error(`Connection "${connection.id}" already in lobby ${this.id}.`)

        if(Object.keys(this.connections).length >= this.typeOptions.maxConnections) throw new Error("Max connections reached for lobby.")

        this.connections[connection.id] = connection
        connection.setLobby(this)
        this.events.emit("addConnection", { connection })
        this.stopIdle()
    }

    removeConnection(connection: Connection<T, R, P>){
        if(connection.id in this.connections){
            connection.removeLobby()
            delete this.connections[connection.id]
            this.events.emit("removeConnection", { connection })

            if(Object.keys(this.connections).length === 0){
                this.startIdle()
            }
        }
    }

    startIdle(){
        this.stopIdle()
        this.idleTimeout = setTimeout(() => {
            this.destroy()
        }, this.server.options.lobbyIdleLifespan)
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
            const connections = Object.values(this.connections)
            for(const connection of connections){
                this.removeConnection(connection)
            }
            this.server.removeLobby(this)
            this.events.emit("destroy")
            this.emitStatusChange()
        }
    }

    get typeOptions(){
        return this.server.lobbyType[this.type].options
    }

    toJson(): LobbyJSON{
        const output: LobbyJSON = {
            lobbyId: this.id,
            lobbyType: this.type,
            connections: Object.keys(this.connections).length,
            maxConnections: this.typeOptions.maxConnections,
            status: this.status,
        }

        return output
    }
}