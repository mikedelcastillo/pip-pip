import { describe, expect, it } from "vitest"
import {
    PipPipGame,
    PipPipGameMode,
    PipPipGamePhase,
    MIN_TEAMS,
    MAX_TEAMS,
    clampNumTeams,
    teamIndices,
} from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"

// N-team support generalizes TEAM_DEATHMATCH from the original hard-coded 2 to any
// settings.numTeams in [MIN_TEAMS, MAX_TEAMS]. These tests pin the generalized
// assignTeams (round-robin split), teamScore + win condition over N teams, and the
// numTeams clamp. The classic 2-team behaviour is covered by team-deathmatch.test.ts.
function makeTeamGame(){
    return new PipPipGame({ setScores: true, triggerPhases: true, triggerSpawns: true })
}

function startLiveTeamMatch(game: PipPipGame, maxKills: number){
    game.setSettings({ mode: PipPipGameMode.TEAM_DEATHMATCH, useTeams: true, friendlyFire: false, maxKills })
    game.startMatch()
    game.setPhase(PipPipGamePhase.MATCH)
}

describe("clampNumTeams", () => {
    it("clamps to the supported range and to a whole number", () => {
        expect(clampNumTeams(1)).toBe(MIN_TEAMS)
        expect(clampNumTeams(0)).toBe(MIN_TEAMS)
        expect(clampNumTeams(-5)).toBe(MIN_TEAMS)
        expect(clampNumTeams(99)).toBe(MAX_TEAMS)
        expect(clampNumTeams(3.9)).toBe(3)
        expect(clampNumTeams(NaN)).toBe(MIN_TEAMS)
    })
})

describe("teamIndices", () => {
    it("lists [0..n-1] for a clamped team count", () => {
        expect(teamIndices(2)).toEqual([0, 1])
        expect(teamIndices(4)).toEqual([0, 1, 2, 3])
        // Clamped: a too-large count never exceeds MAX_TEAMS.
        expect(teamIndices(99)).toEqual([0, 1, 2, 3, 4, 5])
    })
})

describe("setSettings clamps numTeams", () => {
    it("never lands an out-of-range team count", () => {
        const game = new PipPipGame()
        game.setSettings({ numTeams: 99 })
        expect(game.settings.numTeams).toBe(MAX_TEAMS)
        game.setSettings({ numTeams: 1 })
        expect(game.settings.numTeams).toBe(MIN_TEAMS)
    })

    it("defaults to MIN_TEAMS (2) so existing matches are unchanged", () => {
        expect(new PipPipGame().settings.numTeams).toBe(MIN_TEAMS)
    })
})

describe("assignTeams splits round-robin into N teams", () => {
    it("splits 6 players evenly across 3 teams", () => {
        const game = makeTeamGame()
        const ids = ["AA", "BB", "CC", "DD", "EE", "FF"]
        for(const id of ids) new PipPlayer(game, id)
        game.setSettings({ numTeams: 3 })

        startLiveTeamMatch(game, 25)

        // Every player lands on a real team in [0, 3).
        for(const id of ids){
            expect(teamIndices(3)).toContain(game.players[id].team)
        }
        // 6 / 3 -> exactly 2 per team.
        expect(game.teamPlayers(0).length).toBe(2)
        expect(game.teamPlayers(1).length).toBe(2)
        expect(game.teamPlayers(2).length).toBe(2)
    })

    it("balances to within one when the count does not divide evenly", () => {
        const game = makeTeamGame()
        const ids = ["AA", "BB", "CC", "DD", "EE"]
        for(const id of ids) new PipPlayer(game, id)
        game.setSettings({ numTeams: 3 })

        startLiveTeamMatch(game, 25)

        const sizes = teamIndices(3).map(team => game.teamPlayers(team).length)
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(5)
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
    })

    it("puts a mid-match joiner on the SMALLEST of the N teams", () => {
        const game = makeTeamGame()
        for(const id of ["AA", "BB", "CC"]) new PipPlayer(game, id)
        game.setSettings({ numTeams: 3 })
        startLiveTeamMatch(game, 25)

        // Force teams 0 and 1 full, team 2 empty, then join: the joiner fills 2.
        game.players.AA.setTeam(0)
        game.players.BB.setTeam(0)
        game.players.CC.setTeam(1)
        const joiner = new PipPlayer(game, "DD")
        game.addPlayerMidGame(joiner)
        expect(joiner.team).toBe(2)
    })
})

describe("teamScore + win condition over N teams", () => {
    it("sums each team's kills across N teams", () => {
        const game = makeTeamGame()
        const players = ["AA", "BB", "CC"].map(id => new PipPlayer(game, id))
        game.setSettings({ numTeams: 3 })
        startLiveTeamMatch(game, 25)

        players[0].setTeam(0)
        players[1].setTeam(1)
        players[2].setTeam(2)
        players[0].score.kills = 4
        players[1].score.kills = 7
        players[2].score.kills = 2

        expect(game.teamScore(0)).toBe(4)
        expect(game.teamScore(1)).toBe(7)
        expect(game.teamScore(2)).toBe(2)
    })

    it("ends the match when the FIRST of N teams reaches the cap", () => {
        const game = makeTeamGame()
        const players = ["AA", "BB", "CC"].map(id => new PipPlayer(game, id))
        game.setSettings({ numTeams: 3 })
        startLiveTeamMatch(game, 5)

        players[0].setTeam(0)
        players[1].setTeam(1)
        players[2].setTeam(2)
        // Team 2 hits the cap; teams 0 and 1 trail.
        players[0].score.kills = 3
        players[1].score.kills = 4
        players[2].score.kills = 5

        game.update()

        expect(game.phase).toBe(PipPipGamePhase.RESULTS)
        expect(game.winnerIds).toEqual([players[2].id])
    })

    it("does not end while every team is below the cap", () => {
        const game = makeTeamGame()
        const players = ["AA", "BB", "CC"].map(id => new PipPlayer(game, id))
        game.setSettings({ numTeams: 3 })
        startLiveTeamMatch(game, 10)

        players.forEach((p, i) => p.setTeam(i))
        players[0].score.kills = 9
        players[1].score.kills = 8
        players[2].score.kills = 7

        game.update()

        expect(game.phase).toBe(PipPipGamePhase.MATCH)
        expect(game.winnerIds).toEqual([])
    })
})
