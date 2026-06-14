import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"

// The server constructs the game with assignHost so the host slot is managed.
// Use the same flag here to exercise the real host hand-off path.
function makeHostGame(){
    return new PipPipGame({ assignHost: true })
}

// Anti-farm behaviour is gated on the authoritative spawn/damage flags the
// server uses. shootPlayerBullets is irrelevant here (we call dealDamage and
// update directly), so only the gates under test are enabled.
function makeMatchGame(){
    return new PipPipGame({ triggerSpawns: true, triggerDamage: true })
}

describe("host hand-off", () => {
    it("makes the first player in an empty lobby the host", () => {
        const game = makeHostGame()
        expect(game.host).toBeUndefined()

        const first = new PipPlayer(game, "AA")

        expect(game.host).toBe(first)
    })

    it("reassigns the host to an active player when the host goes idle", () => {
        const game = makeHostGame()
        const host = new PipPlayer(game, "AA")
        const other = new PipPlayer(game, "BB")
        expect(game.host).toBe(host)

        host.setIdle(true)
        // setIdle does not recompute the host on its own; the per-tick check in
        // update() is what hands it off.
        game.update()

        expect(game.host).toBe(other)
    })

    it("reassigns the host to a remaining player when the host is removed", () => {
        const game = makeHostGame()
        const host = new PipPlayer(game, "AA")
        const other = new PipPlayer(game, "BB")
        expect(game.host).toBe(host)

        host.remove()

        expect(game.host).toBe(other)
    })

    it("does not pick a bot as host over an active human", () => {
        const game = makeHostGame()
        const bot = game.addBot()
        const human = new PipPlayer(game, "AA")
        expect(game.isHostEligible(bot)).toBe(false)

        // Host should be the human, never the bot, regardless of join order.
        expect(game.host).toBe(human)

        human.setIdle(true)
        game.update()

        // No eligible human left (only the idle human and the bot) — host clears
        // rather than falling onto the bot.
        expect(game.host).toBeUndefined()
    })

    it("keeps the current host while it is still active", () => {
        const game = makeHostGame()
        const host = new PipPlayer(game, "AA")
        new PipPlayer(game, "BB")
        expect(game.host).toBe(host)

        let setHostEvents = 0
        game.events.on("setHost", () => { setHostEvents++ })
        game.update()

        expect(game.host).toBe(host)
        expect(setHostEvents).toBe(0)
    })

    it("clears the host when the last player leaves", () => {
        const game = makeHostGame()
        const host = new PipPlayer(game, "AA")
        expect(game.host).toBe(host)

        host.remove()

        expect(game.host).toBeUndefined()
    })
})

describe("anti-farm on disconnect", () => {
    it("despawns an idle real player during MATCH", () => {
        const game = makeMatchGame()
        const player = new PipPlayer(game, "AA")
        game.setPhase(PipPipGamePhase.MATCH)
        game.spawnPlayer(player, 0, 0)
        expect(player.spawned).toBe(true)

        player.setIdle(true)
        game.update()

        expect(player.spawned).toBe(false)
    })

    it("keeps a bot spawned during MATCH (bots stay farmable)", () => {
        const game = makeMatchGame()
        const bot = game.addBot()
        game.setPhase(PipPipGamePhase.MATCH)
        game.spawnPlayer(bot, 0, 0)
        expect(bot.spawned).toBe(true)

        game.update()

        expect(bot.spawned).toBe(true)
    })

    it("awards no damage or kill credit for a hit against an idle real player", () => {
        const game = makeMatchGame()
        const dealer = new PipPlayer(game, "AA")
        const target = new PipPlayer(game, "BB")
        target.setIdle(true)

        const healthBefore = target.ship.capacities.health
        let dealtEvents = 0
        let killEvents = 0
        game.events.on("dealDamage", () => { dealtEvents++ })
        game.events.on("playerKill", () => { killEvents++ })

        // Drain the idle target's health straight through dealDamage.
        for(let i = 0; i < 100; i++){
            game.dealDamage(dealer, target, 1000)
        }

        expect(target.ship.capacities.health).toBe(healthBefore)
        expect(dealer.score.damage).toBe(0)
        expect(dealer.score.kills).toBe(0)
        expect(target.score.deaths).toBe(0)
        expect(dealtEvents).toBe(0)
        expect(killEvents).toBe(0)
    })

    it("still awards damage against a bot target (training stays farmable)", () => {
        const game = makeMatchGame()
        const dealer = new PipPlayer(game, "AA")
        const bot = game.addBot()
        // A bot is never idle, but assert it explicitly to pin the contrast.
        expect(bot.idle).toBe(false)

        game.dealDamage(dealer, bot, 5)

        expect(dealer.score.damage).toBeGreaterThan(0)
    })
})
