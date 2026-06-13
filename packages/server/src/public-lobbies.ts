import { LobbyStatus } from "@pip-pip/core/src/networking/lobby"

// Mirror of @pip-pip/core's PublicLobbyJSON. Re-declared here so this module
// stays a pure, dependency-light unit that tests can import without dragging in
// the full Server/Lobby machinery.
export type PublicLobbyJSON = {
    lobbyId: string,
    lobbyName: string,
    mapLabel: string,
    hostName: string,
    playerCount: number,
    maxPlayers: number,
    createdAt: number,
}

// Metadata the game server stores on a lobby's locals (see packages/server/src/index.ts).
export type PublicLobbyLocals = {
    lobbyName: string,
    isPublic: boolean,
    mapLabel: string,
    hostName: string,
    maxPlayers: number,
    createdAt: number,
}

// Structural shape of a lobby this module needs. Typed loosely enough that tests
// can pass plain stub objects without constructing a real Lobby.
export type PublicLobbyLike = {
    id: string,
    status: LobbyStatus,
    connections: Record<string, unknown>,
    locals: PublicLobbyLocals,
}

export function serializePublicLobby(lobby: PublicLobbyLike): PublicLobbyJSON{
    return {
        lobbyId: lobby.id,
        lobbyName: lobby.locals.lobbyName,
        mapLabel: lobby.locals.mapLabel,
        hostName: lobby.locals.hostName,
        playerCount: Object.keys(lobby.connections).length,
        maxPlayers: lobby.locals.maxPlayers,
        createdAt: lobby.locals.createdAt,
    }
}

export function getPublicLobbies(lobbies: Record<string, PublicLobbyLike>): PublicLobbyJSON[]{
    return Object.values(lobbies)
        .filter(lobby =>
            lobby.locals.isPublic === true &&
            lobby.status === LobbyStatus.ACTIVE &&
            Object.keys(lobby.connections).length < lobby.locals.maxPlayers
        )
        .map(serializePublicLobby)
        .sort((a, b) => a.createdAt - b.createdAt)
}
