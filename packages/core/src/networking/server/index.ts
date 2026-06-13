import express, { Express, Request, Response, NextFunction } from "express"
import { WebSocketServer } from "ws"
import http from "http"

import { SERVER_DEFAULT_BASE_ROUTE, SERVER_DEFAULT_HEADER_KEY, SERVER_DEFAULT_MAX_PING } from "../../lib/constants"
import { PacketManager, PacketManagerSerializerMap, ServerPacketManagerEventMap } from "../packets/manager"
import { Lobby, LobbyInitializer, LobbyTypeOptions, LobbyType } from "../lobby"
import { initializeConnectionMethods } from "./connection"
import { ServerSerializerMap } from "../packets/server"
import { initializeWebSockets } from "./websockets"
import { EventEmitter } from "../../common/events"
import { initializeLobbyMethods } from "./lobby"
import { initializeRoutes } from "./routes"
import { Connection } from "../connection"
import { ServerEventMap } from "./events"

export type ServerOptions = {
    authHeader: string,
    baseRoute: string,
    port: number,

    connectionIdLength: number,
    lobbyIdLength: number,

    connectionIdleLifespan: number,
    lobbyIdleLifespan: number,
    verifyTimeLimit: number,

    maxConnections: number,
    maxLobbies: number,
    maxPing: number,

    clientDir?: string,
    allowedOrigins?: string[],
}

export type ConnectionOf<T> = T extends Server<infer A, infer B, infer C> ? Connection<A, B, C> : never
export type LobbyOf<T> = T extends Server<infer A, infer B, infer C> ? Lobby<A, B, C> : never

export class Server<
    T extends PacketManagerSerializerMap,
    R extends Record<string, any>,
    P extends Record<string, any>,
>{
    options: ServerOptions = {
        authHeader: SERVER_DEFAULT_HEADER_KEY,
        baseRoute: SERVER_DEFAULT_BASE_ROUTE,
        port: 8443,
        connectionIdLength: 4,
        lobbyIdLength: 4,
        connectionIdleLifespan: 1000 * 60 * 5,
        lobbyIdleLifespan: 1000 * 60 * 5,
        verifyTimeLimit: 1000 * 15,
        maxConnections: 512,
        maxLobbies: 64,
        maxPing: SERVER_DEFAULT_MAX_PING,
    }

    events: EventEmitter<ServerEventMap<T, R, P>> = new EventEmitter("Server")

    connections: Record<string, Connection<T, R, P>> = {}
    lobbies: Record<string, Lobby<T, R, P>> = {}

    lobbyType: Record<string, LobbyType<T, R, P>> = {}

    packets: {
        manager: PacketManager<T>,
        events: EventEmitter<ServerPacketManagerEventMap<T & ServerSerializerMap, R, P>>
    }

    app: Express
    server: http.Server
    wss: WebSocketServer

    constructor(packetManager: PacketManager<T>, options: Partial<ServerOptions> = {}){
        this.options = {
            ...this.options,
            ...options,
        }

        this.packets = {
            manager: packetManager,
            events: new EventEmitter("ServerPackets"),
        }

        this.app = express()
        this.server = http.createServer(this.app)
        this.wss = new WebSocketServer({
            server: this.server,
            verifyClient: (info, done) => {
                if(!this.options.allowedOrigins || this.options.allowedOrigins.length === 0){
                    done(true)
                    return
                }
                done(this.options.allowedOrigins.includes(info.origin))
            },
        })

        initializeRoutes(this)
        initializeWebSockets(this)
        initializeConnectionMethods(this)
        initializeLobbyMethods(this)
    }
}

export interface Server<
    T extends PacketManagerSerializerMap,
    R extends Record<string, any>,
    P extends Record<string, any>,
>{
    // routes.ts
    routerAuthMiddleware: (req: Request, res: Response, next: NextFunction) => void
    start: () => Promise<void>

    // websockets.ts

    // connection.ts
    getConnectionFromRequest: (req: Request) => Connection<T, R, P> | undefined
    getConnectionByConnectionToken: (connectionToken: string) => Connection<T, R, P> | undefined
    getConnectionByWebSocketToken: (websocketToken: string) => Connection<T, R, P> | undefined
    addConnection: (connection: Connection<T, R, P>) => void
    removeConnection: (connection: Connection<T, R, P>) => void
    broadcast: (data: string | ArrayBuffer) => void

    // lobby.ts
    registerLobby: (type: string, options: LobbyTypeOptions, initializer: LobbyInitializer<T, R, P>) => void
    createLobby: <K extends keyof Server<T, R, P>["lobbyType"]>(type: K, id?: string, options?: Record<string, unknown>) => Lobby<T, R, P>
    removeLobby: (lobby: Lobby<T, R, P>) => void

    // optional public-lobby listing hook, populated by the game server (see routes.ts)
    getPublicLobbies?: () => unknown[]
}