import path from "path"
import fs from "fs"

import { ExtractSerializerMap } from "@pip-pip/core/src/networking/packets/manager"
import { LobbyTypeOptions } from "@pip-pip/core/src/networking/lobby"
import { EventCollector, EventMapOf } from "@pip-pip/core/src/common/events"
import { ConnectionOf, LobbyOf, Server } from "@pip-pip/core/src/networking/server"
import { Ticker } from "@pip-pip/core/src/common/ticker"

import { CONNECTION_ID_LENGTH, LOBBY_ID_LENGTH, packetManager } from "@pip-pip/game/src/networking/packets"
import { PipPipGame, PipPipGameMode, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { buildSharedTickCache, sendPacketToConnection } from "./connection-out"
import { processLobbyPackets } from "./connection-in"

import { PING_REFRESH } from "@pip-pip/game/src/logic/constants"
import { getServerPort } from "@pip-pip/core/src/lib/server-env"
import { getPublicLobbies } from "./public-lobbies"
import {
    createTelegramBot,
    formatLobbyCreated,
    formatMatchStarted,
    formatPlayerConnect,
    formatPlayerMilestone,
    formatServerStart,
    ServerSnapshot,
} from "./telegram"

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
    // Match configuration seeded by the host at createLobby time and applied to
    // game.settings in the initializer below. mode picks DEATHMATCH/KILL_FRENZY,
    // maxKills is the DEATHMATCH kill cap, matchMinutes the KILL_FRENZY length.
    mode: PipPipGameMode,
    maxKills: number,
    matchMinutes: number,
}

export type LobbyCreationOptions = {
    lobbyName?: string,
    isPublic?: boolean,
    mapLabel?: string,
    maxPlayers?: number,
    mode?: PipPipGameMode,
    maxKills?: number,
    matchMinutes?: number,
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

// Registry of the live game per lobby id, so the Telegram snapshot can count
// bots (bots are players with no connection, so they are NOT in lobby.locals
// or server.connections). Populated in the lobby initializer, cleared on
// lobby destroy. Empty/no-op when the Telegram feature is disabled.
const gamesByLobby = new Map<string, PipPipGame>()

// When the server started, used for uptime/status reporting.
const serverStartedAt = Date.now()

// Region label for analytics messages. Railway injects RAILWAY_REPLICA_REGION;
// fall back to a generic label so the message still reads cleanly off-platform.
const serverRegion = process.env.RAILWAY_REPLICA_REGION || process.env.HRZN_REGION || "local"

// Deployed build commit, read purely from Railway's injected git env vars
// (short sha + commit subject). Falls back to "local dev" when those are absent,
// so local development needs no git env vars set. Display-only.
const serverCommit = (() => {
    const sha = (process.env.RAILWAY_GIT_COMMIT_SHA || "").slice(0, 7)
    const subject = (process.env.RAILWAY_GIT_COMMIT_MESSAGE || "").split("\n")[0].trim()
    const parts = [sha, subject].filter(part => part.length > 0)
    return parts.length > 0 ? parts.join(" ") : "local dev"
})()

// Compute a fresh snapshot of live server state on demand (cheap; only runs
// when a Telegram command or broadcast needs it, never in the game tick).
function buildSnapshot(): ServerSnapshot{
    const lobbies = Object.values(server.lobbies)
    const players: string[] = []
    let botCount = 0

    for(const game of gamesByLobby.values()){
        for(const player of Object.values(game.players)){
            if(player.isBot === true){
                botCount += 1
            } else{
                players.push(player.name)
            }
        }
    }

    const lobbySummaries = lobbies.map(lobby => ({
        id: lobby.id,
        name: lobby.locals.lobbyName ?? lobby.id,
        isPublic: lobby.locals.isPublic === true,
        playerCount: Object.keys(lobby.connections).length,
    }))

    return {
        region: serverRegion,
        port: server.options.port,
        commit: serverCommit,
        startedAt: serverStartedAt,
        lobbyCount: lobbies.length,
        publicLobbyCount: lobbySummaries.filter(lobby => lobby.isPublic).length,
        totalPlayers: players.length,
        botCount,
        players,
        lobbies: lobbySummaries,
    }
}

// Optional Telegram bot. undefined (and a total no-op) when TELEGRAM_TOKEN is
// unset. We start its poll loop only after server.start() succeeds (see run()).
const telegramBot = createTelegramBot(
    process.env.TELEGRAM_TOKEN,
    process.env.TELEGRAM_USER_IDS,
    buildSnapshot,
)

// Fire-and-forget broadcast helper: safe to call even when the bot is disabled
// (no-op) and never throws into the caller (the bot swallows network errors).
function telegramBroadcast(text: string){
    if(typeof telegramBot === "undefined") return
    void telegramBot.broadcast(text)
}

// Player-count milestones we announce once as they are first crossed. Tracked
// across the whole server so we do not re-announce on every join past the line.
const PLAYER_MILESTONES = [10, 25, 50, 100]
let lastMilestoneAnnounced = 0

function maybeAnnounceMilestone(totalPlayers: number){
    for(const milestone of PLAYER_MILESTONES){
        if(totalPlayers >= milestone && milestone > lastMilestoneAnnounced){
            lastMilestoneAnnounced = milestone
            telegramBroadcast(formatPlayerMilestone(milestone))
        }
    }
}

// Broadcast lobby-created + per-player-connect analytics by hooking the Server's
// own events (no core changes needed). createLobby/addConnection/removeConnection
// all fire on server.events.
server.events.on("createLobby", ({ lobby }) => {
    telegramBroadcast(formatLobbyCreated({
        id: lobby.id,
        name: lobby.locals.lobbyName ?? lobby.id,
        isPublic: lobby.locals.isPublic === true,
        playerCount: Object.keys(lobby.connections).length,
    }))
})

server.events.on("addConnection", ({ connection }) => {
    const snapshot = buildSnapshot()
    const name = connection.locals.name ?? connection.id
    telegramBroadcast(formatPlayerConnect(name, snapshot.totalPlayers))
    maybeAnnounceMilestone(snapshot.totalPlayers)
})

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

    // Register this lobby's game so the Telegram snapshot can count bots/players.
    // Cleared on lobby destroy below. No-op overhead when Telegram is disabled.
    gamesByLobby.set(lobby.id, game)

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

    // Apply the host-chosen match configuration to the authoritative game
    // settings. setSettings only takes effect in SETUP (which a fresh lobby is)
    // and ignores unknown/undefined keys, so partial/absent options keep the
    // game defaults. mode is sanitised to a known enum value; the numeric targets
    // are clamped to the same bounds the host UI enforces (and to uint8 range, so
    // the gameState packet never overflows).
    const requestedMode = lobby.locals.mode
    const mode = requestedMode === PipPipGameMode.KILL_FRENZY
        ? PipPipGameMode.KILL_FRENZY
        : requestedMode === PipPipGameMode.TEAM_DEATHMATCH
            ? PipPipGameMode.TEAM_DEATHMATCH
            : PipPipGameMode.DEATHMATCH
    const maxKills = typeof lobby.locals.maxKills === "number"
        ? Math.max(1, Math.min(255, Math.floor(lobby.locals.maxKills)))
        : game.settings.maxKills
    const matchMinutes = typeof lobby.locals.matchMinutes === "number"
        ? Math.max(1, Math.min(60, Math.floor(lobby.locals.matchMinutes)))
        : game.settings.matchMinutes
    // TEAM_DEATHMATCH runs with teams on and friendly fire off; the free-for-all
    // modes run with neither, so a freshly hosted lobby lands a consistent pair.
    const isTeam = mode === PipPipGameMode.TEAM_DEATHMATCH
    game.setSettings({ mode, maxKills, matchMinutes, useTeams: isTeam, friendlyFire: !isTeam })
    // Reflect the resolved values back onto locals so any later read is accurate.
    lobby.locals.mode = mode
    lobby.locals.maxKills = maxKills
    lobby.locals.matchMinutes = matchMinutes

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

        // send messages to connections. The per-player broadcast packets that
        // are byte-identical for every recipient this tick (playerPosition,
        // playerInputs, playerPing and the global serverTickHeader) are encoded
        // ONCE here, before the per-connection loop, and reused for every
        // recipient instead of being re-encoded once per connection. The
        // recipient-specific packets (ownPlayerState, targeted playerDamage,
        // owner-only playerPositionSync, etc.) are still composed per connection.
        const readyConnections = Object.values(lobby.connections).filter(connection => connection.isReady)
        const sharedCache = buildSharedTickCache(game)
        for(const connection of readyConnections){
            sendPacketToConnection(getConnectionContext(connection), sharedCache)
        }

        // Telegram analytics: announce when a match kicks off. A phaseChange into
        // COUNTDOWN is the moment startMatch fired, so we report it once here.
        if(typeof telegramBot !== "undefined" && gameEvents.filter("phaseChange").length > 0){
            if(game.phase === PipPipGamePhase.COUNTDOWN){
                telegramBroadcast(formatMatchStarted({
                    id: lobby.id,
                    name: lobby.locals.lobbyName ?? lobby.id,
                    isPublic: lobby.locals.isPublic === true,
                    playerCount: Object.keys(lobby.connections).length,
                }))
            }
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
        gamesByLobby.delete(lobby.id)
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

    // Start the optional Telegram bot only after the server is up. Disabled (and
    // a no-op) when TELEGRAM_TOKEN is unset: telegramBot is then undefined.
    if(typeof telegramBot !== "undefined"){
        telegramBot.start()
        telegramBroadcast(formatServerStart(buildSnapshot()))
        console.log("[telegram] bot enabled")
    }
}

run()
