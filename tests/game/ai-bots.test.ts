import { describe, expect, it } from "vitest"
import { MAX_BOTS, PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import {
    BOT_FIRE_RANGE,
    BotDifficulty,
    BotNavContext,
    computeBotInputs,
    findNearestEnemy,
    makeBotSkill,
    updateBotInputs,
} from "@pip-pip/game/src/logic/ai"
import { buildNavGrid } from "@pip-pip/game/src/logic/pathfinding"
import { PointPhysicsSegmentWall } from "@pip-pip/core/src/physics"
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

    it("enforces the MAX_BOTS hard cap (8) across every add path", () => {
        const game = new PipPipGame()
        expect(MAX_BOTS).toBe(8)

        // addBots can never overshoot the cap, even when asked for far more.
        const added = game.addBots(100)
        expect(added.length).toBe(MAX_BOTS)
        expect(game.botCount).toBe(MAX_BOTS)

        // addBot at the cap adds nothing and reports it by returning undefined.
        expect(game.addBot()).toBeUndefined()
        expect(game.botCount).toBe(MAX_BOTS)

        // Clearing frees the slots so bots can be added again.
        game.clearBots()
        expect(game.botCount).toBe(0)
        expect(game.addBot()).not.toBeUndefined()
        expect(game.botCount).toBe(1)
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

    it("targets the nearest enemy regardless of bot vs human", () => {
        const game = makeArena()
        const bot = game.addBot()
        const otherBot = game.addBot()
        const human = game.createPlayer("AA")
        human.setShip(BLU)

        game.spawnPlayer(bot, 0, 0)
        // The other bot is CLOSER than the human; with no human priority, the
        // nearest target (the bot) wins.
        game.spawnPlayer(otherBot, 50, 0)
        game.spawnPlayer(human, 500, 0)

        const found = findNearestEnemy(bot, Object.values(game.players))
        expect(found?.target).toBe(otherBot)
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

describe("AI reaction lag + difficulty feel", () => {
    it("a bot aims at where the target WAS, then catches up (reaction lag)", () => {
        const game = makeArena()
        const bot = game.addBot()
        // Isolate the lag: no aim wander, a 2-tick reaction. (updateBotInputs only
        // writes inputs, never moves the ship, so the bot stays at the origin.)
        bot.skill = {
            aimJitter: 0,
            fireRange: BOT_FIRE_RANGE,
            fireAimTolerance: 0.25,
            desiredRange: 350,
            rangeBand: 120,
            reactionTicks: 2,
        }
        const target = game.createPlayer("AA")
        target.setShip(BLU)
        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(target, 0, 400) // straight up -> angle PI/2

        const players = Object.values(game.players)
        for(let i = 0; i < 4; i++) updateBotInputs(bot, players)
        expect(Math.abs(radianDifference(bot.inputs.aimRotation, Math.PI / 2))).toBeLessThan(0.05)

        // Jump the target hard to the right. The very next tick the bot still aims
        // UP, because its perception lags by ~2 ticks.
        target.ship.physics.position.x = 400
        target.ship.physics.position.y = 0
        updateBotInputs(bot, players)
        expect(Math.abs(radianDifference(bot.inputs.aimRotation, Math.PI / 2))).toBeLessThan(0.2)

        // Once the lag elapses, it tracks the new heading (angle 0).
        for(let i = 0; i < 5; i++) updateBotInputs(bot, players)
        expect(Math.abs(radianDifference(bot.inputs.aimRotation, 0))).toBeLessThan(0.05)
    })

    it("rate-limits a bot's fire (no machine-gun trigger holding)", () => {
        const game = makeArena()
        const bot = game.addBot()
        // A skilled bot aimed at an in-range target: it WANTS to fire every tick,
        // but trigger discipline should space the shots out.
        bot.skill = {
            aimJitter: 0,
            fireRange: BOT_FIRE_RANGE,
            fireAimTolerance: 1.0,
            desiredRange: 350,
            rangeBand: 120,
            reactionTicks: 2,
        }
        const target = game.createPlayer("AA")
        target.setShip(BLU)
        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(target, 200, 0) // in range, dead ahead
        bot.ship.rotation = 0 // already aimed

        const players = Object.values(game.players)
        let fireTicks = 0
        for(let i = 0; i < 24; i++){
            updateBotInputs(bot, players)
            if(bot.inputs.useWeapon) fireTicks++
        }
        // reactionTicks 2 -> a ~12-tick fire gap, so over 24 ticks it fires only a
        // couple of times, NOT on every tick.
        expect(fireTicks).toBeGreaterThan(0)
        expect(fireTicks).toBeLessThan(6)
    })

    it("EASY is sloppier + slower-reacting than HARD", () => {
        const noVariance = () => 0.5
        const easy = makeBotSkill(BotDifficulty.EASY, noVariance)
        const hard = makeBotSkill(BotDifficulty.HARD, noVariance)
        // EASY wanders more, fires while less aligned, and reacts slower.
        expect(easy.aimJitter).toBeGreaterThan(hard.aimJitter)
        expect(easy.fireAimTolerance).toBeGreaterThan(hard.fireAimTolerance)
        expect(easy.reactionTicks).toBeGreaterThan(hard.reactionTicks)
        expect(hard.reactionTicks).toBeGreaterThan(0)
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

describe("AI pathfinding around walls", () => {
    // A nav context over a 4000-wide arena with a single vertical wall down the
    // middle that leaves a gap at the top, so the only route from the left side
    // to a target on the right side goes up and over.
    function blockingWallNav(): { nav: BotNavContext, wall: PointPhysicsSegmentWall }{
        const bounds = { min: { x: -2000, y: -2000 }, max: { x: 2000, y: 2000 } }
        const wall = new PointPhysicsSegmentWall(undefined, 0, -2000, 0, 600)
        wall.radius = 25
        const grid = buildNavGrid(bounds, [], [wall])
        return {
            nav: { grid, rectWalls: [], segWalls: [wall], tick: 0 },
            wall,
        }
    }

    it("with a CLEAR line of sight still drives STRAIGHT at the target (nav passed)", () => {
        const game = makeArena()
        const bot = game.addBot()
        const enemy = game.createPlayer("AA")
        enemy.setShip(BLU)

        // Enemy far along +x, beyond the range band so the bot is in pure
        // approach. NO walls in this nav context, so line of sight is clear.
        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(enemy, BOT_FIRE_RANGE + 800, 0)
        bot.ship.rotation = 0

        const bounds = { min: { x: -5000, y: -5000 }, max: { x: 5000, y: 5000 } }
        const nav: BotNavContext = {
            grid: buildNavGrid(bounds, [], []),
            rectWalls: [],
            segWalls: [],
            tick: 0,
        }

        const found = findNearestEnemy(bot, Object.values(game.players))
        // Passing the nav context must NOT change the clear-lane behaviour: the
        // movement angle still points straight at the target (+x === 0).
        const inputs = computeBotInputs(bot, found, 0, nav)
        expect(Math.abs(radianDifference(inputs.movementAngle, 0))).toBeLessThan(0.01)
        expect(inputs.movementAmount).toBeGreaterThan(0)
    })

    it("with the lane BLOCKED steers off the direct line to route around the wall", () => {
        const game = makeArena()
        const bot = game.addBot()
        const enemy = game.createPlayer("AA")
        enemy.setShip(BLU)

        const { nav } = blockingWallNav()

        // Bot on the left, enemy straight across on the right: the direct angle is
        // ~0 (+x), but the wall blocks that lane, so the bot must steer toward the
        // gap (upward, a clearly non-zero movement angle).
        game.spawnPlayer(bot, -800, 0)
        game.spawnPlayer(enemy, 800, 0)
        bot.ship.rotation = 0

        // Run the full brain so it recomputes a path and follows it.
        updateBotInputs(bot, Object.values(game.players), Math.random, nav)

        // Aim still tracks the real target straight across (+x === 0)...
        expect(Math.abs(radianDifference(bot.inputs.aimRotation, 0))).toBeLessThan(0.2)
        // ...but movement is NOT straight at the target: it has been deflected to
        // route around the wall (a meaningful angular offset from the direct line).
        expect(Math.abs(radianDifference(bot.inputs.movementAngle, 0))).toBeGreaterThan(0.2)
        // A path was cached for the bot.
        expect(Array.isArray(bot.path)).toBe(true)
    })

    it("falls back gracefully (no crash, stays put-ish) when the target is unreachable", () => {
        const game = makeArena()
        const bot = game.addBot()
        const enemy = game.createPlayer("AA")
        enemy.setShip(BLU)

        // Seal the bot inside a fully closed box of segment walls; the enemy sits
        // far outside it, so no route exists.
        const bounds = { min: { x: -2000, y: -2000 }, max: { x: 2000, y: 2000 } }
        const r = 25
        const walls = [
            new PointPhysicsSegmentWall(undefined, -200, -200, 200, -200),
            new PointPhysicsSegmentWall(undefined, 200, -200, 200, 200),
            new PointPhysicsSegmentWall(undefined, 200, 200, -200, 200),
            new PointPhysicsSegmentWall(undefined, -200, 200, -200, -200),
        ]
        for(const w of walls) w.radius = r
        const grid = buildNavGrid(bounds, [], walls)
        const nav: BotNavContext = { grid, rectWalls: [], segWalls: walls, tick: 0 }

        game.spawnPlayer(bot, 0, 0)
        game.spawnPlayer(enemy, 1500, 0)

        // Must not throw, and must produce a valid finite movement angle.
        expect(() => updateBotInputs(bot, Object.values(game.players), Math.random, nav)).not.toThrow()
        expect(Number.isFinite(bot.inputs.movementAngle)).toBe(true)
    })
})
