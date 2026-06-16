import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import {
    BOT_BUFF_GRAB_RANGE,
    BOT_BUFF_SEEK_RANGE,
    BotNavContext,
    chooseBotGoal,
    computeBotInputs,
    findNearestEnemy,
    updateBotInputs,
} from "@pip-pip/game/src/logic/bot"
import { buildNavGrid } from "@pip-pip/game/src/logic/pathfinding"
import { Vector2 } from "@pip-pip/core/src/physics"
import { radianDifference } from "@pip-pip/core/src/math"

// Ship index 3 ("Blu") uses pure default stats, so its numbers are predictable.
const BLU = 3

// A clean, wall-free, very large arena so bots move and bullets fly unobstructed.
// Matches the setup used by ai-bots.test.ts / buffs.test.ts.
function makeArena(){
    const game = new PipPipGame({
        shootPlayerBullets: true,
        triggerDamage: true,
        calculateAi: true,
    })

    for(const seg of game.map.segWalls) game.physics.removeSegWall(seg)
    for(const rect of game.map.rectWalls) game.physics.removeRectWall(rect)
    game.map.bounds.min.x = -100000
    game.map.bounds.min.y = -100000
    game.map.bounds.max.x = 100000
    game.map.bounds.max.y = 100000

    game.setPhase(PipPipGamePhase.MATCH)

    return game
}

describe("chooseBotGoal (pure)", () => {
    it("picks a CLOSE health buff when the bot is hurt", () => {
        const game = makeArena()
        const bot = game.addBot()
        bot.setShip(BLU)
        const enemy = game.createPlayer("AA")
        enemy.setShip(BLU)

        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(enemy, 300, 0)

        // Hurt the bot so a heal is worth wanting.
        bot.ship.capacities.health = 1

        // A health pickup close by, well inside the seek range.
        const buff = game.buffs.new({
            position: new Vector2(100, 0),
            type: "health",
        })

        const found = findNearestEnemy(bot, Object.values(game.players))
        const goal = chooseBotGoal(bot, found, game.buffs.getActive())

        expect(goal.kind).toBe("buff")
        if(goal.kind === "buff"){
            expect(goal.buff).toBe(buff)
            // The angle points straight at the pickup (+x === 0).
            expect(Math.abs(radianDifference(goal.angle, 0))).toBeLessThan(0.01)
        }
    })

    it("does NOT want a health buff when the bot is healthy", () => {
        const game = makeArena()
        const bot = game.addBot()
        bot.setShip(BLU)
        const enemy = game.createPlayer("AA")
        enemy.setShip(BLU)

        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(enemy, 300, 0)

        // Full health -> a heal is wasted, so the bot stays on the enemy.
        bot.ship.capacities.health = bot.ship.maxHealth

        game.buffs.new({ position: new Vector2(100, 0), type: "health" })

        const found = findNearestEnemy(bot, Object.values(game.players))
        const goal = chooseBotGoal(bot, found, game.buffs.getActive())
        expect(goal.kind).toBe("enemy")
    })

    it("IGNORES a far buff and falls back to the enemy", () => {
        const game = makeArena()
        const bot = game.addBot()
        bot.setShip(BLU)
        const enemy = game.createPlayer("AA")
        enemy.setShip(BLU)

        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(enemy, 300, 0)
        bot.ship.capacities.health = 1

        // A health pickup well BEYOND the seek range: even though the bot is hurt,
        // it is not worth the trek, so the goal stays on the enemy.
        game.buffs.new({
            position: new Vector2(BOT_BUFF_SEEK_RANGE + 500, 0),
            type: "health",
        })

        const found = findNearestEnemy(bot, Object.values(game.players))
        const goal = chooseBotGoal(bot, found, game.buffs.getActive())
        expect(goal.kind).toBe("enemy")
    })

    it("grabs a CLOSE buff/ammo pickup opportunistically (no health needed)", () => {
        const game = makeArena()
        const bot = game.addBot()
        bot.setShip(BLU)
        const enemy = game.createPlayer("AA")
        enemy.setShip(BLU)

        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(enemy, 300, 0)
        // Full health: a buff is still worth grabbing when it is right there.
        bot.ship.capacities.health = bot.ship.maxHealth

        const buff = game.buffs.new({
            position: new Vector2(BOT_BUFF_GRAB_RANGE - 50, 0),
            type: "haste",
        })

        const found = findNearestEnemy(bot, Object.values(game.players))
        const goal = chooseBotGoal(bot, found, game.buffs.getActive())
        expect(goal.kind).toBe("buff")
        if(goal.kind === "buff") expect(goal.buff).toBe(buff)
    })

    it("does NOT chase a buff/ammo pickup that is beyond the short grab range", () => {
        const game = makeArena()
        const bot = game.addBot()
        bot.setShip(BLU)
        const enemy = game.createPlayer("AA")
        enemy.setShip(BLU)

        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(enemy, 300, 0)
        bot.ship.capacities.health = bot.ship.maxHealth

        // A buff just past the grab range: an ammo/buff is only an opportunistic
        // scoop, so the bot stays on the enemy here.
        game.buffs.new({
            position: new Vector2(BOT_BUFF_GRAB_RANGE + 100, 0),
            type: "ammo",
        })

        const found = findNearestEnemy(bot, Object.values(game.players))
        const goal = chooseBotGoal(bot, found, game.buffs.getActive())
        expect(goal.kind).toBe("enemy")
    })

    it("picks the NEAREST worthwhile buff among several", () => {
        const game = makeArena()
        const bot = game.addBot()
        bot.setShip(BLU)

        game.spawnPlayer(bot, 0, 0)
        bot.ship.capacities.health = bot.ship.maxHealth

        const near = game.buffs.new({ position: new Vector2(80, 0), type: "haste" })
        game.buffs.new({ position: new Vector2(0, 200), type: "shield" })

        const found = findNearestEnemy(bot, Object.values(game.players))
        const goal = chooseBotGoal(bot, found, game.buffs.getActive())
        expect(goal.kind).toBe("buff")
        if(goal.kind === "buff") expect(goal.buff).toBe(near)
    })
})

describe("bot buff-seeking movement (brain -> inputs)", () => {
    it("MOVES toward a worthwhile buff while AIMING at the enemy", () => {
        const game = makeArena()
        const bot = game.addBot()
        bot.setShip(BLU)
        const enemy = game.createPlayer("AA")
        enemy.setShip(BLU)

        game.spawnPlayer(bot, 0, 0)
        // Enemy along +x so its angle is 0; the bot should AIM there.
        game.spawnPlayer(enemy, 300, 0)
        bot.ship.rotation = 0
        // Hurt so the health pickup is wanted.
        bot.ship.capacities.health = 1

        // Health pickup straight UP (+y), well inside seek range: the bot should
        // MOVE up toward it (movementAngle ~ PI/2) while AIMING at the enemy (~0).
        game.buffs.new({ position: new Vector2(0, 200), type: "health" })

        const found = findNearestEnemy(bot, Object.values(game.players))
        const goal = chooseBotGoal(bot, found, game.buffs.getActive())
        expect(goal.kind).toBe("buff")

        const inputs = computeBotInputs(bot, found, 0, undefined, undefined, goal)

        // Movement points at the buff (+y === PI/2).
        expect(Math.abs(radianDifference(inputs.movementAngle, Math.PI / 2))).toBeLessThan(0.01)
        expect(inputs.movementAmount).toBeGreaterThan(0)
        // Aim still tracks the enemy straight across (+x === 0).
        expect(Math.abs(radianDifference(inputs.aimRotation, 0))).toBeLessThan(0.01)
        // Enemy is in range and the bot is aimed at it, so it still fires.
        expect(inputs.useWeapon).toBe(true)
    })

    it("end-to-end updateBotInputs steers toward the buff, aims at the enemy", () => {
        const game = makeArena()
        const bot = game.addBot()
        bot.setShip(BLU)
        const enemy = game.createPlayer("AA")
        enemy.setShip(BLU)

        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(enemy, 300, 0)
        bot.ship.rotation = 0
        bot.ship.capacities.health = 1

        game.buffs.new({ position: new Vector2(0, 200), type: "health" })

        // A wall-free nav context so routing is a straight line to the buff.
        const bounds = { min: { x: -5000, y: -5000 }, max: { x: 5000, y: 5000 } }
        const nav: BotNavContext = {
            grid: buildNavGrid(bounds, [], []),
            rectWalls: [],
            segWalls: [],
            tick: 0,
        }

        updateBotInputs(bot, Object.values(game.players), Math.random, nav, game.buffs.getActive())

        // Steers UP toward the buff...
        expect(Math.abs(radianDifference(bot.inputs.movementAngle, Math.PI / 2))).toBeLessThan(0.01)
        expect(bot.inputs.movementAmount).toBeGreaterThan(0)
        // ...while AIM tracks the enemy across (+x === 0).
        expect(Math.abs(radianDifference(bot.inputs.aimRotation, 0))).toBeLessThan(0.2)
    })

    it("with no worthwhile buff behaves exactly as the enemy goal", () => {
        const game = makeArena()
        const bot = game.addBot()
        bot.setShip(BLU)
        const enemy = game.createPlayer("AA")
        enemy.setShip(BLU)

        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(enemy, 300, 0)
        bot.ship.rotation = 0
        bot.ship.capacities.health = bot.ship.maxHealth

        // A far health pickup that is NOT worth grabbing.
        game.buffs.new({
            position: new Vector2(0, BOT_BUFF_SEEK_RANGE + 1000),
            type: "health",
        })

        const found = findNearestEnemy(bot, Object.values(game.players))
        // The goal-aware call and the legacy (no-goal) call must agree exactly.
        const withBuffs = computeBotInputs(bot, found, 0, undefined, undefined, chooseBotGoal(bot, found, game.buffs.getActive()))
        const legacy = computeBotInputs(bot, found)

        expect(withBuffs.movementAngle).toBeCloseTo(legacy.movementAngle, 6)
        expect(withBuffs.movementAmount).toBeCloseTo(legacy.movementAmount, 6)
        expect(withBuffs.useWeapon).toBe(legacy.useWeapon)
    })
})
