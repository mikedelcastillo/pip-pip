import { describe, expect, it } from "vitest"
import {
    PipPipGame,
    PipPipGameMode,
    PipPipGamePhase,
    BotDifficultyChoice,
    MAX_BOTS,
    TDM_TEAMS,
} from "@pip-pip/game/src/logic"
import {
    BotDifficulty,
    makeBotSkill,
    computeBotInputs,
    BOT_FIRE_RANGE,
    BOT_FIRE_AIM_TOLERANCE,
} from "@pip-pip/game/src/logic/ai"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import { radianDifference } from "@pip-pip/core/src/math"

// A deterministic rng that walks a fixed list of [0, 1) values, wrapping around.
// Injecting it keeps every "random" path (skill variance, mixed difficulty,
// per-tick aim error) reproducible so the tests assert exact behaviour.
function seqRng(values: number[]){
    let i = 0
    return () => {
        const v = values[i % values.length]
        i++
        return v
    }
}

describe("makeBotSkill (pure factory)", () => {
    it("scales base values by difficulty: HARD is more accurate + longer range than EASY", () => {
        // rng() === 0.5 makes the variance factor exactly 1, so we read the pure
        // base numbers for each difficulty (no per-bot jitter).
        const noVariance = () => 0.5
        const easy = makeBotSkill(BotDifficulty.EASY, noVariance)
        const medium = makeBotSkill(BotDifficulty.MEDIUM, noVariance)
        const hard = makeBotSkill(BotDifficulty.HARD, noVariance)

        // Accuracy: HARD jitters the least, EASY the most.
        expect(hard.aimJitter).toBeLessThan(medium.aimJitter)
        expect(medium.aimJitter).toBeLessThan(easy.aimJitter)

        // Aggression / reach: HARD opens fire from farther than EASY.
        expect(hard.fireRange).toBeGreaterThan(medium.fireRange)
        expect(medium.fireRange).toBeGreaterThan(easy.fireRange)

        // MEDIUM sits on the existing shared constants (no variance applied).
        expect(medium.fireRange).toBeCloseTo(BOT_FIRE_RANGE, 5)
        expect(medium.fireAimTolerance).toBeCloseTo(BOT_FIRE_AIM_TOLERANCE, 5)
    })

    it("applies per-bot variance so two same-difficulty bots differ, but within +/-20%", () => {
        const base = makeBotSkill(BotDifficulty.MEDIUM, () => 0.5) // variance factor 1

        // rng() === 1 -> factor 1.2 (the +20% edge); rng() === 0 -> factor 0.8.
        const high = makeBotSkill(BotDifficulty.MEDIUM, () => 1)
        const low = makeBotSkill(BotDifficulty.MEDIUM, () => 0)

        // The two varied bots differ from each other...
        expect(high.fireRange).not.toBeCloseTo(low.fireRange, 5)
        // ...and each field stays inside the +/-20% band around the base.
        expect(high.fireRange).toBeCloseTo(base.fireRange * 1.2, 5)
        expect(low.fireRange).toBeCloseTo(base.fireRange * 0.8, 5)
        expect(high.aimJitter).toBeCloseTo(base.aimJitter * 1.2, 5)
        expect(low.aimJitter).toBeCloseTo(base.aimJitter * 0.8, 5)
    })
})

describe("computeBotInputs honours bot.skill + aimNoise", () => {
    function makeArena(){
        const game = new PipPipGame({ shootPlayerBullets: true, triggerDamage: true, calculateAi: true })
        for(const seg of game.map.segWalls) game.physics.removeSegWall(seg)
        for(const rect of game.map.rectWalls) game.physics.removeRectWall(rect)
        game.map.bounds.min.x = -100000
        game.map.bounds.min.y = -100000
        game.map.bounds.max.x = 100000
        game.map.bounds.max.y = 100000
        game.setPhase(PipPipGamePhase.MATCH)
        return game
    }

    it("uses the bot's own fireRange: a short-range EASY bot holds fire where a default bot would shoot", () => {
        const game = makeArena()
        const bot = game.addBot(BotDifficulty.EASY, () => 0) // factor 0.8 -> shortest EASY range
        const enemy = game.createPlayer("AA")

        // Place the enemy between the EASY bot's (short) fire range and the default
        // BOT_FIRE_RANGE, straight along +x, with the bot pre-aimed so only RANGE
        // gates the shot.
        const distance = bot.skill!.fireRange + 50
        expect(distance).toBeLessThan(BOT_FIRE_RANGE)
        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(enemy, distance, 0)
        bot.ship.rotation = 0

        const found = { target: enemy, distance, angle: 0 }
        // No aim noise here so the aim is exact; the bot is in tolerance but out of
        // its OWN range, so it does not fire (a default-range bot would).
        const inputs = computeBotInputs(bot, found, 0)
        expect(inputs.useWeapon).toBe(false)
    })

    it("adds aimNoise to the aim rotation", () => {
        const game = makeArena()
        const bot = game.addBot(BotDifficulty.MEDIUM, () => 0.5)
        const enemy = game.createPlayer("AA")
        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(enemy, 300, 0)
        bot.ship.rotation = 0

        const found = { target: enemy, distance: 300, angle: 0 }
        const noise = 0.2
        const inputs = computeBotInputs(bot, found, noise)
        // The aim is the true angle (0) plus the injected noise.
        expect(Math.abs(radianDifference(inputs.aimRotation, noise))).toBeLessThan(1e-6)
    })

    it("a plain bot (no skill) still uses the BOT_* constant fallbacks", () => {
        const game = makeArena()
        // A bare PipPlayer marked as a bot, with NO skill profile, mirrors the
        // existing pure ai tests.
        const bot = new PipPlayer(game, "ZZ")
        bot.isBot = true
        const enemy = game.createPlayer("AA")
        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(enemy, 300, 0)
        bot.ship.rotation = 0

        const found = { target: enemy, distance: 300, angle: 0 }
        const inputs = computeBotInputs(bot, found)
        // 300 < BOT_FIRE_RANGE and aimed dead-on, so the fallback fires.
        expect(inputs.useWeapon).toBe(true)
    })
})

describe("addBots / removeBots / fillBots", () => {
    it("addBots assigns the chosen difficulty and a skill to each bot", () => {
        const game = new PipPipGame()
        const bots = game.addBots(3, BotDifficulty.HARD)
        expect(bots.length).toBe(3)
        for(const bot of bots){
            expect(bot.difficulty).toBe(BotDifficulty.HARD)
            expect(typeof bot.skill).not.toBe("undefined")
        }
    })

    it("reflects each bot's difficulty in its display name", () => {
        const game = new PipPipGame()
        const [hard] = game.addBots(1, BotDifficulty.HARD)
        const [easy] = game.addBots(1, BotDifficulty.EASY)
        // The tag is short so the full name stays within the name limits.
        expect(hard.name).toContain("-H-")
        expect(easy.name).toContain("-E-")
        expect(hard.name.length).toBeLessThanOrEqual(16)
    })

    it("'mixed' yields a spread of difficulties", () => {
        const game = new PipPipGame()
        // Drive resolveBotDifficulty deterministically: 0.0 -> EASY, 0.4 -> MEDIUM,
        // 0.9 -> HARD (Math.floor(rng()*3)). Each bot consumes 7 draws: 1 to pick
        // the difficulty, then 6 for makeBotSkill's varied fields, so the pick
        // values land at indices 0, 7 and 14.
        const rng = seqRng([
            0.0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
            0.4, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
            0.9, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
        ])
        const bots = game.addBots(3, "mixed", rng)
        const difficulties = bots.map(b => b.difficulty)
        expect(difficulties).toContain(BotDifficulty.EASY)
        expect(difficulties).toContain(BotDifficulty.MEDIUM)
        expect(difficulties).toContain(BotDifficulty.HARD)
    })

    it("respects the MAX_BOTS ceiling", () => {
        const game = new PipPipGame()
        game.addBots(MAX_BOTS + 5, BotDifficulty.MEDIUM)
        expect(game.botCount).toBe(MAX_BOTS)
        // A further add does nothing once full.
        const more = game.addBots(3, BotDifficulty.MEDIUM)
        expect(more.length).toBe(0)
        expect(game.botCount).toBe(MAX_BOTS)
    })

    it("removeBots removes the newest bots first", () => {
        const game = new PipPipGame()
        const a = game.addBot(BotDifficulty.EASY)
        const b = game.addBot(BotDifficulty.MEDIUM)
        const c = game.addBot(BotDifficulty.HARD)

        const removed = game.removeBots(2)
        expect(removed).toBe(2)
        // The two NEWEST (b and c) are gone; the oldest (a) survives.
        expect(a.id in game.players).toBe(true)
        expect(b.id in game.players).toBe(false)
        expect(c.id in game.players).toBe(false)
        expect(game.botCount).toBe(1)
    })

    it("clearBots removes every bot but no real players", () => {
        const game = new PipPipGame()
        const human = game.createPlayer("AA")
        game.addBots(4, BotDifficulty.MEDIUM)
        const removed = game.clearBots()
        expect(removed).toBe(4)
        expect(game.botCount).toBe(0)
        expect(human.id in game.players).toBe(true)
    })
})

describe("fillBots in TEAM_DEATHMATCH", () => {
    function makeTeamGame(){
        return new PipPipGame({ setScores: true, triggerPhases: true, triggerSpawns: true })
    }

    it("fills the lobby and the bots split into balanced teams at match start", () => {
        const game = makeTeamGame()
        game.setSettings({ mode: PipPipGameMode.TEAM_DEATHMATCH, useTeams: true, friendlyFire: false, maxKills: 25 })
        new PipPlayer(game, "AA")
        new PipPlayer(game, "BB")

        const added: BotDifficultyChoice = BotDifficulty.MEDIUM
        const bots = game.fillBots(added)
        expect(bots.length).toBeGreaterThan(0)
        // Filled toward a full lobby but never past MAX_BOTS.
        expect(game.botCount).toBeLessThanOrEqual(MAX_BOTS)

        // Once the match starts, assignTeams splits everyone (humans + bots) into
        // two balanced teams differing by at most one.
        game.startMatch()
        const team0 = game.teamPlayers(0).length
        const team1 = game.teamPlayers(1).length
        expect(team0 + team1).toBe(game.playerCount)
        expect(Math.abs(team0 - team1)).toBeLessThanOrEqual(1)
        // Every bot landed on a real team.
        for(const bot of game.bots){
            expect(TDM_TEAMS).toContain(bot.team)
        }
    })

    it("a bot added mid-match lands on the smaller team", () => {
        const game = makeTeamGame()
        game.setSettings({ mode: PipPipGameMode.TEAM_DEATHMATCH, useTeams: true, friendlyFire: false, maxKills: 25 })
        new PipPlayer(game, "AA")
        new PipPlayer(game, "BB")
        game.startMatch()
        game.setPhase(PipPipGamePhase.MATCH)

        // Force both existing players onto team 0 so team 1 is unambiguously smaller.
        for(const player of Object.values(game.players)) player.setTeam(0)
        const [bot] = game.addBots(1, BotDifficulty.MEDIUM)
        expect(bot.team).toBe(1)
    })
})
