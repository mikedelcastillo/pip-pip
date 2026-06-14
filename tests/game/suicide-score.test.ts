import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"

// Ship index 3 ("Blu") uses pure default stats.
const BLU = 3

function makeArena(){
    const game = new PipPipGame({ triggerDamage: true })
    game.setPhase(PipPipGamePhase.MATCH)
    return game
}

// A suicide (dying to your own weapon, e.g. standing on your own grenade blast)
// must count as a DEATH ONLY: it must not pad the player's kills, their
// damage-dealt stat, or the kill feed (no playerKill event).
describe("suicide scoring", () => {
    it("counts a suicide as a death only - no kill, no damage-dealt, no kill event", () => {
        const game = makeArena()
        const player = new PipPlayer(game, "AA")
        player.setShip(BLU)
        game.spawnPlayer(player, 0, 0)

        let killEvents = 0
        game.events.on("playerKill", () => { killEvents += 1 })

        // Lethal self-damage: dealer === target.
        game.dealDamage(player, player, 9999)

        expect(player.score.deaths).toBe(1)
        expect(player.score.kills).toBe(0)
        expect(player.score.damage).toBe(0)
        expect(killEvents).toBe(0)
    })

    it("still credits a real kill by another player", () => {
        const game = makeArena()
        const killer = new PipPlayer(game, "AA")
        const victim = new PipPlayer(game, "BB")
        killer.setShip(BLU)
        victim.setShip(BLU)
        game.spawnPlayer(victim, 0, 0)

        let killEvents = 0
        game.events.on("playerKill", () => { killEvents += 1 })

        game.dealDamage(killer, victim, 9999)

        expect(victim.score.deaths).toBe(1)
        expect(killer.score.kills).toBe(1)
        expect(killer.score.damage).toBeGreaterThan(0)
        expect(killEvents).toBe(1)
    })

    it("non-lethal self-damage still hurts but adds no damage-dealt", () => {
        const game = makeArena()
        const player = new PipPlayer(game, "AA")
        player.setShip(BLU)
        game.spawnPlayer(player, 0, 0)
        const fullHealth = player.ship.capacities.health

        game.dealDamage(player, player, 3)

        expect(player.ship.capacities.health).toBeLessThan(fullHealth)
        expect(player.score.damage).toBe(0)
        expect(player.score.deaths).toBe(0)
    })
})
