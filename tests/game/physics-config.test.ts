import { describe, expect, it } from "vitest"
import { PipPipGame } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import { DEFAULT_SHIP_STATS } from "@pip-pip/game/src/logic/ship"
import { MOVEMENT_CONFIG } from "@pip-pip/game/src/logic/physics-config"

describe("movement config wiring", () => {
    it("default ship stats derive from MOVEMENT_CONFIG", () => {
        expect(DEFAULT_SHIP_STATS.movement.acceleration.normal).toBe(MOVEMENT_CONFIG.acceleration)
        expect(DEFAULT_SHIP_STATS.movement.speed.normal).toBe(MOVEMENT_CONFIG.maxSpeed)
        expect(DEFAULT_SHIP_STATS.movement.agility).toBe(MOVEMENT_CONFIG.agility)
        // Range shape preserved: low < normal < high.
        expect(DEFAULT_SHIP_STATS.movement.acceleration.low).toBeLessThan(DEFAULT_SHIP_STATS.movement.acceleration.normal)
        expect(DEFAULT_SHIP_STATS.movement.acceleration.high).toBeGreaterThan(DEFAULT_SHIP_STATS.movement.acceleration.normal)
    })

    it("a ship's physics body uses the config friction and mass", () => {
        const game = new PipPipGame({})
        const player = new PipPlayer(game, "AA")
        player.setShip(3)
        expect(player.ship.physics.airResistance).toBe(MOVEMENT_CONFIG.friction)
        expect(player.ship.physics.mass).toBe(MOVEMENT_CONFIG.mass)
    })
})
