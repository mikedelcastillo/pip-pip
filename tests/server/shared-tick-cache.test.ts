import { describe, expect, it, vi } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import * as packets from "@pip-pip/game/src/networking/packets"
import {
    buildSharedTickCache,
    getPartialGameState,
} from "@pip-pip/server/src/connection-out"

// A stub gameEvents whose filter() always returns no events. getPartialGameState
// reads game + gameEvents.filter(...) + connection.id; with an empty event pool
// the only packets it composes this tick are the per-tick broadcast (position /
// inputs / ping) plus the owner-only ownPlayerState, which is exactly the set the
// shared-cache optimization touches. A real EventCollector with nothing emitted
// would behave the same, but the stub keeps the test independent of event wiring.
const emptyGameEvents = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    filter: () => [] as any,
}

// Minimal ConnectionContext for a given recipient id. getPartialGameState only
// reaches connection.id, game and gameEvents off the context, so the rest is
// unused here and cast through.
function contextFor(game: PipPipGame, connectionId: string){
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { connection: { id: connectionId }, game, gameEvents: emptyGameEvents } as any
}

// Build a MATCH-phase game with several players (a mix of real + bot ids) at
// distinct positions/velocities so each player's playerPosition/playerInputs
// bytes differ from the others. tickNumber is set to a multiple of
// (tps - PING_REFRESH) so the per-tick ping broadcast branch is also exercised.
function buildMatchGame(){
    const game = new PipPipGame({ triggerSpawns: true })
    const ids = ["AA", "BB", "CC", "~0", "~1"]
    for(const id of ids){
        game.createPlayer(id)
    }
    // Drive distinct physics + input state per player so the encoded bytes are
    // not all identical (a real difference to detect any cross-wiring of cache
    // entries).
    let i = 0
    for(const player of Object.values(game.players)){
        i += 1
        player.ship.physics.position.x = 100 * i
        player.ship.physics.position.y = -50 * i
        player.ship.physics.velocity.x = 1.5 * i
        player.ship.physics.velocity.y = -0.25 * i
        player.inputs.movementAngle = 0.1 * i
        player.inputs.movementAmount = 0.2 * i
        player.inputs.aimRotation = 0.3 * i
        player.inputSeq = i
        player.lastProcessedInputSeq = i
        player.ping = 10 * i
        player.spawned = true
    }
    game.setPhase(PipPipGamePhase.MATCH)
    // Multiple of (tps - PING_REFRESH) so the per-tick ping broadcast fires.
    game.tickNumber = (game.tps - 2) * 3
    return { game, ids }
}

describe("buildSharedTickCache equivalence (shared per-tick broadcast encode)", () => {
    it("produces byte-identical output to re-encoding per connection (OLD path)", () => {
        const { game, ids } = buildMatchGame()
        const sharedCache = buildSharedTickCache(game)

        for(const id of ids){
            // NEW path: reuse the per-tick shared cache.
            const withCache = getPartialGameState(contextFor(game, id), sharedCache)
            // OLD path (reference): no cache, so every player's position/inputs/
            // ping are re-encoded inline per connection, exactly as before.
            const withoutCache = getPartialGameState(contextFor(game, id))

            // Flatten both to the raw wire bytes the connection would send and
            // assert byte-for-byte equality.
            expect(new Uint8Array(withCache.flat())).toEqual(new Uint8Array(withoutCache.flat()))
        }
    })

    it("never includes the recipient's own playerPosition/playerInputs in the shared loop", () => {
        const { game } = buildMatchGame()
        const sharedCache = buildSharedTickCache(game)

        // Encode the recipient's own (shared-cache) playerPosition + playerInputs
        // bytes; they must NOT appear inside the OTHER-players broadcast slice of
        // its own outgoing message (self-exclusion). The recipient's own state is
        // carried only by the owner-only ownPlayerState.
        const recipientId = "AA"
        const ownPosition = packets.encode.playerPosition(game.players[recipientId])
        const ownInputs = packets.encode.playerInputs(game.players[recipientId])

        const message = getPartialGameState(contextFor(game, recipientId), sharedCache).flat()

        // The owner-only ownPlayerState packet IS present (per-connection packet
        // still composed per recipient).
        const ownState = packets.encode.ownPlayerState(game.players[recipientId])
        expect(containsSubsequence(message, ownState)).toBe(true)

        // But the recipient's own playerPosition / playerInputs are NOT broadcast
        // back to itself.
        expect(containsSubsequence(message, ownPosition)).toBe(false)
        expect(containsSubsequence(message, ownInputs)).toBe(false)

        // Every OTHER player's position + inputs ARE present.
        for(const player of Object.values(game.players)){
            if(player.id === recipientId) continue
            expect(containsSubsequence(message, packets.encode.playerPosition(player))).toBe(true)
            expect(containsSubsequence(message, packets.encode.playerInputs(player))).toBe(true)
        }
    })

    it("drops per-tick encode calls from O(N*M) to O(M)", () => {
        const { game, ids } = buildMatchGame()
        const N = ids.length // recipients
        const M = ids.length // players

        // OLD behavior: one getPartialGameState per recipient, no shared cache.
        // Each call re-encodes (M-1) playerPosition + (M-1) playerInputs (self
        // excluded) and M playerPing, so totals scale with N*M.
        const oldPosSpy = vi.spyOn(packets.encode, "playerPosition")
        const oldInputsSpy = vi.spyOn(packets.encode, "playerInputs")
        const oldPingSpy = vi.spyOn(packets.encode, "playerPing")
        for(const id of ids){
            getPartialGameState(contextFor(game, id))
        }
        const oldPos = oldPosSpy.mock.calls.length
        const oldInputs = oldInputsSpy.mock.calls.length
        const oldPing = oldPingSpy.mock.calls.length
        oldPosSpy.mockRestore()
        oldInputsSpy.mockRestore()
        oldPingSpy.mockRestore()

        expect(oldPos).toBe(N * (M - 1))
        expect(oldInputs).toBe(N * (M - 1))
        expect(oldPing).toBe(N * M)

        // NEW behavior: build the shared cache ONCE (M encodes each of position /
        // inputs / ping), then the per-recipient composition reuses cached bytes
        // and performs ZERO further position/inputs/ping encodes.
        const newPosSpy = vi.spyOn(packets.encode, "playerPosition")
        const newInputsSpy = vi.spyOn(packets.encode, "playerInputs")
        const newPingSpy = vi.spyOn(packets.encode, "playerPing")
        const sharedCache = buildSharedTickCache(game)
        for(const id of ids){
            getPartialGameState(contextFor(game, id), sharedCache)
        }
        const newPos = newPosSpy.mock.calls.length
        const newInputs = newInputsSpy.mock.calls.length
        const newPing = newPingSpy.mock.calls.length
        newPosSpy.mockRestore()
        newInputsSpy.mockRestore()
        newPingSpy.mockRestore()

        // Exactly M encodes total (all in buildSharedTickCache), independent of N.
        expect(newPos).toBe(M)
        expect(newInputs).toBe(M)
        expect(newPing).toBe(M)
    })
})

// True iff `needle` appears as a contiguous run inside `haystack`. Used to assert
// a specific encoded packet's bytes are (or are not) present in a flattened
// outgoing message. Each packet starts with its unique id byte, so a contiguous
// match is an unambiguous presence check here.
function containsSubsequence(haystack: number[], needle: number[]): boolean{
    if(needle.length === 0) return true
    for(let i = 0; i + needle.length <= haystack.length; i++){
        let match = true
        for(let j = 0; j < needle.length; j++){
            if(haystack[i + j] !== needle[j]){
                match = false
                break
            }
        }
        if(match) return true
    }
    return false
}
