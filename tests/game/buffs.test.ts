import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import { Vector2 } from "@pip-pip/core/src/physics"
import { HASTE_TICKS, SHIELD_TICKS, INVIS_TICKS, RICOCHET_TICKS, RAPIDFIRE_TICKS, RAPIDFIRE_MULTIPLIER, applyBuffEffect } from "@pip-pip/game/src/logic/buff"
import { MAX_BUFF_TICKS } from "@pip-pip/game/src/logic/buff-config"
import { packetManager, encode } from "@pip-pip/game/src/networking/packets"

// Ship index 3 ("Blu") uses pure default stats, so its numbers are predictable.
const BLU = 3

// Build a clean arena with no walls and huge bounds (so nothing is clamped),
// buff spawning + damage enabled, phase set to MATCH, one spawned player.
function makeArena(options = {}){
    const game = new PipPipGame({
        shootPlayerBullets: true,
        triggerDamage: true,
        spawnBuffs: true,
        ...options,
    })

    for(const seg of game.map.segWalls) game.physics.removeSegWall(seg)
    for(const rect of game.map.rectWalls) game.physics.removeRectWall(rect)
    game.map.bounds.min.x = -100000
    game.map.bounds.min.y = -100000
    game.map.bounds.max.x = 100000
    game.map.bounds.max.y = 100000

    const player = new PipPlayer(game, "AA")
    player.setShip(BLU)

    game.setPhase(PipPipGamePhase.MATCH)
    game.spawnPlayer(player, 0, 0)

    return { game, player }
}

describe("map buffs", () => {
    it("heals a spawned player that overlaps a health buff, capped at max", () => {
        const { game, player } = makeArena()
        // Damage the ship so a heal has room to act.
        player.ship.capacities.health = 10
        const before = player.ship.capacities.health

        const buff = game.buffs.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            type: "health",
        })

        game.update()

        expect(buff.dead).toBe(true)
        expect(game.buffs.getActive()).toHaveLength(0)
        expect(player.ship.capacities.health).toBeGreaterThan(before)
        expect(player.ship.capacities.health).toBeLessThanOrEqual(player.ship.maxHealth)
    })

    it("does not exceed max health when healing a nearly-full ship", () => {
        const { game, player } = makeArena()
        player.ship.capacities.health = player.ship.maxHealth - 1

        game.buffs.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            type: "health",
        })

        game.update()

        expect(player.ship.capacities.health).toBe(player.ship.maxHealth)
    })

    it("refills weapon and tactical capacity on an ammo buff", () => {
        const { game, player } = makeArena()
        player.ship.capacities.weapon = 0
        player.ship.capacities.tactical = 0

        const buff = game.buffs.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            type: "ammo",
        })

        game.update()

        expect(buff.dead).toBe(true)
        expect(player.ship.capacities.weapon).toBe(player.ship.stats.weapon.capacity)
        expect(player.ship.capacities.tactical).toBe(player.ship.stats.tactical.capacity)
    })

    it("emits a buffPickup event naming the player and buff", () => {
        const { game, player } = makeArena()
        player.ship.capacities.health = 10
        const picks: Array<{ playerId: string, buffId: string }> = []
        game.events.on("buffPickup", ({ player, buff }) => {
            picks.push({ playerId: player.id, buffId: buff.id })
        })

        const buff = game.buffs.new({
            position: new Vector2(0, 0),
            type: "health",
        })
        game.update()

        expect(picks).toEqual([{ playerId: player.id, buffId: buff.id }])
    })

    it("does not pick up a buff the player does not overlap", () => {
        const { game, player } = makeArena()
        player.ship.capacities.health = 10

        game.buffs.new({
            position: new Vector2(5000, 5000),
            type: "health",
        })
        game.update()

        expect(game.buffs.getActive()).toHaveLength(1)
        expect(player.ship.capacities.health).toBe(10)
    })

    it("does not pick up a buff when the player is despawned", () => {
        const { game, player } = makeArena()
        player.ship.capacities.health = 10
        player.setSpawned(false)

        game.buffs.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            type: "health",
        })
        game.update()

        expect(game.buffs.getActive()).toHaveLength(1)
        expect(player.ship.capacities.health).toBe(10)
    })

    it("hastes a player that overlaps a haste buff", () => {
        const { game, player } = makeArena()
        expect(player.ship.timings.haste).toBe(0)

        game.buffs.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            type: "haste",
        })

        game.update()

        expect(player.ship.timings.haste).toBeGreaterThan(0)
    })

    it("a hasted player accelerates faster than an un-hasted one over N ticks", () => {
        // Two identical arenas, identical drive input; one player is hasted.
        const N = 15
        const drive = { angle: 0, amount: 1 }

        function runFor(hasted: boolean){
            const { game, player } = makeArena()
            player.ship.physics.position.x = 0
            player.ship.physics.position.y = 0
            player.ship.physics.velocity.x = 0
            player.ship.physics.velocity.y = 0
            player.inputs.movementAngle = drive.angle
            player.inputs.movementAmount = drive.amount
            player.inputs.aimRotation = drive.angle
            if(hasted) player.ship.timings.haste = 1000 // stay hasted the whole run
            for(let i = 0; i < N; i++) game.update()
            return player.ship.physics.position.x
        }

        const plain = runFor(false)
        const fast = runFor(true)
        expect(fast).toBeGreaterThan(plain)
    })

    it("shields a player that overlaps a shield buff", () => {
        const { game, player } = makeArena()
        expect(player.ship.timings.shield).toBe(0)

        game.buffs.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            type: "shield",
        })

        game.update()

        expect(player.ship.timings.shield).toBeGreaterThan(0)
    })

    it("a shielded player takes ZERO damage from a bullet, then normal damage after it expires", () => {
        const { game, player } = makeArena()
        const owner = new PipPlayer(game, "BB")
        owner.setShip(BLU)

        player.ship.timings.shield = 5
        const fullHealth = player.ship.capacities.health

        // Fire a bullet dead-centre on the shielded target.
        game.bullets.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            owner,
            velocity: new Vector2(0, 0),
            speed: 0,
            radius: 4,
            rotation: 0,
            damage: 4,
            type: "primary",
        })
        game.update()
        expect(player.ship.capacities.health).toBe(fullHealth)

        // Let the shield expire, then a fresh bullet must deal normal damage.
        player.ship.timings.shield = 0
        game.bullets.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            owner,
            velocity: new Vector2(0, 0),
            speed: 0,
            radius: 4,
            rotation: 0,
            damage: 4,
            type: "primary",
        })
        game.update()
        expect(player.ship.capacities.health).toBeLessThan(fullHealth)
    })

    it("a shielded player takes ZERO damage from a grenade detonation", () => {
        const { game, player } = makeArena()
        const owner = new PipPlayer(game, "BB")
        owner.setShip(BLU)

        player.ship.timings.shield = 5
        const fullHealth = player.ship.capacities.health

        // Grenade dead-centre on the shielded target detonates on contact.
        game.bullets.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            owner,
            velocity: new Vector2(0, 0),
            speed: 0,
            radius: 14,
            rotation: 0,
            damage: 40,
            type: "grenade",
            explosionRadius: 120,
        })
        game.update()
        expect(player.ship.capacities.health).toBe(fullHealth)
    })

    it("buff timings tick down to 0 over their duration", () => {
        const { game, player } = makeArena()
        // Set both buffs directly: a single pickup loop only picks up one
        // overlapping buff per tick, so seed the timings to test tick-down.
        player.ship.timings.haste = HASTE_TICKS
        player.ship.timings.shield = SHIELD_TICKS

        const haste = player.ship.timings.haste
        const shield = player.ship.timings.shield
        expect(haste).toBeGreaterThan(0)
        expect(shield).toBeGreaterThan(0)

        // Drive enough ticks to outlast the longer of the two buffs.
        for(let i = 0; i < Math.max(haste, shield) + 5; i++) game.update()
        expect(player.ship.timings.haste).toBe(0)
        expect(player.ship.timings.shield).toBe(0)
    })

    it("spawns buffs during MATCH when spawnBuffs is enabled", () => {
        const { game } = makeArena()
        // Drive enough ticks to cross several spawn intervals.
        for(let i = 0; i < game.BUFF_SPAWN_INTERVAL_TICKS * 5; i++) game.update()
        const active = game.buffs.getActive().length
        expect(active).toBeGreaterThan(0)
        expect(active).toBeLessThanOrEqual(game.buffDensityTarget())
    })

    it("never spawns more than the density target", () => {
        const { game } = makeArena()
        for(let i = 0; i < game.BUFF_SPAWN_INTERVAL_TICKS * 20; i++) game.update()
        expect(game.buffs.getActive().length).toBeLessThanOrEqual(game.buffDensityTarget())
    })

    it("does not spawn buffs when spawnBuffs is disabled", () => {
        const { game } = makeArena({ spawnBuffs: false })
        for(let i = 0; i < game.BUFF_SPAWN_INTERVAL_TICKS * 5; i++) game.update()
        expect(game.buffs.getActive()).toHaveLength(0)
    })

    it("does not spawn buffs outside the MATCH phase", () => {
        const { game } = makeArena()
        game.setPhase(PipPipGamePhase.SETUP)
        for(let i = 0; i < game.BUFF_SPAWN_INTERVAL_TICKS * 5; i++) game.update()
        expect(game.buffs.getActive()).toHaveLength(0)
    })

    it("cloaks a player that overlaps an invis buff", () => {
        const { game, player } = makeArena()
        expect(player.ship.timings.invisibility).toBe(0)
        expect(player.ship.isInvisible).toBe(false)

        game.buffs.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            type: "invis",
        })

        game.update()

        expect(player.ship.timings.invisibility).toBeGreaterThan(0)
        expect(player.ship.isInvisible).toBe(true)
    })
})

describe("invisibility (cloak) buff", () => {
    it("applyBuffEffect sets the invisibility timer to INVIS_TICKS", () => {
        const { player } = makeArena()
        expect(player.ship.timings.invisibility).toBe(0)

        applyBuffEffect("invis", player)

        expect(player.ship.timings.invisibility).toBe(INVIS_TICKS)
    })

    it("INVIS_TICKS fits in the uint16 playerShipTimings wire (now > uint8)", () => {
        // The rework widened the buff timers to uint16; INVIS_TICKS exceeds the
        // old uint8 cap and must fit the new 65535 ceiling.
        expect(INVIS_TICKS).toBeGreaterThan(255)
        expect(INVIS_TICKS).toBeLessThanOrEqual(65535)
    })

    it("isInvisible reflects the invisibility timer", () => {
        const { player } = makeArena()
        expect(player.ship.isInvisible).toBe(false)

        player.ship.timings.invisibility = 1
        expect(player.ship.isInvisible).toBe(true)

        player.ship.timings.invisibility = 0
        expect(player.ship.isInvisible).toBe(false)
    })

    it("invisibility is DISTINCT from the invincibility no-damage timer", () => {
        const { player } = makeArena()

        // The cloak does not block damage (that is isShielded), and the legacy
        // invincibility timer does not cloak the ship.
        player.ship.timings.invisibility = INVIS_TICKS
        expect(player.ship.isInvisible).toBe(true)
        expect(player.ship.isShielded).toBe(false)

        player.ship.timings.invisibility = 0
        player.ship.timings.invincibility = 5
        expect(player.ship.isInvisible).toBe(false)
        expect(player.ship.isShielded).toBe(true)
    })

    it("the invisibility timer ticks down to 0 over its duration", () => {
        const { game, player } = makeArena()
        player.ship.timings.invisibility = INVIS_TICKS
        expect(player.ship.timings.invisibility).toBeGreaterThan(0)

        for(let i = 0; i < INVIS_TICKS + 5; i++) game.update()

        expect(player.ship.timings.invisibility).toBe(0)
        expect(player.ship.isInvisible).toBe(false)
    })

    it("reset() clears the invisibility timer", () => {
        const { player } = makeArena()
        player.ship.timings.invisibility = INVIS_TICKS

        player.ship.reset()

        expect(player.ship.timings.invisibility).toBe(0)
        expect(player.ship.isInvisible).toBe(false)
    })
})

describe("rapidfire buff", () => {
    it("applyBuffEffect sets the rapidfire timer to RAPIDFIRE_TICKS", () => {
        const { player } = makeArena()
        expect(player.ship.timings.rapidfire).toBe(0)

        applyBuffEffect("rapidfire", player)

        expect(player.ship.timings.rapidfire).toBe(RAPIDFIRE_TICKS)
        expect(player.ship.hasRapidfire).toBe(true)
    })

    it("RAPIDFIRE_TICKS fits in the uint16 playerShipTimings wire (now > uint8)", () => {
        // The rework widened the buff timers to uint16; RAPIDFIRE_TICKS exceeds
        // the old uint8 cap and must fit the new 65535 ceiling.
        expect(RAPIDFIRE_TICKS).toBeGreaterThan(255)
        expect(RAPIDFIRE_TICKS).toBeLessThanOrEqual(65535)
    })

    it("hasRapidfire reflects the rapidfire timer", () => {
        const { player } = makeArena()
        expect(player.ship.hasRapidfire).toBe(false)

        player.ship.timings.rapidfire = 1
        expect(player.ship.hasRapidfire).toBe(true)

        player.ship.timings.rapidfire = 0
        expect(player.ship.hasRapidfire).toBe(false)
    })

    it("the rapidfire timer ticks down to 0 over its duration", () => {
        const { game, player } = makeArena()
        player.ship.timings.rapidfire = RAPIDFIRE_TICKS
        expect(player.ship.timings.rapidfire).toBeGreaterThan(0)

        for(let i = 0; i < RAPIDFIRE_TICKS + 5; i++) game.update()

        expect(player.ship.timings.rapidfire).toBe(0)
        expect(player.ship.hasRapidfire).toBe(false)
    })

    it("reset() clears the rapidfire timer", () => {
        const { player } = makeArena()
        player.ship.timings.rapidfire = RAPIDFIRE_TICKS

        player.ship.reset()

        expect(player.ship.timings.rapidfire).toBe(0)
        expect(player.ship.hasRapidfire).toBe(false)
    })

    it("rapidfires a player that overlaps a rapidfire buff", () => {
        const { game, player } = makeArena()
        expect(player.ship.timings.rapidfire).toBe(0)

        game.buffs.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            type: "rapidfire",
        })

        game.update()

        expect(player.ship.timings.rapidfire).toBeGreaterThan(0)
    })

    it("shoot sets a shorter weaponRate cooldown while rapidfire is active", () => {
        const { player } = makeArena()
        const ship = player.ship
        const rate = ship.stats.weapon.rate

        // No buff: shoot stamps the full weapon-rate cooldown.
        ship.timings.weaponRate = 0
        ship.shoot()
        const plainCooldown = ship.timings.weaponRate
        expect(plainCooldown).toBe(rate)

        // Buffed: the same shot stamps the scaled (shorter) cooldown.
        ship.timings.weaponRate = 0
        ship.timings.rapidfire = RAPIDFIRE_TICKS
        ship.shoot()
        const fastCooldown = ship.timings.weaponRate
        expect(fastCooldown).toBe(Math.ceil(rate * RAPIDFIRE_MULTIPLIER))
        expect(fastCooldown).toBeLessThan(plainCooldown)
    })

    it("rapidfire shortens the effective fire interval, restored once it expires", () => {
        // Measure the gap (in ticks) between two successive successful shots by
        // pulling the trigger every tick. canUseWeapon requires weaponRate === 0,
        // so the gap is the cooldown the previous shot stamped plus the tick it
        // takes to reach the next ready frame.
        function intervalBetweenShots(rapidfire: boolean): number {
            const { game, player } = makeArena()
            const ship = player.ship
            // Plenty of ammo so a reload never interrupts the cadence under test.
            ship.capacities.weapon = ship.stats.weapon.capacity
            if(rapidfire) ship.timings.rapidfire = RAPIDFIRE_TICKS

            // Fire the first shot now (trigger is ready on a fresh ship).
            expect(ship.shoot()).toBe(true)

            // Advance ticks, pulling the trigger each tick, until the next shot lands.
            let ticks = 0
            for(let i = 0; i < 50; i++){
                game.update()
                ticks += 1
                // Keep rapidfire pinned for the duration of the measurement so the
                // buff does not lapse mid-interval and skew the count.
                if(rapidfire) ship.timings.rapidfire = RAPIDFIRE_TICKS
                if(ship.shoot()){
                    return ticks
                }
            }
            throw new Error("never fired a second shot within the window")
        }

        const plainInterval = intervalBetweenShots(false)
        const fastInterval = intervalBetweenShots(true)
        expect(fastInterval).toBeLessThan(plainInterval)

        // And once the buff lapses, the interval returns to the un-buffed cadence.
        const { game, player } = makeArena()
        const ship = player.ship
        ship.capacities.weapon = ship.stats.weapon.capacity
        ship.timings.rapidfire = 0 // expired
        expect(ship.shoot()).toBe(true)
        let restoredTicks = 0
        for(let i = 0; i < 50; i++){
            game.update()
            restoredTicks += 1
            if(ship.shoot()) break
        }
        expect(restoredTicks).toBe(plainInterval)
    })
})

describe("timed-buff stacking", () => {
    it("re-grabbing the SAME buff ADDS its duration (haste stacks to 2x)", () => {
        const { player } = makeArena()
        expect(player.ship.timings.haste).toBe(0)

        applyBuffEffect("haste", player)
        expect(player.ship.timings.haste).toBe(HASTE_TICKS)

        applyBuffEffect("haste", player)
        expect(player.ship.timings.haste).toBe(2 * HASTE_TICKS)
    })

    it("stacking is clamped at MAX_BUFF_TICKS no matter how many are grabbed", () => {
        const { player } = makeArena()

        // Apply far more than enough to exceed the clamp (each adds HASTE_TICKS).
        const grabs = Math.ceil(MAX_BUFF_TICKS / HASTE_TICKS) + 5
        for(let i = 0; i < grabs; i++) applyBuffEffect("haste", player)

        expect(player.ship.timings.haste).toBe(MAX_BUFF_TICKS)
    })

    it("stacks each timed buff independently into its own timing slot", () => {
        const { player } = makeArena()

        applyBuffEffect("shield", player)
        applyBuffEffect("shield", player)
        applyBuffEffect("invis", player)
        applyBuffEffect("invis", player)
        applyBuffEffect("ricochet", player)
        applyBuffEffect("rapidfire", player)

        expect(player.ship.timings.shield).toBe(2 * SHIELD_TICKS)
        expect(player.ship.timings.invisibility).toBe(2 * INVIS_TICKS)
        expect(player.ship.timings.ricochet).toBe(RICOCHET_TICKS)
        expect(player.ship.timings.rapidfire).toBe(RAPIDFIRE_TICKS)
    })
})

describe("playerShipTimings wire is uint16 (buff timers survive a round-trip)", () => {
    it("round-trips a 600-tick invisibility/ricochet through encode + decode", () => {
        const { player } = makeArena()

        // 600 > 255, so a uint8 field would wrap; the widened uint16 must keep it.
        player.ship.timings.invisibility = 600
        player.ship.timings.ricochet = 600

        const bytes = encode.playerShipTimings(player)
        const decoded = packetManager.decode(bytes)

        const timings = decoded.playerShipTimings?.[0]
        expect(timings).toBeDefined()
        expect(timings?.playerId).toBe(player.id)
        expect(timings?.invisibility).toBe(600)
        expect(timings?.ricochet).toBe(600)
    })

    it("round-trips the maximum uint16 buff timer (MAX_BUFF_TICKS) intact", () => {
        const { player } = makeArena()
        player.ship.timings.haste = MAX_BUFF_TICKS
        player.ship.timings.shield = MAX_BUFF_TICKS
        player.ship.timings.rapidfire = MAX_BUFF_TICKS

        const decoded = packetManager.decode(encode.playerShipTimings(player))
        const timings = decoded.playerShipTimings?.[0]

        expect(timings?.haste).toBe(MAX_BUFF_TICKS)
        expect(timings?.shield).toBe(MAX_BUFF_TICKS)
        expect(timings?.rapidfire).toBe(MAX_BUFF_TICKS)
    })
})
