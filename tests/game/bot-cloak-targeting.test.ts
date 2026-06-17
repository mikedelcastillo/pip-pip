import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import { findNearestEnemy } from "@pip-pip/game/src/logic/bot"

const BLU = 3

function makeArena(){
    const game = new PipPipGame({ triggerDamage: true })
    game.setPhase(PipPipGamePhase.MATCH)
    return game
}

function makePlayer(game: PipPipGame, id: string, team: number){
    const player = new PipPlayer(game, id)
    player.setShip(BLU)
    player.setTeam(team)
    return player
}

// A cloaked ship is invisible to bots: findNearestEnemy must skip any player whose
// ship has the invisibility (cloak) buff running, the same way it skips dead and
// teammate players, so a bot fights only the enemies it can actually "see".
describe("findNearestEnemy cloak-awareness", () => {
    it("skips a nearer cloaked enemy and targets the visible one", () => {
        const game = makeArena()
        const bot = makePlayer(game, "BB", -1)
        const cloaked = makePlayer(game, "CC", -1)   // NEAREST but cloaked
        const visible = makePlayer(game, "VV", -1)   // farther but visible
        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(cloaked, 100, 0)
        game.spawnPlayer(visible, 400, 0)

        cloaked.ship.timings.invisibility = 100
        expect(cloaked.ship.isInvisible).toBe(true)

        const found = findNearestEnemy(bot, Object.values(game.players), false)
        expect(found?.target).toBe(visible)
    })

    it("returns undefined when the only other spawned player is cloaked", () => {
        const game = makeArena()
        const bot = makePlayer(game, "BB", -1)
        const cloaked = makePlayer(game, "CC", -1)
        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(cloaked, 100, 0)

        cloaked.ship.timings.invisibility = 100

        const found = findNearestEnemy(bot, Object.values(game.players), false)
        expect(found).toBeUndefined()
    })

    it("targets a player again once its cloak has expired", () => {
        const game = makeArena()
        const bot = makePlayer(game, "BB", -1)
        const other = makePlayer(game, "OO", -1)
        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(other, 100, 0)

        other.ship.timings.invisibility = 100
        expect(findNearestEnemy(bot, Object.values(game.players), false)).toBeUndefined()

        other.ship.timings.invisibility = 0
        expect(findNearestEnemy(bot, Object.values(game.players), false)?.target).toBe(other)
    })
})
