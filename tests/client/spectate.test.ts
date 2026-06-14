import { describe, expect, it } from "vitest"
import {
    SpectatablePlayer,
    nextSpectateTargetId,
    resolveSpectateTarget,
    spectateTargets,
} from "../../packages/client/src/game/spectate"

// Tiny factory for a spectatable player. Defaults to a live, watchable target so
// each test only states the fields it cares about.
function player(id: string, overrides: Partial<SpectatablePlayer> = {}): SpectatablePlayer {
    return { id, spawned: true, spectator: false, ...overrides }
}

describe("spectateTargets", () => {
    it("keeps only spawned, non-spectating players", () => {
        const players = [
            player("a"),
            player("b", { spawned: false }),
            player("c", { spectator: true }),
            player("d"),
        ]
        expect(spectateTargets(players).map((p) => p.id)).toEqual(["a", "d"])
    })

    it("returns targets in stable id order regardless of input order", () => {
        const players = [player("c"), player("a"), player("b")]
        expect(spectateTargets(players).map((p) => p.id)).toEqual(["a", "b", "c"])
    })

    it("returns an empty list when nobody is watchable", () => {
        const players = [player("a", { spawned: false }), player("b", { spectator: true })]
        expect(spectateTargets(players)).toEqual([])
    })
})

describe("nextSpectateTargetId", () => {
    const players = [player("a"), player("b"), player("c")]

    it("cycles forward in id order", () => {
        expect(nextSpectateTargetId(players, "a", 1)).toBe("b")
        expect(nextSpectateTargetId(players, "b", 1)).toBe("c")
    })

    it("wraps forward past the last target", () => {
        expect(nextSpectateTargetId(players, "c", 1)).toBe("a")
    })

    it("cycles backward in id order", () => {
        expect(nextSpectateTargetId(players, "c", -1)).toBe("b")
        expect(nextSpectateTargetId(players, "b", -1)).toBe("a")
    })

    it("wraps backward past the first target", () => {
        expect(nextSpectateTargetId(players, "a", -1)).toBe("c")
    })

    it("treats dir >= 0 as forward and dir < 0 as backward", () => {
        expect(nextSpectateTargetId(players, "a", 0)).toBe("b")
        expect(nextSpectateTargetId(players, "a", 5)).toBe("b")
        expect(nextSpectateTargetId(players, "a", -5)).toBe("c")
    })

    it("lands on the first target when the current id is unknown", () => {
        expect(nextSpectateTargetId(players, "", 1)).toBe("a")
        expect(nextSpectateTargetId(players, "gone", -1)).toBe("a")
    })

    it("skips players who are not watchable", () => {
        const mixed = [
            player("a"),
            player("b", { spawned: false }),
            player("c"),
        ]
        // From "a" forward, "b" is dead so the next watchable target is "c".
        expect(nextSpectateTargetId(mixed, "a", 1)).toBe("c")
    })

    it("returns empty string when there is nobody to watch", () => {
        const none = [player("a", { spawned: false })]
        expect(nextSpectateTargetId(none, "a", 1)).toBe("")
        expect(nextSpectateTargetId([], "", 1)).toBe("")
    })

    it("returns the single target for any direction when only one is watchable", () => {
        const one = [player("only")]
        expect(nextSpectateTargetId(one, "only", 1)).toBe("only")
        expect(nextSpectateTargetId(one, "only", -1)).toBe("only")
    })
})

describe("resolveSpectateTarget", () => {
    it("returns the chosen player when it is still a valid target", () => {
        const players = [player("a"), player("b")]
        expect(resolveSpectateTarget(players, "b")?.id).toBe("b")
    })

    it("falls back to the first watchable target when the choice despawned", () => {
        const players = [player("a"), player("b", { spawned: false })]
        expect(resolveSpectateTarget(players, "b")?.id).toBe("a")
    })

    it("falls back when the chosen player is now spectating", () => {
        const players = [player("a"), player("b", { spectator: true })]
        expect(resolveSpectateTarget(players, "b")?.id).toBe("a")
    })

    it("falls back when the chosen id is unknown", () => {
        const players = [player("a"), player("b")]
        expect(resolveSpectateTarget(players, "gone")?.id).toBe("a")
    })

    it("returns undefined when nobody is watchable", () => {
        const players = [player("a", { spawned: false })]
        expect(resolveSpectateTarget(players, "a")).toBeUndefined()
        expect(resolveSpectateTarget([], "")).toBeUndefined()
    })
})
