import { describe, expect, it } from "vitest"
import { packetManager } from "@pip-pip/game/src/networking/packets"
import { POWERUP_TYPE_TO_CODE, POWERUP_CODE_TO_TYPE } from "@pip-pip/game/src/logic/powerup"

// These guard the wire format shared by client and server. A change to a packet's
// field set or serializer that breaks compatibility shows up here as a round-trip
// failure rather than as a silent desync in the running game.
describe("game packetManager wire format", () => {
    it("round-trips playerSetShip exactly (string id + uint8)", () => {
        const decoded = packetManager.decode(
            packetManager.encode("playerSetShip", { playerId: "ab", shipIndex: 5 }),
        )
        expect(decoded.playerSetShip?.[0]).toEqual({ playerId: "ab", shipIndex: 5 })
    })

    it("round-trips playerSpectate exactly (string id + bool)", () => {
        const on = packetManager.decode(
            packetManager.encode("playerSpectate", { playerId: "ab", spectating: true }),
        )
        expect(on.playerSpectate?.[0]).toEqual({ playerId: "ab", spectating: true })

        const off = packetManager.decode(
            packetManager.encode("playerSpectate", { playerId: "cd", spectating: false }),
        )
        expect(off.playerSpectate?.[0]).toEqual({ playerId: "cd", spectating: false })
    })

    it("round-trips a chat message of arbitrary length", () => {
        const message = "gg wp everyone 🚀"
        const decoded = packetManager.decode(packetManager.encode("sendChat", { message }))
        expect(decoded.sendChat?.[0]?.message).toBe(message)
    })

    it("round-trips gameMode (host in-lobby mode + target change)", () => {
        // The lobby sends this when the host switches mode; the server clamps and
        // applies it via setSettings. Both targets ride along so neither is lost.
        const dm = packetManager.decode(
            packetManager.encode("gameMode", { mode: 0, maxKills: 30, matchMinutes: 5 }),
        )
        expect(dm.gameMode?.[0]).toEqual({ mode: 0, maxKills: 30, matchMinutes: 5 })

        const kf = packetManager.decode(
            packetManager.encode("gameMode", { mode: 1, maxKills: 25, matchMinutes: 7 }),
        )
        expect(kf.gameMode?.[0]).toEqual({ mode: 1, maxKills: 25, matchMinutes: 7 })
    })

    it("round-trips playerScores with values above 255 (no uint8 wrap)", () => {
        // Long matches push kills/assists/deaths past 255. These fields are
        // uint16, so a 300-kill score must survive the wire untouched (uint8
        // would have wrapped 300 -> 44).
        const scores = {
            playerId: "ef",
            kills: 300,
            assists: 512,
            deaths: 1000,
            damage: 5_000_000,
        }
        const out = packetManager.decode(packetManager.encode("playerScores", scores)).playerScores?.[0]
        expect(out).toEqual(scores)
    })

    it("round-trips powerupSpawn (string id + uint8 type + quantized position)", () => {
        const decoded = packetManager.decode(
            packetManager.encode("powerupSpawn", { id: "ab12", type: 1, x: 320, y: -480 }),
        ).powerupSpawn?.[0]
        expect(decoded?.id).toBe("ab12")
        expect(decoded?.type).toBe(1)
        // $worldPos is fixed-point, so positions come back within quantization noise.
        expect(decoded?.x).toBeCloseTo(320, 0)
        expect(decoded?.y).toBeCloseTo(-480, 0)
    })

    it("round-trips powerupPickup exactly (powerup id + player id)", () => {
        const decoded = packetManager.decode(
            packetManager.encode("powerupPickup", { id: "wxyz", playerId: "ab" }),
        )
        expect(decoded.powerupPickup?.[0]).toEqual({ id: "wxyz", playerId: "ab" })
    })

    it("round-trips playerShipTimings including haste/shield/invisibility (uint8)", () => {
        const timings = {
            playerId: "ab",
            weaponReload: 12,
            weaponRate: 3,
            tacticalReload: 100,
            tacticalRate: 20,
            healthRegenerationRest: 99,
            healthRegenerationHeal: 5,
            invincibility: 60,
            haste: 120,
            shield: 100,
            invisibility: 120,
        }
        const out = packetManager.decode(packetManager.encode("playerShipTimings", timings)).playerShipTimings?.[0]
        expect(out).toEqual(timings)
        // Durations must fit uint8 (<= 255) so they survive the wire untouched.
        expect(out?.haste).toBe(120)
        expect(out?.shield).toBe(100)
        // invisibility is a distinct timer from invincibility — both round-trip.
        expect(out?.invisibility).toBe(120)
        expect(out?.invincibility).toBe(60)
    })

    it("round-trips the invis powerup wire code through powerupSpawn", () => {
        const code = POWERUP_TYPE_TO_CODE.invis
        const decoded = packetManager.decode(
            packetManager.encode("powerupSpawn", { id: "inv1", type: code, x: 0, y: 0 }),
        ).powerupSpawn?.[0]
        expect(decoded?.type).toBe(code)
        // The client reverses the code back to "invis" via POWERUP_CODE_TO_TYPE.
        expect(POWERUP_CODE_TO_TYPE[decoded?.type ?? -1]).toBe("invis")
    })

    it("round-trips playerInputs within float16 precision", () => {
        const input = {
            playerId: "cd",
            inputSeq: 4097,
            movementAngle: 1.5,
            movementAmount: 1,
            aimRotation: -2.25,
            useWeapon: true,
            useTactical: false,
            doReload: true,
        }
        const out = packetManager.decode(packetManager.encode("playerInputs", input)).playerInputs?.[0]
        expect(out?.playerId).toBe("cd")
        expect(out?.inputSeq).toBe(4097)
        expect(out?.movementAngle).toBeCloseTo(1.5, 2)
        expect(out?.movementAmount).toBeCloseTo(1, 2)
        expect(out?.aimRotation).toBeCloseTo(-2.25, 2)
        expect(out?.useWeapon).toBe(true)
        expect(out?.useTactical).toBe(false)
        expect(out?.doReload).toBe(true)
    })
})
