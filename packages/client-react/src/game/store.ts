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

export interface GameStoreState {
    loading: boolean

    phase: PipPipGamePhase
    countdownMs: number

    isHost: boolean
    ping: number

    clientPlayerShipIndex: number
    clientPlayerShipType: ShipType
    clientPlayerStats: ClientPlayerStats

    players: GameStorePlayer[]

    showPlayerList: boolean

    chatMessages: ChatMessage[]
    outgoingMessages: string[]

    addChatMessage: (msg: ChatMessage) => void
    clearChatMessages: () => void
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

    clientPlayerShipIndex: 0,
    clientPlayerShipType: PIP_SHIPS[0],
    clientPlayerStats: {
        reloading: false,
        ammo: 0, ammoMax: 0,
        health: 0, healthMax: 0,
    },

    players: [],

    showPlayerList: false,

    chatMessages: [],
    outgoingMessages: [],

    addChatMessage: (msg) => set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
    clearChatMessages: () => set({ chatMessages: [] }),
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
        }

        set(next)
    },
}))
