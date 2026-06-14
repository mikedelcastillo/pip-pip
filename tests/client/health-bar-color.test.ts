import { describe, expect, it } from "vitest"
import { healthBarColor } from "../../packages/client/src/game/teams"
import { COLORS } from "../../packages/client/src/game/styles"

// healthBarColor(localTeam, playerTeam, isClient, teamMode) -> numeric PIXI color.
// Outside team mode it keeps the original self=GOOD / other=BAD rule; inside
// TEAM_DEATHMATCH it colors by team relative to the local player (teammate GOOD,
// enemy BAD, local player naturally GOOD).
describe("healthBarColor", () => {
    describe("outside team mode (self vs other)", () => {
        it("colors the local player GOOD", () => {
            expect(healthBarColor(-1, -1, true, false)).toBe(COLORS.GOOD)
        })

        it("colors everyone else BAD", () => {
            expect(healthBarColor(-1, -1, false, false)).toBe(COLORS.BAD)
        })

        it("ignores teams entirely when not in team mode", () => {
            // Same team, but team mode off -> the other player is still BAD.
            expect(healthBarColor(0, 0, false, false)).toBe(COLORS.BAD)
            // Local player stays GOOD regardless of teams.
            expect(healthBarColor(0, 1, true, false)).toBe(COLORS.GOOD)
        })
    })

    describe("in team mode (teammate vs enemy)", () => {
        it("colors a teammate GOOD", () => {
            expect(healthBarColor(0, 0, false, true)).toBe(COLORS.GOOD)
        })

        it("colors an enemy BAD", () => {
            expect(healthBarColor(0, 1, false, true)).toBe(COLORS.BAD)
        })

        it("colors the local player (same team as itself) GOOD", () => {
            expect(healthBarColor(1, 1, true, true)).toBe(COLORS.GOOD)
        })

        it("colors an enemy BAD even when that player is somehow the client", () => {
            // Defensive: team relationship wins in team mode regardless of isClient.
            expect(healthBarColor(0, 2, true, true)).toBe(COLORS.BAD)
        })
    })

    describe("unassigned teams fall back to the self/other rule", () => {
        it("treats an unassigned local team as self/other in team mode", () => {
            // localTeam -1: cannot judge teams, so fall back. Other player -> BAD.
            expect(healthBarColor(-1, 0, false, true)).toBe(COLORS.BAD)
            // ...and the local player -> GOOD.
            expect(healthBarColor(-1, 0, true, true)).toBe(COLORS.GOOD)
        })

        it("treats an unassigned player team as self/other in team mode", () => {
            // playerTeam -1: fall back to self/other. Other player -> BAD.
            expect(healthBarColor(0, -1, false, true)).toBe(COLORS.BAD)
            expect(healthBarColor(0, -1, true, true)).toBe(COLORS.GOOD)
        })
    })
})
