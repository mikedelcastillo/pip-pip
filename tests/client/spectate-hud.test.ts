import { describe, expect, it } from "vitest"
import { playerStats, activeBuffs } from "../../packages/client/src/game/store"
import { PipPipGame } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import { HASTE_TICKS, SHIELD_TICKS } from "@pip-pip/game/src/logic/buff"

// playerStats is the single mapper that turns a networked player's live ship into
// the flat ClientPlayerStats the HUD reads. The spectate mini-HUD reuses it to
// show the WATCHED player's health/ammo/buffs (selected by id in the store sync),
// so these tests pin the mapping the spectate panel depends on. A fresh PipPlayer
// gets a ship via setShip() in its constructor, so capacities/timings are real.
function makePlayer(id = "p1"): PipPlayer {
    const game = new PipPipGame()
    return new PipPlayer(game, id)
}

describe("playerStats", () => {
    it("mirrors the ship's primary + tactical ammo capacities", () => {
        const player = makePlayer()
        const ship = player.ship
        const stats = playerStats(player)
        expect(stats.ammo).toBe(ship.capacities.weapon)
        expect(stats.ammoMax).toBe(ship.stats.weapon.capacity)
        expect(stats.tacticalAmmo).toBe(ship.capacities.tactical)
        expect(stats.tacticalAmmoMax).toBe(ship.stats.tactical.capacity)
    })

    it("mirrors the ship's current and max health", () => {
        const player = makePlayer()
        player.ship.capacities.health = 42
        const stats = playerStats(player)
        expect(stats.health).toBe(42)
        expect(stats.healthMax).toBe(player.ship.maxHealth)
        expect(stats.healthMax).toBeGreaterThan(0)
    })

    it("reports the reloading flag from the ship", () => {
        const player = makePlayer()
        expect(playerStats(player).reloading).toBe(false)
        player.ship.timings.weaponReload = 10
        expect(playerStats(player).reloading).toBe(true)
    })

    it("mirrors spawn state and the respawn countdown", () => {
        const player = makePlayer()
        player.spawned = true
        player.timings.spawnTimeout = 0
        expect(playerStats(player).spawned).toBe(true)
        player.spawned = false
        player.timings.spawnTimeout = 37
        const stats = playerStats(player)
        expect(stats.spawned).toBe(false)
        expect(stats.spawnTimeout).toBe(37)
    })

    it("carries each live buff timer through to the stats", () => {
        const player = makePlayer()
        player.ship.timings.haste = 120
        player.ship.timings.shield = 80
        const stats = playerStats(player)
        expect(stats.hasteTicks).toBe(120)
        expect(stats.hasteMaxTicks).toBe(HASTE_TICKS)
        expect(stats.shieldTicks).toBe(80)
        expect(stats.shieldMaxTicks).toBe(SHIELD_TICKS)
    })

    it("feeds activeBuffs so the spectate mini-HUD lists the target's buffs", () => {
        const player = makePlayer()
        player.ship.timings.haste = 100
        const buffs = activeBuffs(playerStats(player))
        expect(buffs.map((b) => b.type)).toEqual(["haste"])
        expect(buffs[0].ticks).toBe(100)
    })

    it("produces no active buffs for a player holding none", () => {
        const player = makePlayer()
        expect(activeBuffs(playerStats(player))).toEqual([])
    })
})
