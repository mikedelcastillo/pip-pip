import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import * as packets from "@pip-pip/game/src/networking/packets"
import { getPartialGameState } from "@pip-pip/server/src/connection-out"

function containsSubsequence(haystack: number[], needle: number[]): boolean{
    if(needle.length === 0) return true
    for(let i = 0; i + needle.length <= haystack.length; i++){
        let match = true
        for(let j = 0; j < needle.length; j++){
            if(haystack[i + j] !== needle[j]){ match = false; break }
        }
        if(match) return true
    }
    return false
}

// A gameEvents stub that surfaces exactly one buffPickup event (no others).
// encode.buffPickup only reads buff.id, so a minimal stub buff suffices.
function eventsWithPickup(buff: unknown, player: unknown){
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        filter: (name: string) => (name === "buffPickup" ? [{ buffPickup: { buff, player } }] : []) as any,
    }
}

function contextFor(game: PipPipGame, connectionId: string, gameEvents: unknown){
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { connection: { id: connectionId }, game, gameEvents } as any
}

// Regression: a timed-buff pickup applies ship.timings.* server-side, but the
// broadcast only tracked shipCapacities, never shipTimings - so the picker's buff
// (haste etc.) was never networked. The picker rubber-banded (its prediction read
// timings.haste = 0 against a 1.5x server), and no client saw the buff visual or
// the buff-feed countdown until the picker next reloaded or respawned.
describe("buff pickup broadcasts the picker's ship timings", () => {
    it("includes the picker's playerShipTimings packet in the broadcast", () => {
        const game = new PipPipGame({ triggerSpawns: true })
        const picker = game.createPlayer("AA")
        game.createPlayer("BB") // a remote recipient
        for(const player of Object.values(game.players)) player.spawned = true
        game.setPhase(PipPipGamePhase.MATCH)

        // The buff applyBuffEffect set on the picker at pickup time.
        picker.ship.timings.haste = 200

        const buff = { id: "p1" }
        // Broadcast to a DIFFERENT recipient (BB): it must learn AA's new timings.
        const message = getPartialGameState(contextFor(game, "BB", eventsWithPickup(buff, picker))).flat()

        expect(containsSubsequence(message, packets.encode.playerShipTimings(picker))).toBe(true)
    })
})
