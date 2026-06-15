import type { Client } from "@pip-pip/core/src/networking/client"
import type { PacketManagerSerializerMap } from "@pip-pip/core/src/networking/packets/manager"

// Enter (or re-enter) a lobby, opening the realtime websocket ONLY AFTER the
// connection has been moved into the target lobby on the server.
//
// Why the order is load-bearing - this is the fix for "hosting drops you into an
// existing game". Hosting reuses the existing connection. If you hosted before
// and left without reloading, leaving only closed the socket; it never left the
// lobby, so the connection still belongs to your PREVIOUS lobby server-side. The
// server sends a FULL game-state snapshot to a connection the instant its socket
// (re)connects - reconnecting un-idles the player, which triggers
// getFullGameState (see packages/server/src/connection-out.ts). So if we opened
// the socket FIRST, that snapshot would be the OLD lobby's (its players, phase
// and map), and it would be applied to the fresh game world - dropping the host
// into the existing game before joinLobby could move them.
//
// joinLobby is a plain HTTP call that needs only the connection token, not the
// socket, so we can move the connection into the target lobby BEFORE connecting.
// Then the only snapshot we ever receive is the target lobby's. requestConnection
// runs first so the HTTP join is authorized on a brand-new connection too.
export async function enterLobby<T extends PacketManagerSerializerMap>(
    client: Client<T>,
    id: string,
): Promise<void> {
    // 1. Make sure we hold a connection + token (no-op when we already do).
    await client.requestConnectionIfNeeded()
    // 2. Move the connection into the target lobby on the server FIRST.
    await client.joinLobby(id)
    // 3. Only now open the realtime socket; the server syncs the TARGET lobby.
    await client.connect()
}
