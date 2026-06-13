import { describe, expect, it } from "vitest"
import { packetManager } from "@pip-pip/game/src/networking/packets"

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
