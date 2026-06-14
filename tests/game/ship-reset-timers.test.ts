import { describe, expect, it } from "vitest"
import { PipPipGame } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"

// Ship index 3 ("Blu") uses pure default stats, including the 100-tick tactical
// reload that outlasts the 60-tick respawn window.
const BLU = 3

function makeShip(){
    const game = new PipPipGame()
    const player = new PipPlayer(game, "SS")
    player.setShip(BLU)
    return player.ship
}

// Regression: reset() (called on respawn) refilled ammo but did not clear the
// weapon/tactical reload + rate timers. A tactical reload begun shortly before
// death keeps ticking while despawned and outlives the respawn window, so a fresh
// ship showed full tactical ammo yet canUseTactical reported it still reloading.
describe("ship.reset() clears the reload/rate timers", () => {
    it("makes a respawned ship immediately fire-ready (tactical not stuck reloading)", () => {
        const ship = makeShip()

        // Simulate a tactical reload that survived the dead window, plus leftover
        // primary-weapon timers.
        ship.timings.tacticalReload = 40
        ship.timings.tacticalRate = 5
        ship.timings.weaponReload = 3
        ship.timings.weaponRate = 2
        // Before reset the ship is wrongly considered mid-tactical-reload.
        expect(ship.isTacticalReloading).toBe(true)
        expect(ship.canUseTactical).toBe(false)

        ship.reset()

        expect(ship.timings.tacticalReload).toBe(0)
        expect(ship.timings.tacticalRate).toBe(0)
        expect(ship.timings.weaponReload).toBe(0)
        expect(ship.timings.weaponRate).toBe(0)
        expect(ship.isTacticalReloading).toBe(false)
        expect(ship.canUseTactical).toBe(true)
    })

    it("still refills ammo and clears buffs (existing reset behavior preserved)", () => {
        const ship = makeShip()
        ship.capacities.tactical = 0
        ship.capacities.health = 1
        ship.timings.haste = 50

        ship.reset()

        expect(ship.capacities.tactical).toBe(ship.stats.tactical.capacity)
        expect(ship.capacities.health).toBe(ship.stats.health.capacity.normal)
        expect(ship.timings.haste).toBe(0)
    })

    it("leaves intentional spawn protection (invincibility) untouched", () => {
        const ship = makeShip()
        ship.timings.invincibility = 30
        ship.reset()
        // Spawn invincibility is deliberate; reset must NOT clear it.
        expect(ship.timings.invincibility).toBe(30)
    })
})
