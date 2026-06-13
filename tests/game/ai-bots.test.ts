import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import {
    BOT_FIRE_RANGE,
    computeBotInputs,
    findNearestEnemy,
} from "@pip-pip/game/src/logic/ai"
import { radianDifference } from "@pip-pip/core/src/math"

const BLU = 3
// Djibouti: the grenadier whose tactical weapon fires "grenade" bullets.
const DJIBOUTI = 5

// A clean, wall-free, very large arena so bots move and bullets fly
// unobstructed. Matches the setup used by weapons.test.ts.
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

describe("AI bot lifecycle", () => {
    it("adds a bot with a 2-char id, a ship, and the isBot flag", () => {
        const game = new PipPipGame()
        const bot = game.addBot()

        expect(bot.isBot).toBe(true)
        expect(bot.id.length).toBe(2)
        // The id is "~"-prefixed so it cannot collide with the alphanumeric
        // connection-id pool, yet still fits the $string(2) playerId wire field.
        expect(bot.id[0]).toBe("~")
        expect(bot.id in game.players).toBe(true)
        expect(typeof bot.ship).not.toBe("undefined")
    })

    it("addBots adds N distinct bots and clearBots removes only bots", () => {
        const game = new PipPipGame()
        const human = game.createPlayer("AA")

        const bots = game.addBots(3)
        expect(bots.length).toBe(3)
        const ids = new Set(bots.map(b => b.id))
        expect(ids.size).toBe(3) // unique ids
        expect(game.playerCount).toBe(4) // human + 3 bots

        const removed = game.clearBots()
        expect(removed).toBe(3)
        expect(game.playerCount).toBe(1)
        expect("AA" in game.players).toBe(true)
        expect(human.isBot).toBe(false)
    })

    it("spawns a bot added during a live match", () => {
        const game = makeArena()
        const bot = game.addBot()
        expect(bot.spawned).toBe(true)
    })
})

describe("AI brain targeting (pure)", () => {
    it("aims at a single enemy and fires when aimed and in range", () => {
        const game = makeArena()
        const bot = game.addBot()
        const enemy = game.createPlayer("AA")
        enemy.setShip(BLU)

        // Bot at origin, enemy straight along +x, comfortably inside fire range.
        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(enemy, 300, 0)
        // Park the bot's current facing on the target so it counts as "aimed".
        bot.ship.rotation = 0

        const found = findNearestEnemy(bot, Object.values(game.players))
        expect(found?.target).toBe(enemy)

        const inputs = computeBotInputs(bot, found)
        // Aim points along +x (atan2(0, +) === 0) within tolerance.
        expect(Math.abs(radianDifference(inputs.aimRotation, 0))).toBeLessThan(0.01)
        expect(inputs.useWeapon).toBe(true)
        // The bot's tactical is loaded, so an aimed in-range shot also fires it.
        expect(inputs.useTactical).toBe(true)
    })

    it("does not use the tactical when it is not ready", () => {
        const game = makeArena()
        const bot = game.addBot()
        const enemy = game.createPlayer("AA")
        enemy.setShip(BLU)

        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(enemy, 300, 0)
        bot.ship.rotation = 0

        // Drain the tactical ammo so canUseTactical is false this tick.
        bot.ship.capacities.tactical = 0

        const found = findNearestEnemy(bot, Object.values(game.players))
        const inputs = computeBotInputs(bot, found)
        // Primary still fires, but the empty tactical is held.
        expect(inputs.useWeapon).toBe(true)
        expect(inputs.useTactical).toBe(false)
    })

    it("faces and approaches a far enemy, holding fire is allowed but it moves", () => {
        const game = makeArena()
        const bot = game.addBot()
        const enemy = game.createPlayer("AA")
        enemy.setShip(BLU)

        // Enemy far above the bot, beyond fire range, straight along +y.
        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(enemy, 0, BOT_FIRE_RANGE + 800)
        bot.ship.rotation = Math.PI / 2

        const found = findNearestEnemy(bot, Object.values(game.players))
        const inputs = computeBotInputs(bot, found)

        // Faces the enemy (+y === PI/2) and drives toward it at full throttle.
        expect(Math.abs(radianDifference(inputs.aimRotation, Math.PI / 2))).toBeLessThan(0.01)
        expect(Math.abs(radianDifference(inputs.movementAngle, Math.PI / 2))).toBeLessThan(0.01)
        expect(inputs.movementAmount).toBeGreaterThan(0)
        // Out of range -> does not waste shots.
        expect(inputs.useWeapon).toBe(false)
    })

    it("prefers a human target over another bot", () => {
        const game = makeArena()
        const bot = game.addBot()
        const otherBot = game.addBot()
        const human = game.createPlayer("AA")
        human.setShip(BLU)

        game.spawnPlayer(bot, 0, 0)
        // Put the other bot CLOSER than the human to prove the human wins.
        game.spawnPlayer(otherBot, 50, 0)
        game.spawnPlayer(human, 500, 0)

        const found = findNearestEnemy(bot, Object.values(game.players))
        expect(found?.target).toBe(human)
    })

    it("holds still and does not fire with no target", () => {
        const game = makeArena()
        const bot = game.addBot()
        game.spawnPlayer(bot, 0, 0)

        const found = findNearestEnemy(bot, Object.values(game.players))
        expect(found).toBeUndefined()

        const inputs = computeBotInputs(bot, found)
        expect(inputs.movementAmount).toBe(0)
        expect(inputs.useWeapon).toBe(false)
        expect(inputs.useTactical).toBe(false)
    })
})

describe("AI brain integration (brain -> inputs -> fire -> collision)", () => {
    it("a bot deals damage to a stationary enemy in front of it", () => {
        const game = makeArena()
        const bot = game.addBot()
        bot.setShip(BLU)
        const enemy = game.createPlayer("AA")
        enemy.setShip(BLU)

        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(enemy, 250, 0)
        // Pre-aim the bot at the target so it can shoot from tick one without
        // waiting for the aim to slew (the brain still re-aims each tick).
        bot.ship.rotation = 0
        bot.ship.targetRotation = 0

        const dealt: { dealer: string, target: string, damage: number }[] = []
        game.events.on("dealDamage", ({ dealer, target, damage }) => {
            dealt.push({ dealer: dealer.id, target: target.id, damage })
        })

        const startHealth = enemy.ship.capacities.health

        // The enemy never gets inputs, so it sits still. Tick long enough for
        // the bot to aim, fire and for a bullet to fly the 250 units.
        for(let i = 0; i < 40; i++) game.update()

        expect(dealt.length).toBeGreaterThan(0)
        expect(dealt[0].dealer).toBe(bot.id)
        expect(dealt[0].target).toBe(enemy.id)
        expect(enemy.ship.capacities.health).toBeLessThan(startHealth)
    })

    it("a grenadier bot eventually fires its tactical (a grenade)", () => {
        const game = makeArena()
        const bot = game.addBot()
        bot.setShip(DJIBOUTI)
        const enemy = game.createPlayer("AA")
        enemy.setShip(BLU)

        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(enemy, 250, 0)
        // Pre-aim the bot so it can fire from tick one.
        bot.ship.rotation = 0
        bot.ship.targetRotation = 0

        const bulletTypes: string[] = []
        game.events.on("addBullet", ({ bullet }) => {
            bulletTypes.push(bullet.type)
        })

        // The enemy never gets inputs, so it sits still. Tick long enough for
        // the bot to aim and squeeze off a tactical shot (its own cooldown is
        // slower than the primary, so give it room).
        for(let i = 0; i < 40; i++) game.update()

        // It still fires its primary...
        expect(bulletTypes.includes("primary")).toBe(true)
        // ...and now also lobs a grenade from the tactical weapon.
        expect(bulletTypes.includes("grenade")).toBe(true)
    })

    it("a real player can damage a bot (bots are normal hittable players)", () => {
        const game = makeArena()
        const shooter = new PipPlayer(game, "AA")
        shooter.setShip(BLU)
        const bot = game.addBot()
        bot.setShip(BLU)

        game.spawnPlayer(shooter, 0, 0)
        game.spawnPlayer(bot, 200, 0)
        shooter.inputs.aimRotation = 0

        // Freeze AI so the bot stays put and we isolate "human damages bot".
        game.options.calculateAi = false

        const startHealth = bot.ship.capacities.health
        shooter.inputs.useWeapon = true
        for(let i = 0; i < 12; i++) game.update()

        expect(bot.ship.capacities.health).toBeLessThan(startHealth)
    })
})
