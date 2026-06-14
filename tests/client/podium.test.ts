import { describe, expect, it, vi } from "vitest"
import type { GameStorePlayer } from "../../packages/client/src/game/store"

// GameOverlayResults pulls in its own Sass module, the ship-asset registry
// (which imports PNGs via Vite's asset pipeline), and the GameChat/GamePlayerList
// children (which drag in a whole tree of Sass modules). This suite only
// exercises the pure podiumTop helper, so we stub the Sass module, the assets
// module, and those two child components to keep the import cheap and DOM/Vite/
// Sass-free. The pure podiumTop export stays real. Mirrors the objective-meter
// suite's component-helper pattern.
vi.mock("../../packages/client/src/components/GameOverlayResults.module.sass", () => ({
    default: new Proxy({}, { get: (_target, key) => String(key) }),
}))
vi.mock("../../packages/client/src/game/assets", () => ({
    shipAssets: {},
}))
vi.mock("../../packages/client/src/components/GameChat", () => ({
    default: () => null,
}))
vi.mock("../../packages/client/src/components/GamePlayerList", () => ({
    default: () => null,
}))

import { podiumTop } from "../../packages/client/src/components/GameOverlayResults"

// Minimal GameStorePlayer factory: only the fields podiumTop reads (id, name,
// score.kills, spectator) matter; the rest are filled with inert defaults.
function makePlayer(overrides: Partial<GameStorePlayer> = {}): GameStorePlayer {
    return {
        id: "id",
        name: "player",
        idle: false,
        spectator: false,
        ping: 0,
        score: { kills: 0, assists: 0, deaths: 0, damage: 0 },
        shipIndex: 0,
        shipType: { id: "", name: "", texture: "" } as unknown as GameStorePlayer["shipType"],
        isHost: false,
        isClient: false,
        spawned: true,
        spawnTimeout: 0,
        ...overrides,
    }
}

// Convenience: a named scorer with a kill count and a stable id (defaults to the
// name, so ties can be asserted by id without colliding).
function scorer(name: string, kills: number, extra: Partial<GameStorePlayer> = {}): GameStorePlayer {
    return makePlayer({ id: name, name, score: { kills, assists: 0, deaths: 0, damage: 0 }, ...extra })
}

describe("podiumTop", () => {
    it("returns an empty podium for an empty roster", () => {
        expect(podiumTop([])).toEqual([])
    })

    it("sorts survivors by kills descending", () => {
        const result = podiumTop([scorer("a", 2), scorer("b", 5), scorer("c", 3)])
        expect(result.map((p) => p.name)).toEqual(["b", "c", "a"])
    })

    it("caps the podium at three players even with more scorers", () => {
        const result = podiumTop([
            scorer("a", 1), scorer("b", 2), scorer("c", 3),
            scorer("d", 4), scorer("e", 5),
        ])
        expect(result.map((p) => p.name)).toEqual(["e", "d", "c"])
    })

    it("keeps equal-kill players in their incoming order (stable ties)", () => {
        // a, b, c all have 4 kills; a stable sort must preserve a, b, c.
        const result = podiumTop([scorer("a", 4), scorer("b", 4), scorer("c", 4)])
        expect(result.map((p) => p.id)).toEqual(["a", "b", "c"])
    })

    it("does not reshuffle a partial tie below the leader", () => {
        // Leader is clear; the two tied runners-up keep input order.
        const result = podiumTop([scorer("x", 9), scorer("a", 3), scorer("b", 3)])
        expect(result.map((p) => p.id)).toEqual(["x", "a", "b"])
    })

    it("drops zero-kill players (no crowning a 0-kill name)", () => {
        const result = podiumTop([scorer("a", 0), scorer("b", 2), scorer("c", 0)])
        expect(result.map((p) => p.name)).toEqual(["b"])
    })

    it("excludes spectators even when they out-kill everyone", () => {
        const result = podiumTop([
            scorer("ghost", 9, { spectator: true }),
            scorer("a", 3),
            scorer("b", 1),
        ])
        expect(result.map((p) => p.name)).toEqual(["a", "b"])
    })

    it("returns a short podium when fewer than three players have kills", () => {
        // Only one real scorer survives the zero-kill / spectator filter.
        const result = podiumTop([
            scorer("solo", 5),
            scorer("idle", 0),
            scorer("ghost", 8, { spectator: true }),
        ])
        expect(result).toHaveLength(1)
        expect(result[0].name).toBe("solo")
    })

    it("does not mutate the input array", () => {
        const input = [scorer("a", 1), scorer("b", 5), scorer("c", 3)]
        const snapshot = input.map((p) => p.name)
        podiumTop(input)
        expect(input.map((p) => p.name)).toEqual(snapshot)
    })
})
