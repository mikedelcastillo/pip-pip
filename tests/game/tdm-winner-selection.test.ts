import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGameMode, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"

function makeTdm(maxKills: number){
    const game = new PipPipGame()
    game.setSettings({ mode: PipPipGameMode.TEAM_DEATHMATCH, useTeams: true, friendlyFire: false, numTeams: 2, maxKills })
    game.setPhase(PipPipGamePhase.MATCH)
    return game
}

function addToTeam(game: PipPipGame, id: string, team: number, kills: number){
    const player = new PipPlayer(game, id)
    player.setTeam(team)
    player.score.kills = kills
    return player
}

// Regression: a single tick can credit kills to players on different teams, so two
// teams can cross the combined kill cap before the once-per-tick win check runs.
// The check used find() and declared the LOWEST-INDEX team that reached the cap the
// winner, even if another team was strictly ahead. It must pick the top scorer.
describe("TEAM_DEATHMATCH winner selection on a simultaneous cap cross", () => {
    it("declares the highest-scoring team the winner, not the lowest index", () => {
        const game = makeTdm(10)
        addToTeam(game, "A0", 0, 6)
        addToTeam(game, "B0", 0, 4)   // team 0 combined = 10
        addToTeam(game, "A1", 1, 6)
        addToTeam(game, "B1", 1, 5)   // team 1 combined = 11

        expect(game.teamScore(0)).toBe(10)
        expect(game.teamScore(1)).toBe(11)

        game.checkWinCondition()

        // Team 1 is strictly ahead; it wins even though team 0 also reached the cap.
        expect(game.winnerIds.slice().sort()).toEqual(["A1", "B1"])
    })

    it("breaks an exact tie at the cap toward the lower-index team", () => {
        const game = makeTdm(10)
        addToTeam(game, "A0", 0, 10)  // team 0 = 10
        addToTeam(game, "A1", 1, 10)  // team 1 = 10 (tie)

        game.checkWinCondition()

        expect(game.winnerIds).toEqual(["A0"])
    })

    it("does not end the match until a team reaches the cap", () => {
        const game = makeTdm(10)
        addToTeam(game, "A0", 0, 9)
        addToTeam(game, "A1", 1, 8)

        game.checkWinCondition()

        expect(game.winnerIds).toEqual([])
    })
})
