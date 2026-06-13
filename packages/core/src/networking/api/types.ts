import { ConnectionStatus } from "../connection"
import { LobbyStatus } from "../lobby"

export type ConnectionJSON = {
    connectionId: string,
    connectionToken?: string,
    websocketToken?: string,
    lobbyId?: string,
    status: ConnectionStatus,
}

export type LobbyJSON = {
    lobbyId: string,
    lobbyType: string,
    connections: number,
    maxConnections: number,
    status: LobbyStatus,
}

export type ConnectionLobbyJSON = {
    lobby: LobbyJSON,
    connection: ConnectionJSON,
}

export type PublicLobbyJSON = {
    lobbyId: string,
    lobbyName: string,
    mapLabel: string,
    hostName: string,
    playerCount: number,
    maxPlayers: number,
    createdAt: number,
}