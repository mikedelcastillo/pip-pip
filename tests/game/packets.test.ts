import { describe, expect, it } from "vitest"
import {
    packetManager,
    encodeTeam,
    decodeTeam,
    TEAM_WIRE_UNASSIGNED,
    HOST_BOTS_ACTION_ADD,
    HOST_BOTS_ACTION_REMOVE,
    HOST_BOTS_ACTION_CLEAR,
    HOST_BOTS_ACTION_FILL,
    HOST_BOTS_DIFFICULTY_MIXED,
} from "@pip-pip/game/src/networking/packets"
import { BUFF_TYPE_TO_CODE, BUFF_CODE_TO_TYPE } from "@pip-pip/game/src/logic/buff"

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

    it("round-trips playerTeam for both real teams (string id + uint8)", () => {
        const t0 = packetManager.decode(
            packetManager.encode("playerTeam", { playerId: "ab", team: 0 }),
        )
        expect(t0.playerTeam?.[0]).toEqual({ playerId: "ab", team: 0 })

        const t1 = packetManager.decode(
            packetManager.encode("playerTeam", { playerId: "cd", team: 1 }),
        )
        expect(t1.playerTeam?.[0]).toEqual({ playerId: "cd", team: 1 })
    })

    it("maps the unassigned team (-1) to/from its wire sentinel (255)", () => {
        // -1 cannot ride a uint8, so encodeTeam sends 255 and decodeTeam reverses
        // it. Real teams pass straight through.
        expect(encodeTeam(-1)).toBe(TEAM_WIRE_UNASSIGNED)
        expect(encodeTeam(0)).toBe(0)
        expect(encodeTeam(1)).toBe(1)
        expect(decodeTeam(TEAM_WIRE_UNASSIGNED)).toBe(-1)
        expect(decodeTeam(0)).toBe(0)
        expect(decodeTeam(1)).toBe(1)

        // Full wire round-trip of the sentinel through the packet itself.
        const decoded = packetManager.decode(
            packetManager.encode("playerTeam", { playerId: "ef", team: encodeTeam(-1) }),
        )
        expect(decoded.playerTeam?.[0]?.team).toBe(TEAM_WIRE_UNASSIGNED)
        expect(decodeTeam(decoded.playerTeam?.[0]?.team ?? 0)).toBe(-1)
    })

    it("round-trips playerReady encoding ready true->1 and false->0", () => {
        // The lobby "ready up" boolean rides as a uint8 0/1, so a round-trip must
        // preserve the exact value on both states (and never wrap out of range).
        const on = packetManager.decode(
            packetManager.encode("playerReady", { playerId: "ab", ready: 1 }),
        )
        expect(on.playerReady?.[0]).toEqual({ playerId: "ab", ready: 1 })

        const off = packetManager.decode(
            packetManager.encode("playerReady", { playerId: "cd", ready: 0 }),
        )
        expect(off.playerReady?.[0]).toEqual({ playerId: "cd", ready: 0 })
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

    it("round-trips hostBots for every action + difficulty (host bot config)", () => {
        // add N HARD bots
        const add = packetManager.decode(
            packetManager.encode("hostBots", { action: HOST_BOTS_ACTION_ADD, count: 3, difficulty: 2 }),
        )
        expect(add.hostBots?.[0]).toEqual({ action: HOST_BOTS_ACTION_ADD, count: 3, difficulty: 2 })

        // remove 1 (difficulty is irrelevant - the "mixed" filler rides along)
        const remove = packetManager.decode(
            packetManager.encode("hostBots", { action: HOST_BOTS_ACTION_REMOVE, count: 1, difficulty: HOST_BOTS_DIFFICULTY_MIXED }),
        )
        expect(remove.hostBots?.[0]).toEqual({ action: HOST_BOTS_ACTION_REMOVE, count: 1, difficulty: HOST_BOTS_DIFFICULTY_MIXED })

        // clear (count/difficulty ignored by the server, still round-trip exactly)
        const clear = packetManager.decode(
            packetManager.encode("hostBots", { action: HOST_BOTS_ACTION_CLEAR, count: 0, difficulty: HOST_BOTS_DIFFICULTY_MIXED }),
        )
        expect(clear.hostBots?.[0]).toEqual({ action: HOST_BOTS_ACTION_CLEAR, count: 0, difficulty: HOST_BOTS_DIFFICULTY_MIXED })

        // fill with mixed difficulty (255 sentinel survives the uint8 wire)
        const fill = packetManager.decode(
            packetManager.encode("hostBots", { action: HOST_BOTS_ACTION_FILL, count: 0, difficulty: HOST_BOTS_DIFFICULTY_MIXED }),
        )
        expect(fill.hostBots?.[0]).toEqual({ action: HOST_BOTS_ACTION_FILL, count: 0, difficulty: HOST_BOTS_DIFFICULTY_MIXED })
        expect(fill.hostBots?.[0]?.difficulty).toBe(255)
    })

    it("round-trips gameState including numTeams (N-team support, uint8)", () => {
        // numTeams rides the settings wire so every client renders the active
        // number of teams. The whole settings object must survive a round-trip.
        const settings = {
            mode: 2,
            useTeams: true,
            maxDeaths: 0,
            maxKills: 30,
            matchMinutes: 5,
            friendlyFire: false,
            numTeams: 4,
        }
        const out = packetManager.decode(packetManager.encode("gameState", settings)).gameState?.[0]
        expect(out).toEqual(settings)
        expect(out?.numTeams).toBe(4)
    })

    it("round-trips closeLobby (payloadless host close request)", () => {
        // The host sends this to disband the lobby; it carries no fields, so a
        // round-trip yields a single empty object. The presence of the packet is
        // the whole signal (the server gates it on the host identity).
        const decoded = packetManager.decode(packetManager.encode("closeLobby", {}))
        expect(decoded.closeLobby).toHaveLength(1)
        expect(decoded.closeLobby?.[0]).toEqual({})
    })

    it("round-trips lobbyClosed (payloadless server notice)", () => {
        // Broadcast to every client when the host closes the lobby. Like
        // closeLobby it is payloadless - the client reacts to its arrival alone
        // (showing a fixed message and navigating home).
        const decoded = packetManager.decode(packetManager.encode("lobbyClosed", {}))
        expect(decoded.lobbyClosed).toHaveLength(1)
        expect(decoded.lobbyClosed?.[0]).toEqual({})
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

    it("round-trips buffSpawn (string id + uint8 type + quantized position)", () => {
        const decoded = packetManager.decode(
            packetManager.encode("buffSpawn", { id: "ab12", type: 1, x: 320, y: -480 }),
        ).buffSpawn?.[0]
        expect(decoded?.id).toBe("ab12")
        expect(decoded?.type).toBe(1)
        // $worldPos is fixed-point, so positions come back within quantization noise.
        expect(decoded?.x).toBeCloseTo(320, 0)
        expect(decoded?.y).toBeCloseTo(-480, 0)
    })

    it("round-trips buffPickup exactly (buff id + player id)", () => {
        const decoded = packetManager.decode(
            packetManager.encode("buffPickup", { id: "wxyz", playerId: "ab" }),
        )
        expect(decoded.buffPickup?.[0]).toEqual({ id: "wxyz", playerId: "ab" })
    })

    it("round-trips playerShipTimings including haste/shield/invisibility/ricochet/rapidfire (uint8)", () => {
        const timings = {
            playerId: "ab",
            weaponReload: 12,
            weaponRate: 3,
            tacticalReload: 100,
            tacticalRate: 20,
            healthRegenerationRest: 99,
            healthRegenerationHeal: 5,
            invincibility: 60,
            haste: 200,
            shield: 170,
            invisibility: 180,
            ricochet: 200,
            rapidfire: 200,
            glassCannon: 200,
            heavyMag: 200,
            regen: 200,
            lifesteal: 200,
        }
        const out = packetManager.decode(packetManager.encode("playerShipTimings", timings)).playerShipTimings?.[0]
        expect(out).toEqual(timings)
        // Durations must fit uint8 (<= 255) so they survive the wire untouched.
        expect(out?.haste).toBe(200)
        expect(out?.shield).toBe(170)
        // invisibility is a distinct timer from invincibility - both round-trip.
        expect(out?.invisibility).toBe(180)
        expect(out?.invincibility).toBe(60)
        // ricochet now rides the wire too (part 3b) so the tactical feed + remote
        // ships know its remaining window.
        expect(out?.ricochet).toBe(200)
        // rapidfire rides the wire alongside the others so remote ships + the
        // tactical feed see its window; the rate scaling is applied locally.
        expect(out?.rapidfire).toBe(200)
    })

    it("round-trips the invis buff wire code through buffSpawn", () => {
        const code = BUFF_TYPE_TO_CODE.invis
        const decoded = packetManager.decode(
            packetManager.encode("buffSpawn", { id: "inv1", type: code, x: 0, y: 0 }),
        ).buffSpawn?.[0]
        expect(decoded?.type).toBe(code)
        // The client reverses the code back to "invis" via BUFF_CODE_TO_TYPE.
        expect(BUFF_CODE_TO_TYPE[decoded?.type ?? -1]).toBe("invis")
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
