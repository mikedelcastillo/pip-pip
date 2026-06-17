import { describe, expect, it } from "vitest"
import { teamColor, teamName, teamScore, teamIndices, MAX_TEAM_COLORS, isTeamMode } from "@pip-pip/client/src/game/teams"
import { teamIndices as gameTeamIndices, MAX_TEAMS, PipPipGameMode } from "@pip-pip/game/src/logic"

// The client team helpers feed the N-team HUD leaderboard + scoreboard. The key
// guard here is the cross-module one: client teamIndices must be the game's exact
// function, not a reimplementation that can drift on the clamp bounds.
describe("client team helpers", () => {
    it("derives the color cap from the game's MAX_TEAMS", () => {
        expect(MAX_TEAM_COLORS).toBe(MAX_TEAMS)
    })

    it("colors and names real teams; falls back for unassigned (-1)", () => {
        expect(teamColor(0)).toMatch(/^#/)
        expect(teamColor(-1)).toBe("#FFFFFF")
        expect(teamName(0)).not.toBe("")
        expect(teamName(-1)).toBe("")
    })

    it("teamScore sums kills for the matching team only", () => {
        const players = [
            { team: 0, score: { kills: 3 } },
            { team: 1, score: { kills: 5 } },
            { team: 0, score: { kills: 2 } },
        ] as never[]
        expect(teamScore(players, 0)).toBe(5)
        expect(teamScore(players, 1)).toBe(5)
        expect(teamScore(players, 2)).toBe(0)
    })

    it("re-exports the game's teamIndices verbatim (no client-side drift)", () => {
        for(const n of [0, 1, 2, 3, 6, 7, NaN]){
            expect(teamIndices(n)).toEqual(gameTeamIndices(n))
        }
        expect(teamIndices).toBe(gameTeamIndices)
    })

    it("isTeamMode is true only for TEAM_DEATHMATCH", () => {
        expect(isTeamMode(PipPipGameMode.TEAM_DEATHMATCH)).toBe(true)
        expect(isTeamMode(PipPipGameMode.DEATHMATCH)).toBe(false)
    })
})
