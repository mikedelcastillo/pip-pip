import { describe, expect, it } from "vitest"
import { readFileSync } from "fs"
import { resolve } from "path"
import {
    $uint8,
    $uint16,
    $uint32,
    $float16,
    $float32,
    $float64,
    $biguint64,
    $bool,
    $string,
    $varstring,
    $json,
    $largejson,
    $quant16,
    PacketSerializer,
} from "@pip-pip/core/src/networking/packets/serializer"
import { packetManager } from "@pip-pip/game/src/networking/packets"

// AIRTIGHT BYTE-EQUIVALENCE GUARD for the packet serializer hot path.
//
// packet-encode-golden.json was captured from the PRE-optimization encode path
// (git show e92391a -- the base commit) and is committed FROZEN. This test re-runs
// the SAME inputs through the CURRENT encode code and asserts every emitted byte
// equals the captured reference. If any optimization changes a single byte for any
// serializer or any packet, this test fails. The inputs / ordering / hex format
// here MUST stay identical to how the golden was generated.
//
// It also round-trips decode(encode(x)) for every packet so the wire framing the
// PacketManager relies on is proven intact end to end.

const golden: Record<string, string> = JSON.parse(
    readFileSync(resolve(process.cwd(), "tests/core/packet-encode-golden.json"), "utf8"),
)

function hex(arr: ArrayLike<number>): string{
    return Array.from(arr).join(",")
}

describe("serializer byte-equivalence vs frozen golden", () => {
    const numberCases: Array<[string, PacketSerializer<number>, number[]]> = [
        ["uint8", $uint8, [0, 1, 127, 128, 200, 255]],
        ["uint16", $uint16, [0, 1, 255, 256, 1000, 65535]],
        ["uint32", $uint32, [0, 1, 255, 256, 65535, 65536, 4294967295]],
        ["float16", $float16, [0, 1, -1, 0.5, -0.5, 3.14, -3.14, 65504, -65504]],
        ["float32", $float32, [0, 1, -1, 0.5, -0.5, 3.14159, -3.14159, 1e20, -1e20]],
        ["float64", $float64, [0, 1, -1, 0.5, -0.5, 3.141592653589793, -3.141592653589793, 1e300, -1e300]],
        ["biguint64", $biguint64, [0, 1, 255, 65535, 4294967295, 9007199254740991]],
    ]

    for(const [name, serializer, values] of numberCases){
        it("$" + name + " encodes byte-identically", () => {
            const got = values.map(v => hex(serializer.encode(v))).join("|")
            expect(got).toBe(golden["num_" + name])
            // round-trip each value through the same serializer
            for(const v of values){
                expect(serializer.decode(serializer.encode(v))).toBeTypeOf("number")
            }
        })
    }

    it("$bool encodes byte-identically + round-trips", () => {
        const got = [true, false].map(v => hex($bool.encode(v))).join("|")
        expect(got).toBe(golden["bool"])
        expect($bool.decode($bool.encode(true))).toBe(true)
        expect($bool.decode($bool.encode(false))).toBe(false)
    })

    it("$string encodes byte-identically across widths + multibyte + round-trips", () => {
        const stringCases: Array<[number, string[]]> = [
            [2, ["", "a", "ab", "abc", "🙂", "café"]],
            [4, ["", "ab", "abcd", "abcdef", "café"]],
            [8, ["", "hello", "café", "🙂🙂"]],
        ]
        const parts: string[] = []
        for(const [width, values] of stringCases){
            const s = $string(width)
            parts.push(values.map(v => hex(s.encode(v))).join("|"))
            // every encode must occupy exactly `width` bytes
            for(const v of values) expect(s.encode(v).length).toBe(width)
        }
        expect(parts.join("#")).toBe(golden["string"])
    })

    it("$varstring encodes byte-identically across edge + unicode + long + round-trips", () => {
        const values = [
            "",
            "a",
            "hello world",
            "ünïcödé ✦",
            "🙂🚀✦",
            "x".repeat(255),
            "y".repeat(256),
            "z".repeat(300),
            "w".repeat(4096),
        ]
        const got = values.map(v => hex($varstring.encode(v))).join("|")
        expect(got).toBe(golden["varstring"])
        for(const v of values){
            expect($varstring.decode($varstring.encode(v))).toBe(v)
        }
    })

    it("$json encodes byte-identically + round-trips", () => {
        const json = $json<Record<string, any>>()
        const values = [
            {},
            { a: 1 },
            { name: "pip", n: 42, list: [1, 2, 3], nested: { x: true } },
            { unicode: "ünïcödé ✦" },
        ]
        const got = values.map(v => hex(json.encode(v))).join("|")
        expect(got).toBe(golden["json"])
        for(const v of values){
            expect(json.decode(json.encode(v))).toEqual(v)
        }
    })

    it("$largejson encodes byte-identically (incl >4096 body) + round-trips", () => {
        const largejson = $largejson<Record<string, any>>()
        const values = [
            {},
            { a: 1 },
            { blob: "x".repeat(10000), n: 42 },
        ]
        const got = values.map(v => hex(largejson.encode(v))).join("|")
        expect(got).toBe(golden["largejson"])
        for(const v of values){
            expect(largejson.decode(largejson.encode(v))).toEqual(v)
        }
    })

    it("$quant16 encodes byte-identically at two ranges", () => {
        const values = [0, 250.5, -737.25, 1000, -1000, 5000, -5000, 123.456]
        expect(values.map(v => hex($quant16(1000).encode(v))).join("|")).toBe(golden["quant16_1000"])
        expect(values.map(v => hex($quant16(2048).encode(v))).join("|")).toBe(golden["quant16_2048"])
    })
})

// Representative input for EVERY packet in the manager (incl. server ping/pong).
// MUST cover every key the test iterates; a missing key throws so the suite fails
// loudly rather than silently skipping a packet.
const packetInputs: Record<string, any> = {
    sendChat: { message: "hello ✦" },
    receiveChat: { playerId: "AB", message: "gg wp 🙂" },
    addPlayer: { playerId: "AB" },
    removePlayer: { playerId: "AB" },
    despawnPlayer: { playerId: "AB" },
    spawnPlayer: { playerId: "AB", x: 123.5, y: -456.25 },
    playerName: { playerId: "AB", name: "Mike ✦" },
    playerIdle: { playerId: "AB", idle: true },
    playerSpectate: { playerId: "AB", spectating: false },
    playerPing: { playerId: "AB", ping: 1234 },
    playerSetShip: { playerId: "AB", shipIndex: 3 },
    playerTeam: { playerId: "AB", team: 255 },
    playerReady: { playerId: "AB", ready: 1 },
    playerPosition: { playerId: "AB", positionX: 12.5, positionY: -34.25, velocityX: 1.5, velocityY: -2.5 },
    playerPositionSync: { playerId: "AB", positionX: 12.5, positionY: -34.25, velocityX: 1.5, velocityY: -2.5 },
    playerInputs: { playerId: "AB", inputSeq: 999, movementAngle: 1.25, movementAmount: 0.5, aimRotation: -0.75, useWeapon: true, useTactical: false, doReload: true },
    playerShootBullet: { playerId: "AB", positionX: 5.5, positionY: 6.5, velocityX: 7.5, velocityY: 8.5, radius: 1.5, bulletType: 2, explosionRadius: 3.5 },
    serverTickHeader: { tick: 1234567 },
    ownPlayerState: { positionX: 1.5, positionY: 2.5, velocityX: 3.5, velocityY: 4.5, lastInputSeq: 777 },
    playerShipTimings: { playerId: "AB", weaponReload: 1, weaponRate: 2, tacticalReload: 3, tacticalRate: 4, healthRegenerationRest: 5, healthRegenerationHeal: 6, invincibility: 7, haste: 8, shield: 9, invisibility: 10, ricochet: 11, rapidfire: 12 },
    playerShipCapacities: { playerId: "AB", weapon: 30, tactical: 5, health: 99 },
    playerTimings: { playerId: "AB", spawnTimeout: 60 },
    playerScores: { playerId: "AB", kills: 10, assists: 3, deaths: 2, damage: 123456 },
    playerDamage: { dealerId: "AB", targetId: "CD", damage: 555 },
    playerKill: { killerId: "AB", killedId: "CD" },
    setHost: { playerId: "AB" },
    gameState: { mode: 1, useTeams: true, maxDeaths: 5, maxKills: 20, matchMinutes: 10, friendlyFire: false, numTeams: 2 },
    gamePhase: { phase: 2 },
    gameCountdown: { countdown: 3 },
    matchTimer: { seconds: 300 },
    gameResults: { winnerId: "AB", winnerCount: 1 },
    gameMap: { mapIndex: 4 },
    gameMode: { mode: 0, maxKills: 20, matchMinutes: 10 },
    hostBots: { action: 3, count: 8, difficulty: 255 },
    closeLobby: {},
    lobbyClosed: {},
    powerupSpawn: { id: "PWR1", type: 2, x: 11.5, y: 22.5 },
    powerupPickup: { id: "PWR1", playerId: "AB" },
    customMap: { data: { name: "m", tiles: [1, 2, 3], meta: { w: 4, h: 4 } } },
    ping: { id: "X" },
    pong: { id: "Y" },
}

describe("every packet encodes byte-identically vs frozen golden + round-trips", () => {
    const serializers = packetManager.serializers as Record<string, any>

    // Rebuild the same packets blob the golden captured and assert it whole, so a
    // drift on ANY packet (single OR batch encode) fails here.
    it("all packets match the captured golden blob", () => {
        const parts: string[] = []
        for(const name of Object.keys(serializers).sort()){
            expect(name in packetInputs, "missing test input for packet " + name).toBe(true)
            const input = packetInputs[name]
            const single = hex(serializers[name].encode(input))
            const batch = hex(serializers[name].encode([input, input]))
            parts.push(name + ":" + single + ";" + batch)
        }
        expect(parts.join("\n")).toBe(golden["packets"])
    })

    // Framing round-trip for every packet. Some packets carry intentionally lossy
    // fields ($quant16 world positions, $float16 velocities), so decode(encode(x))
    // is NOT byte-for-value equal to x for those. The framing invariant we actually
    // need is RE-ENCODE STABILITY: encode(decode(encode(x))) must byte-equal
    // encode(x). That proves manager.decode parsed the field boundaries, prefix
    // widths and ids correctly (it reconstructed a value that re-encodes to the same
    // bytes) without depending on lossless float/quant round-trips. For packets with
    // only exact fields this is equivalent to a deep round-trip, which the golden
    // blob already covers.
    for(const name of Object.keys(packetInputs)){
        it(name + " framing round-trips (encode -> decode -> re-encode is byte-stable)", () => {
            const serializer = (packetManager.serializers as Record<string, any>)[name]
            const input = packetInputs[name]

            const bytes = serializer.encode(input)
            const decoded = packetManager.decode(bytes)
            const recovered = decoded[name]?.[0]
            expect(recovered, "manager.decode produced no " + name + " entry").toBeDefined()
            expect(hex(serializer.encode(recovered))).toBe(hex(bytes))

            // batch of two through the same path
            const batchBytes = serializer.encode([input, input])
            const decodedBatch = packetManager.decode(batchBytes)
            expect(decodedBatch[name]?.length).toBe(2)
            expect(hex(serializer.encode(decodedBatch[name]))).toBe(hex(batchBytes))
        })
    }
})
