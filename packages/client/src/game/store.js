import { PipPipGamePhase } from "@pip-pip/game/src/logic";
import { CHAT_MAX_MESSAGE_LENGTH } from "@pip-pip/game/src/logic/constants";
import { PIP_SHIPS } from "@pip-pip/game/src/ships";
import { create } from "zustand";
import { GAME_CONTEXT, getClientPlayer } from ".";
export function playerToGameStore(player) {
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
    };
}
export const useGameStore = create((set, get) => ({
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
        const current = get().outgoingMessages;
        if (current.length === 0)
            return [];
        set({ outgoingMessages: [] });
        return current;
    },
    sync: () => {
        const { game } = GAME_CONTEXT;
        const gameClientPlayer = getClientPlayer(game);
        const next = {
            phase: game.phase,
            countdownMs: game.countdown / game.tps * 1000,
            showPlayerList: GAME_CONTEXT.keyboard.state.Tab === true,
            players: Object.values(game.players).map(playerToGameStore),
        };
        if (typeof gameClientPlayer !== "undefined") {
            next.isHost = game.host?.id === gameClientPlayer.id;
            next.ping = gameClientPlayer.ping;
            next.clientPlayerShipIndex = gameClientPlayer.shipIndex;
            next.clientPlayerShipType = PIP_SHIPS[gameClientPlayer.shipIndex];
            next.clientPlayerStats = {
                reloading: gameClientPlayer.ship.isReloading,
                ammo: gameClientPlayer.ship.capacities.weapon,
                ammoMax: gameClientPlayer.ship.stats.weapon.capacity,
                health: gameClientPlayer.ship.capacities.health,
                healthMax: gameClientPlayer.ship.maxHealth,
            };
        }
        set(next);
    },
}));
//# sourceMappingURL=store.js.map