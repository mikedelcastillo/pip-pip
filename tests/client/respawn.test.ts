import { describe, expect, it } from "vitest"
import { ticksToSeconds } from "../../packages/client/src/game/store"

// tps mirrors PipPipGame.tps (20) used by the respawn overlay + player list.
const TPS = 20

describe("ticksToSeconds", () => {
    it("rounds a partial second UP to whole seconds", () => {
        // 1 tick at 20tps is 0.05s, which must read as "1s" remaining.
        expect(ticksToSeconds(1, TPS)).toBe(1)
        expect(ticksToSeconds(19, TPS)).toBe(1)
    })

    it("returns whole seconds exactly on the boundary", () => {
        expect(ticksToSeconds(20, TPS)).toBe(1)
        expect(ticksToSeconds(40, TPS)).toBe(2)
        expect(ticksToSeconds(60, TPS)).toBe(3)
    })

    it("returns 0 for a spent timer", () => {
        expect(ticksToSeconds(0, TPS)).toBe(0)
    })

    it("clamps negative tick counts at 0 (never a negative countdown)", () => {
        expect(ticksToSeconds(-1, TPS)).toBe(0)
        expect(ticksToSeconds(-100, TPS)).toBe(0)
    })

    it("returns 0 when tps is non-positive (no divide-by-zero)", () => {
        expect(ticksToSeconds(40, 0)).toBe(0)
        expect(ticksToSeconds(40, -20)).toBe(0)
    })

    it("rounds up a multi-second partial timer", () => {
        // 41 ticks at 20tps is 2.05s, which must read as "3s" remaining.
        expect(ticksToSeconds(41, TPS)).toBe(3)
    })
})
