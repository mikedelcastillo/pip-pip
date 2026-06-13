import { PipPipGamePhase } from "@pip-pip/game/src/logic"
import { CHAT_MAX_MESSAGE_LENGTH } from "@pip-pip/game/src/logic/constants"
import { PipPlayer, PlayerScores } from "@pip-pip/game/src/logic/player"
import { PIP_SHIPS, ShipType } from "@pip-pip/game/src/ships"
import { create } from "zustand"
import { GAME_CONTEXT, getClientPlayer } from "."
import { ChatMessage } from "./chat"

export type GameStorePlayer = {
    id: string,
    name: string,
    idle: boolean,
    spectator: boolean,
    ping: number,
    score: PlayerScores,
    shipIndex: number,
    shipType: ShipType,
    isHost: boolean,
    isClient: boolean,
}

export function playerToGameStore(player: PipPlayer): GameStorePlayer {
    return {
        id: player.id,
        name: player.name,
        idle: player.idle,
        spectator: player.spectator,
        ping: player.ping,
        score: player.score,
        shipIndex: player.shipIndex,
        shipType: player.shipType,
        isHost: GAME_CONTEXT.game.host?.id === player.id,
        isClient: GAME_CONTEXT.client.connectionId === player.id,
    }
}

export interface ClientPlayerStats {
    reloading: boolean
    ammo: number
    ammoMax: number
    health: number
    healthMax: number
}

// One transient line in the in-match kill feed. `time` is the Date.now() the
// kill was recorded at, used to fade and expire the entry (see visibleKills).
export interface KillEntry {
    id: number
    killerName: string
    killedName: string
    time: number
}

// How many entries the feed retains. The feed is short and transient; older
// kills scroll off both by this cap and by the duration in visibleKills.
export const KILL_FEED_MAX = 6

// How long (ms) a kill stays in the feed before it expires.
export const KILL_FEED_DURATION_MS = 5000

// Pure selector: the kills still young enough to show, NEWEST FIRST. An entry
// is visible while its age (now - time) is below durationMs. Kept pure (no
// store/Date access) so it is trivially unit-testable.
export function visibleKills(feed: KillEntry[], now: number, durationMs = KILL_FEED_DURATION_MS): KillEntry[] {
    return feed
        .filter((entry) => now - entry.time < durationMs)
        .sort((a, b) => b.time - a.time)
}

export interface GameStoreState {
    loading: boolean

    phase: PipPipGamePhase
    countdownMs: number

    isHost: boolean
    ping: number

    mapIndex: number

    clientPlayerShipIndex: number
    clientPlayerShipType: ShipType
    clientPlayerStats: ClientPlayerStats

    // Spectator UI state for the local player.
    clientSpectating: boolean
    spectateTargetName: string

    players: GameStorePlayer[]

    showPlayerList: boolean

    chatMessages: ChatMessage[]
    outgoingMessages: string[]

    killFeed: KillEntry[]

    addChatMessage: (msg: ChatMessage) => void
    clearChatMessages: () => void
    addKill: (killerName: string, killedName: string) => void
    addOutgoingMessage: (text: string) => void
    consumeOutgoingMessages: () => string[]
    sync: () => void
}

export const useGameStore = create<GameStoreState>((set, get) => ({
    loading: false,

    phase: PipPipGamePhase.SETUP,
    countdownMs: 0,

    isHost: false,
    ping: 0,

    mapIndex: 0,

    clientPlayerShipIndex: 0,
    clientPlayerShipType: PIP_SHIPS[0],
    clientPlayerStats: {
        reloading: false,
        ammo: 0, ammoMax: 0,
        health: 0, healthMax: 0,
    },

    clientSpectating: false,
    spectateTargetName: "",

    players: [],

    showPlayerList: false,

    chatMessages: [],
    outgoingMessages: [],

    killFeed: [],

    addChatMessage: (msg) => set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
    // Clearing chat also clears the kill feed: they share the same lifecycle
    // (e.g. the local player (re)joining) and the /clear command.
    clearChatMessages: () => set({ chatMessages: [], killFeed: [] }),
    addKill: (killerName, killedName) => set((s) => {
        const entry: KillEntry = {
            // Date.now() can collide within a tick, so disambiguate the React
            // key with the current feed length.
            id: Date.now() + s.killFeed.length,
            killerName,
            killedName,
            time: Date.now(),
        }
        return { killFeed: [...s.killFeed, entry].slice(-KILL_FEED_MAX) }
    }),
    addOutgoingMessage: (text) => set((s) => ({
        outgoingMessages: [...s.outgoingMessages, text.trim().substring(0, CHAT_MAX_MESSAGE_LENGTH)],
    })),
    consumeOutgoingMessages: () => {
        const current = get().outgoingMessages
        if (current.length === 0) return []
        set({ outgoingMessages: [] })
        return current
    },

    sync: () => {
        const { game } = GAME_CONTEXT
        const gameClientPlayer = getClientPlayer(game)

        const next: Partial<GameStoreState> = {
            phase: game.phase,
            countdownMs: game.countdown / game.tps * 1000,
            mapIndex: game.mapIndex,
            showPlayerList: GAME_CONTEXT.keyboard.state.Tab === true,
            players: Object.values(game.players).map(playerToGameStore),
        }

        if (typeof gameClientPlayer !== "undefined") {
            next.isHost = game.host?.id === gameClientPlayer.id
            next.ping = gameClientPlayer.ping
            next.clientPlayerShipIndex = gameClientPlayer.shipIndex
            next.clientPlayerShipType = PIP_SHIPS[gameClientPlayer.shipIndex]
            next.clientPlayerStats = {
                reloading: gameClientPlayer.ship.isReloading,
                ammo: gameClientPlayer.ship.capacities.weapon,
                ammoMax: gameClientPlayer.ship.stats.weapon.capacity,
                health: gameClientPlayer.ship.capacities.health,
                healthMax: gameClientPlayer.ship.maxHealth,
            }
            next.clientSpectating = gameClientPlayer.spectator
            next.spectateTargetName = gameClientPlayer.spectator
                ? (GAME_CONTEXT.getSpectateTarget()?.name ?? "")
                : ""
        }

        set(next)
    },
}))
