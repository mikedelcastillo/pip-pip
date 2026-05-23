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

type GamePacketManagerSerializerMap = ExtractSerializerMap<typeof packetManager>

type GameConnectionLocals = {
    name: string,
}

type GameLobbyLocals = {
    players: string[],
}

export type PipPipServer = Server<GamePacketManagerSerializerMap, GameConnectionLocals, GameLobbyLocals>
export type PipPipConnection = ConnectionOf<PipPipServer>
export type PipPipLobby = LobbyOf<PipPipServer>

const server: PipPipServer = new Server(packetManager, {
    port: getServerPort(8443),
    connectionIdleLifespan: 1000 * 5, //1000 * 60 * 10, // 10 minutes
    lobbyIdleLifespan: 1000 * 5, // 5 second
    verifyTimeLimit: 5000,
    connectionIdLength: CONNECTION_ID_LENGTH,
    lobbyIdLength: LOBBY_ID_LENGTH,
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

    // let logTimeout: NodeJS.Timeout
    // const conLobWatch = new EventCollector(server.events, [
    //     "addConnection", 
    //     "createConnection", 
    //     "createLobby", 
    //     "removeConnection", 
    //     "removeLobby", 
    //     "connectionStatusChange",
    //     "lobbyStatusChange",
    // ])
    // conLobWatch.on("collect", () => {
    //     clearTimeout(logTimeout)
    //     logTimeout = setTimeout(() => {
    //         const map = (a: PipPipLobby | PipPipConnection) => {
    //             return [a.id, a.status].join(":")
    //         }
    //         console.log({
    //             connections: Object.values(server.connections).map(map),
    //             lobbies: Object.values(server.lobbies).map(map),
    //         })
    //         conLobWatch.flush()
    //     }, 100)
    // })
}

run()
