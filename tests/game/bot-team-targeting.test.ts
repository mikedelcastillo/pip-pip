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

// Regression: findNearestEnemy ignored teams, so in TEAM_DEATHMATCH a bot locked
// onto / orbited / shot the nearest TEAMMATE (which deals no damage) instead of an
// actual enemy. With useTeams it must skip allies.
describe("findNearestEnemy team-awareness", () => {
    it("skips a nearer teammate and targets the enemy when teams are on", () => {
        const game = makeArena()
        const bot = makePlayer(game, "BB", 0)
        const ally = makePlayer(game, "AA", 0)   // same team, NEAREST
        const enemy = makePlayer(game, "EE", 1)  // other team, farther
        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(ally, 100, 0)
        game.spawnPlayer(enemy, 400, 0)

        const found = findNearestEnemy(bot, Object.values(game.players), true)
        expect(found?.target).toBe(enemy)
    })

    it("targets the nearest player regardless of team in FFA (useTeams false)", () => {
        const game = makeArena()
        const bot = makePlayer(game, "BB", -1)
        const near = makePlayer(game, "NN", -1)
        const far = makePlayer(game, "FF", -1)
        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(near, 100, 0)
        game.spawnPlayer(far, 400, 0)

        const found = findNearestEnemy(bot, Object.values(game.players), false)
        expect(found?.target).toBe(near)
    })

    it("returns undefined when the only other spawned players are teammates", () => {
        const game = makeArena()
        const bot = makePlayer(game, "BB", 0)
        const ally1 = makePlayer(game, "A1", 0)
        const ally2 = makePlayer(game, "A2", 0)
        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(ally1, 100, 0)
        game.spawnPlayer(ally2, 200, 0)

        const found = findNearestEnemy(bot, Object.values(game.players), true)
        expect(found).toBeUndefined()
    })
})
