import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"

// Ship index 3 ("Blu") uses pure default stats.
const BLU = 3

// Server-flavored game: triggerDamage owns all scoring, so this exercises the
// authoritative path exactly as the server runs it.
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

describe("kill / death credit is exactly one per death", () => {
    // Several hits overlapping the SAME target on ONE tick (a multi-pellet spread
    // fired point-blank, or two players' shots arriving together) must credit
    // exactly one kill + one death + one playerKill event. Before the dealDamage
    // dead-target guard, each extra hit re-ran the death block (damage clamped to
    // 0 but the health===0 kill guard stayed true), inflating both scores.
    it("credits a single kill and death when several lethal hits land after death", () => {
        const game = makeArena()
        const killer = makePlayer(game, "KK")
        const victim = makePlayer(game, "VV")
        game.spawnPlayer(killer, 0, 0)
        game.spawnPlayer(victim, 0, 0)

        let killEvents = 0
        game.events.on("playerKill", () => { killEvents += 1 })

        // Five overlapping pellets all land this tick: the first is lethal, the
        // rest hit a target that is already dead.
        for(let i = 0; i < 5; i++) game.dealDamage(killer, victim, 9999)

        expect(victim.score.deaths).toBe(1)
        expect(killer.score.kills).toBe(1)
        expect(killEvents).toBe(1)
        expect(victim.spawned).toBe(false)
    })

    // A second player's shot reaching an already-dead victim on the same tick must
    // NOT steal a kill or add a death.
    it("does not credit a second player who hits an already-dead victim", () => {
        const game = makeArena()
        const killer = makePlayer(game, "KK")
        const latecomer = makePlayer(game, "LL")
        const victim = makePlayer(game, "VV")
        game.spawnPlayer(killer, 0, 0)
        game.spawnPlayer(latecomer, 0, 0)
        game.spawnPlayer(victim, 0, 0)

        game.dealDamage(killer, victim, 9999)    // lethal blow
        game.dealDamage(latecomer, victim, 9999) // lands on a corpse

        expect(killer.score.kills).toBe(1)
        expect(latecomer.score.kills).toBe(0)
        expect(victim.score.deaths).toBe(1)
    })
})
