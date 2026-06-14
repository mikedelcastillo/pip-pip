import { describe, expect, it } from "vitest"
import {
    BuffRemaining,
    buffRemainingKey,
    playerActiveBuffs,
} from "../../packages/client/src/game/store"

describe("playerActiveBuffs", () => {
    it("returns no badges when the player holds no buffs", () => {
        expect(playerActiveBuffs({}, "p1")).toEqual([])
    })

    it("returns only the buffs the given player currently holds", () => {
        const remaining: BuffRemaining = {
            [buffRemainingKey("p1", "haste")]: 40,
            [buffRemainingKey("p1", "shield")]: 10,
            // Another player's buff must not leak into p1's badges.
            [buffRemainingKey("p2", "invis")]: 99,
        }
        const types = playerActiveBuffs(remaining, "p1").map((b) => b.type)
        expect(types).toContain("haste")
        expect(types).toContain("shield")
        expect(types).not.toContain("invis")
    })

    it("ignores buffs whose remaining ticks are not positive", () => {
        const remaining: BuffRemaining = {
            [buffRemainingKey("p1", "haste")]: 0,
            [buffRemainingKey("p1", "ricochet")]: 5,
        }
        const types = playerActiveBuffs(remaining, "p1").map((b) => b.type)
        expect(types).toEqual(["ricochet"])
    })

    it("carries each badge's shared label and color through", () => {
        const remaining: BuffRemaining = {
            [buffRemainingKey("p1", "haste")]: 30,
        }
        const badge = playerActiveBuffs(remaining, "p1")[0]
        expect(badge.type).toBe("haste")
        expect(badge.label).toBe("HASTE")
        expect(badge.color).toBe("#33CCFF")
    })

    it("orders badges in the fixed longest-window-first order regardless of map insertion order", () => {
        const remaining: BuffRemaining = {
            [buffRemainingKey("p1", "shield")]: 1,
            [buffRemainingKey("p1", "rapidfire")]: 1,
            [buffRemainingKey("p1", "haste")]: 1,
            [buffRemainingKey("p1", "invis")]: 1,
            [buffRemainingKey("p1", "ricochet")]: 1,
        }
        const order = playerActiveBuffs(remaining, "p1").map((b) => b.type)
        expect(order).toEqual(["haste", "ricochet", "rapidfire", "invis", "shield"])
    })
})
