import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer, ASSIST_WINDOW_TICKS } from "@pip-pip/game/src/logic/player"

// Ship index 3 ("Blu") uses pure default stats.
const BLU = 3

// Server-flavored game: triggerDamage owns all scoring (kills, damage, assists),
// so this exercises the authoritative path exactly as the server runs it.
function makeArena(){
    const game = new PipPipGame({ triggerDamage: true })
    game.setPhase(PipPipGamePhase.MATCH)
    return game
}

function makePlayer(game: PipPipGame, id: string){
    const player = new PipPlayer(game, id)
    player.setShip(BLU)
    return player
}

describe("assist scoring", () => {
    // A damaged B, then C killed B within the window: A earns the assist, C the
    // kill (and NO assist for the killer), B the death.
    it("credits an assist to a prior attacker when someone else gets the kill", () => {
        const game = makeArena()
        const a = makePlayer(game, "AA")
        const c = makePlayer(game, "CC")
        const b = makePlayer(game, "BB")
        game.spawnPlayer(a, 0, 0)
        game.spawnPlayer(c, 0, 0)
        game.spawnPlayer(b, 0, 0)

        // A chips B (non-lethal).
        game.dealDamage(a, b, 3)
        // A few ticks later, still well inside the window, C lands the kill.
        game.tickNumber += 5
        game.dealDamage(c, b, 9999)

        expect(a.score.assists).toBe(1)
        expect(c.score.kills).toBe(1)
        expect(c.score.assists).toBe(0)
        expect(b.score.deaths).toBe(1)
        // The killer is not the assister; A scored no kill.
        expect(a.score.kills).toBe(0)
    })

    // An attacker whose only hit landed OUTSIDE the window gets no assist.
    it("gives no assist for a hit older than the window", () => {
        const game = makeArena()
        const a = makePlayer(game, "AA")
        const c = makePlayer(game, "CC")
        const b = makePlayer(game, "BB")
        game.spawnPlayer(b, 0, 0)

        game.dealDamage(a, b, 3)
        // Push past the window boundary: window + 1 ticks later is too stale.
        game.tickNumber += ASSIST_WINDOW_TICKS + 1
        game.dealDamage(c, b, 9999)

        expect(a.score.assists).toBe(0)
        expect(c.score.kills).toBe(1)
        expect(b.score.deaths).toBe(1)
    })

    // A hit landed exactly ASSIST_WINDOW_TICKS before death still counts (the
    // window boundary is inclusive).
    it("credits an assist for a hit exactly on the window boundary", () => {
        const game = makeArena()
        const a = makePlayer(game, "AA")
        const c = makePlayer(game, "CC")
        const b = makePlayer(game, "BB")
        game.spawnPlayer(b, 0, 0)

        game.dealDamage(a, b, 3)
        game.tickNumber += ASSIST_WINDOW_TICKS
        game.dealDamage(c, b, 9999)

        expect(a.score.assists).toBe(1)
    })

    // Many hits from the same attacker still yield only ONE assist.
    it("credits at most one assist per kill no matter how many hits", () => {
        const game = makeArena()
        const a = makePlayer(game, "AA")
        const c = makePlayer(game, "CC")
        const b = makePlayer(game, "BB")
        game.spawnPlayer(b, 0, 0)

        game.dealDamage(a, b, 2)
        game.tickNumber += 1
        game.dealDamage(a, b, 2)
        game.tickNumber += 1
        game.dealDamage(a, b, 2)
        game.tickNumber += 1
        game.dealDamage(c, b, 9999)

        expect(a.score.assists).toBe(1)
        expect(c.score.kills).toBe(1)
    })

    // A SUICIDE (B kills self) credits nobody a kill OR an assist, even if A had
    // damaged B inside the window.
    it("credits no kill and no assist on a suicide", () => {
        const game = makeArena()
        const a = makePlayer(game, "AA")
        const b = makePlayer(game, "BB")
        game.spawnPlayer(b, 0, 0)

        // A chips B inside the window, then B dies to its OWN weapon.
        game.dealDamage(a, b, 3)
        game.tickNumber += 2
        game.dealDamage(b, b, 9999)

        expect(b.score.deaths).toBe(1)
        expect(b.score.kills).toBe(0)
        expect(b.score.assists).toBe(0)
        // The prior attacker earns NOTHING from a suicide.
        expect(a.score.assists).toBe(0)
        expect(a.score.kills).toBe(0)
    })

    // The killer never earns an assist for their own kill, even if they had also
    // chipped the victim earlier in the window.
    it("never gives the killer an assist for their own kill", () => {
        const game = makeArena()
        const c = makePlayer(game, "CC")
        const b = makePlayer(game, "BB")
        game.spawnPlayer(b, 0, 0)

        // C chips B, then C finishes B off.
        game.dealDamage(c, b, 3)
        game.tickNumber += 2
        game.dealDamage(c, b, 9999)

        expect(c.score.kills).toBe(1)
        expect(c.score.assists).toBe(0)
        expect(b.score.deaths).toBe(1)
    })

    // The victim's assist record is cleared on death, so an attacker from a
    // PREVIOUS life never carries an assist into a later kill.
    it("does not carry a stale attacker across the victim's death", () => {
        const game = makeArena()
        const a = makePlayer(game, "AA")
        const c = makePlayer(game, "CC")
        const b = makePlayer(game, "BB")
        game.spawnPlayer(b, 0, 0)

        // A chips B, then C kills B (A earns one assist).
        game.dealDamage(a, b, 3)
        game.tickNumber += 2
        game.dealDamage(c, b, 9999)
        expect(a.score.assists).toBe(1)

        // B respawns; C kills B again WITHOUT A touching B this life. A must not
        // gain a second assist from the stale record.
        game.spawnPlayer(b, 0, 0)
        b.timings.spawnTimeout = 0
        b.setSpawned(true)
        game.tickNumber += 2
        game.dealDamage(c, b, 9999)

        expect(a.score.assists).toBe(1)
        expect(c.score.kills).toBe(2)
    })
})
