import { describe, expect, it } from "vitest"

import { LobbyStatus } from "@pip-pip/core/src/networking/lobby"
import {
    getPublicLobbies,
    serializePublicLobby,
    PublicLobbyLike,
} from "../../packages/server/src/public-lobbies"

type LobbyOverrides = {
    id?: string,
    status?: LobbyStatus,
    playerCount?: number,
    isPublic?: boolean,
    lobbyName?: string,
    mapLabel?: string,
    hostName?: string,
    maxPlayers?: number,
    createdAt?: number,
}

function makeLobby(overrides: LobbyOverrides = {}): PublicLobbyLike{
    const playerCount = overrides.playerCount ?? 1
    const connections: Record<string, unknown> = {}
    for(let i = 0; i < playerCount; i++){
        connections[`conn-${i}`] = {}
    }
    return {
        id: overrides.id ?? "AAAA",
        status: overrides.status ?? LobbyStatus.ACTIVE,
        connections,
        locals: {
            lobbyName: overrides.lobbyName ?? "My Lobby",
            isPublic: overrides.isPublic ?? true,
            mapLabel: overrides.mapLabel ?? "Galaxy",
            hostName: overrides.hostName ?? "Alice",
            maxPlayers: overrides.maxPlayers ?? 16,
            createdAt: overrides.createdAt ?? 1000,
        },
    }
}

describe("getPublicLobbies", () => {
    it("includes public, active, not-full lobbies", () => {
        const lobbies = { a: makeLobby({ id: "a" }) }
        const result = getPublicLobbies(lobbies)
        expect(result).toHaveLength(1)
        expect(result[0].lobbyId).toBe("a")
    })

    it("excludes private lobbies", () => {
        const lobbies = { a: makeLobby({ id: "a", isPublic: false }) }
        expect(getPublicLobbies(lobbies)).toHaveLength(0)
    })

    it("excludes full lobbies (playerCount >= maxPlayers)", () => {
        const lobbies = { a: makeLobby({ id: "a", playerCount: 16, maxPlayers: 16 }) }
        expect(getPublicLobbies(lobbies)).toHaveLength(0)
    })

    it("excludes IDLE lobbies", () => {
        const lobbies = { a: makeLobby({ id: "a", status: LobbyStatus.IDLE }) }
        expect(getPublicLobbies(lobbies)).toHaveLength(0)
    })

    it("excludes DESTROYED lobbies", () => {
        const lobbies = { a: makeLobby({ id: "a", status: LobbyStatus.DESTROYED }) }
        expect(getPublicLobbies(lobbies)).toHaveLength(0)
    })

    it("sorts by createdAt ascending", () => {
        const lobbies = {
            late: makeLobby({ id: "late", createdAt: 3000 }),
            early: makeLobby({ id: "early", createdAt: 1000 }),
            mid: makeLobby({ id: "mid", createdAt: 2000 }),
        }
        const result = getPublicLobbies(lobbies)
        expect(result.map(l => l.lobbyId)).toEqual(["early", "mid", "late"])
    })

    it("includes a not-quite-full lobby", () => {
        const lobbies = { a: makeLobby({ id: "a", playerCount: 15, maxPlayers: 16 }) }
        expect(getPublicLobbies(lobbies)).toHaveLength(1)
    })
})

describe("serializePublicLobby", () => {
    it("maps lobby fields to the public JSON shape", () => {
        const lobby = makeLobby({
            id: "ZZZZ",
            playerCount: 3,
            maxPlayers: 8,
            lobbyName: "Cool Room",
            hostName: "Bob",
            mapLabel: "Maze",
            createdAt: 4242,
        })
        expect(serializePublicLobby(lobby)).toEqual({
            lobbyId: "ZZZZ",
            lobbyName: "Cool Room",
            mapLabel: "Maze",
            hostName: "Bob",
            playerCount: 3,
            maxPlayers: 8,
            createdAt: 4242,
        })
    })

    it("derives playerCount from the number of connections", () => {
        const lobby = makeLobby({ playerCount: 5 })
        expect(serializePublicLobby(lobby).playerCount).toBe(5)
    })
})
