import path from "path"
import fs from "fs"

import { ExtractSerializerMap } from "@pip-pip/core/src/networking/packets/manager"
import { LobbyTypeOptions } from "@pip-pip/core/src/networking/lobby"
import { EventCollector, EventMapOf } from "@pip-pip/core/src/common/events"
import { ConnectionOf, LobbyOf, Server } from "@pip-pip/core/src/networking/server"
import { Ticker } from "@pip-pip/core/src/common/ticker"

import { CONNECTION_ID_LENGTH, LOBBY_ID_LENGTH, packetManager } from "@pip-pip/game/src/networking/packets"
import { PipPipGame } from "@pip-pip/game/src/logic"
import { sendPacketToConnection } from "./connection-out"
import { processLobbyPackets } from "./connection-in"

import { PING_REFRESH } from "@pip-pip/game/src/logic/constants"
import { getServerPort } from "@pip-pip/core/src/lib/server-env"
import { getPublicLobbies } from "./public-lobbies"

type GamePacketManagerSerializerMap = ExtractSerializerMap<typeof packetManager>

type GameConnectionLocals = {
    name: string,
}

type GameLobbyLocals = {
    players: string[],
    lobbyName: string,
    isPublic: boolean,
    mapLabel: string,
    hostName: string,
    maxPlayers: number,
    createdAt: number,
}

export type LobbyCreationOptions = {
    lobbyName?: string,
    isPublic?: boolean,
    mapLabel?: string,
    maxPlayers?: number,
}

export type PipPipServer = Server<GamePacketManagerSerializerMap, GameConnectionLocals, GameLobbyLocals>
export type PipPipConnection = ConnectionOf<PipPipServer>
export type PipPipLobby = LobbyOf<PipPipServer>

const clientDir = process.env.CLIENT_DIR || path.resolve(__dirname, "../../client/dist")
const serveClient = fs.existsSync(path.join(clientDir, "index.html"))
const allowedOrigins = (process.env.HRZN_ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean)

const server: PipPipServer = new Server(packetManager, {
    port: getServerPort(8443),
    connectionIdleLifespan: 1000 * 60 * 10, // 10 minutes
    lobbyIdleLifespan: 1000 * 60 * 10, // 10 minutes
    verifyTimeLimit: 5000,
    connectionIdLength: CONNECTION_ID_LENGTH,
    lobbyIdLength: LOBBY_ID_LENGTH,
    ...(serveClient ? { clientDir } : {}),
    ...(allowedOrigins.length > 0 ? { allowedOrigins } : {}),
})

const defaultLobbyOptions: LobbyTypeOptions = {
    maxConnections: 16,
    maxInstances: 128,
    userCreatable: true,
}

export type GameTickContext = {
    lobby: PipPipLobby,
    game: PipPipGame, 
    lobbyEvents: EventCollector<EventMapOf<PipPipLobby["events"]>>,
    gameEvents: EventCollector<EventMapOf<PipPipGame["events"]>>,
}

export type ConnectionContext = {
    connection: PipPipConnection,
} & GameTickContext

server.registerLobby("default", defaultLobbyOptions, ({lobby}) => {
    const game = new PipPipGame({
        calculateAi: true,
        shootPlayerBullets: true,
        shootAiBullets: true,
        assignHost: true,
        triggerPhases: true,
        triggerSpawns: true,
        triggerDamage: true,
        considerPlayerPing: true,
        setScores: true,
        spawnPowerups: true,
    })

    // Fill in lobby metadata defaults for any field a caller did not seed via
    // createLobby options (which were already Object.assign'd onto locals).
    const requestedMaxPlayers = lobby.locals.maxPlayers
    const typeMax = lobby.typeOptions.maxConnections
    lobby.locals.players ??= []
    lobby.locals.createdAt ??= Date.now()
    lobby.locals.lobbyName ??= lobby.id
    lobby.locals.isPublic ??= false
    lobby.locals.mapLabel ??= game.mapType?.name ?? "Unknown"
    lobby.locals.hostName ??= "Unknown"
    lobby.locals.maxPlayers = Math.min(requestedMaxPlayers ?? typeMax, typeMax)

    // Keep the players list and host name in sync with the connections.
    lobby.events.on("addConnection", ({ connection }) => {
        const name = connection.locals.name ?? connection.id
        if(!lobby.locals.players.includes(name)){
            lobby.locals.players.push(name)
        }
        if(Object.keys(lobby.connections).length === 1 || lobby.locals.hostName === "Unknown"){
            lobby.locals.hostName = name
        }
    })

    lobby.events.on("removeConnection", ({ connection }) => {
        const name = connection.locals.name ?? connection.id
        lobby.locals.players = lobby.locals.players.filter(player => player !== name)
    })

    const lobbyEvents = new EventCollector(lobby.events)
    const gameEvents = new EventCollector(game.events)

    const debugTick = new Ticker(2, false, "Debug")
    const pingTick = new Ticker(PING_REFRESH, false, "Ping")
    const updateTick = new Ticker(20, false, "Game")

    const gameContext: GameTickContext = { lobby, game, lobbyEvents, gameEvents }

    const getConnectionContext = (connection: PipPipConnection): ConnectionContext => ({ connection, ...gameContext, })

    updateTick.on("tick", () => {
        // process lobby packets
        processLobbyPackets(gameContext)

        // update game
        game.update()

        // send messages to connections
        const readyConnections = Object.values(lobby.connections).filter(connection => connection.isReady)
        for(const connection of readyConnections){
            sendPacketToConnection(getConnectionContext(connection))
        }

        lobbyEvents.flush()
        gameEvents.flush()
    })

    pingTick.on("tick", () => {
        for(const connection of Object.values(lobby.connections)){
            connection.getPing().then((ping) => {
                const player = game.players[connection.id]
                if(typeof player !== "undefined"){
                    player.ping = ping
                }
            })
        }
    })

    debugTick.on("tick", () => {
        // const players = Object.keys(game.players)
        // if(players.length) console.log(players)
    })
    
    lobby.events.on("destroy", () => {
        debugTick.destroy()
        pingTick.destroy()
        updateTick.destroy()
        lobbyEvents.destroy()
        gameEvents.destroy()
        game.destroy()
    })

    pingTick.startTick()
    debugTick.startTick()
    updateTick.startTick()
})

// Expose the public-lobby listing to core's GET /lobbies route. Core cannot
// import from @pip-pip/server, so it calls this optional hook instead.
server.getPublicLobbies = () => getPublicLobbies(server.lobbies)

async function run(){
    await server.start()

    const artLines = [
        "---------------- WELCOME TO ----------------",
        "██████╗░██╗██████╗░░░░░░░██████╗░██╗██████╗░",
        "██╔══██╗██║██╔══██╗░░░░░░██╔══██╗██║██╔══██╗",
        "██████╔╝██║██████╔╝█████╗██████╔╝██║██████╔╝",
        "██╔═══╝░██║██╔═══╝░╚════╝██╔═══╝░██║██╔═══╝░",
        "██║░░░░░██║██║░░░░░░░░░░░██║░░░░░██║██║░░░░░",
        "╚═╝░░░░░╚═╝╚═╝░░░░░░░░░░░╚═╝░░░░░╚═╝╚═╝░░░░░",
        `---------- http://localhost:${server.options.port} -----------`,
    ]

    console.log(artLines.join("\n"))
}

run()
