import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGameMode, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"

// Win conditions are gated on the authoritative scoring + phase flags the server
// uses. setScores owns scoring/the match clock; triggerPhases lets the game drive
// its own phase transitions (into RESULTS, then back to SETUP). The other gameplay
// flags are irrelevant here (we set scores directly and call update() to advance
// the win-condition check), so only the gates under test are enabled.
function makeAuthoritativeGame(){
    return new PipPipGame({ setScores: true, triggerPhases: true })
}

// Put the game straight into a live MATCH for the given mode/target, bypassing
// the COUNTDOWN. startMatch() arms the KILL_FRENZY clock from settings, so set
// the mode/targets BEFORE calling it; setPhase then jumps past the countdown.
function startLiveMatch(game: PipPipGame, settings: Parameters<PipPipGame["setSettings"]>[0]){
    game.setSettings(settings)
    game.startMatch()
    game.setPhase(PipPipGamePhase.MATCH)
}

describe("DEATHMATCH win condition", () => {
    it("ends the match and records the winner when a player reaches maxKills", () => {
        const game = makeAuthoritativeGame()
        const winner = new PipPlayer(game, "AA")
        const loser = new PipPlayer(game, "BB")
        startLiveMatch(game, { mode: PipPipGameMode.DEATHMATCH, maxKills: 5 })

        loser.score.kills = 2
        winner.score.kills = 5

        // The win-condition check runs at the top of update().
        game.update()

        expect(game.phase).toBe(PipPipGamePhase.RESULTS)
        expect(game.winnerIds).toEqual(["AA"])
    })

    it("does not end the match before any player reaches maxKills", () => {
        const game = makeAuthoritativeGame()
        const a = new PipPlayer(game, "AA")
        new PipPlayer(game, "BB")
        startLiveMatch(game, { mode: PipPipGameMode.DEATHMATCH, maxKills: 5 })

        a.score.kills = 4

        game.update()

        expect(game.phase).toBe(PipPipGamePhase.MATCH)
        expect(game.winnerIds).toEqual([])
    })

    it("returns to SETUP after the results hold elapses", () => {
        const game = makeAuthoritativeGame()
        const winner = new PipPlayer(game, "AA")
        startLiveMatch(game, { mode: PipPipGameMode.DEATHMATCH, maxKills: 1 })

        winner.score.kills = 1
        game.update()
        expect(game.phase).toBe(PipPipGamePhase.RESULTS)

        // Drain the RESULTS hold timer; the game then drops back to the lobby.
        for(let i = 0; i < game.RESULTS_HOLD_TICKS + 1; i++){
            game.update()
        }

        expect(game.phase).toBe(PipPipGamePhase.SETUP)
    })
})

describe("KILL_FRENZY win condition", () => {
    it("ends when the timer elapses and picks the top scorer", () => {
        const game = makeAuthoritativeGame()
        const top = new PipPlayer(game, "AA")
        const other = new PipPlayer(game, "BB")
        startLiveMatch(game, { mode: PipPipGameMode.KILL_FRENZY, matchMinutes: 1 })

        other.score.kills = 3
        top.score.kills = 7

        // The match is live with time on the clock, so it should still be running.
        expect(game.phase).toBe(PipPipGamePhase.MATCH)
        expect(game.matchTimer).toBeGreaterThan(0)

        // Run the clock to zero. update() ticks matchTimer down then checks the
        // win condition, so the match ends on the tick the clock hits 0.
        const ticks = game.matchTimer + 1
        for(let i = 0; i < ticks; i++){
            if(game.phase !== PipPipGamePhase.MATCH) break
            game.update()
        }

        expect(game.phase).toBe(PipPipGamePhase.RESULTS)
        expect(game.winnerIds).toEqual(["AA"])
    })

    it("records every tied top scorer as a winner when time runs out", () => {
        const game = makeAuthoritativeGame()
        const a = new PipPlayer(game, "AA")
        const b = new PipPlayer(game, "BB")
        new PipPlayer(game, "CC")
        startLiveMatch(game, { mode: PipPipGameMode.KILL_FRENZY, matchMinutes: 1 })

        // AA and BB tie at the top; CC trails.
        a.score.kills = 4
        b.score.kills = 4

        const ticks = game.matchTimer + 1
        for(let i = 0; i < ticks; i++){
            if(game.phase !== PipPipGamePhase.MATCH) break
            game.update()
        }

        expect(game.phase).toBe(PipPipGamePhase.RESULTS)
        expect(game.winnerIds.length).toBe(2)
        expect(game.winnerIds).toContain("AA")
        expect(game.winnerIds).toContain("BB")
    })

    it("ends with no winner when the clock runs out on a scoreless match", () => {
        const game = makeAuthoritativeGame()
        new PipPlayer(game, "AA")
        new PipPlayer(game, "BB")
        startLiveMatch(game, { mode: PipPipGameMode.KILL_FRENZY, matchMinutes: 1 })

        const ticks = game.matchTimer + 1
        for(let i = 0; i < ticks; i++){
            if(game.phase !== PipPipGamePhase.MATCH) break
            game.update()
        }

        expect(game.phase).toBe(PipPipGamePhase.RESULTS)
        expect(game.winnerIds).toEqual([])
    })

    it("does not end early while time remains, even with kills on the board", () => {
        const game = makeAuthoritativeGame()
        const a = new PipPlayer(game, "AA")
        startLiveMatch(game, { mode: PipPipGameMode.KILL_FRENZY, matchMinutes: 1 })

        // Far above any DEATHMATCH cap, but KILL_FRENZY ignores maxKills entirely.
        a.score.kills = 999
        game.update()

        expect(game.phase).toBe(PipPipGamePhase.MATCH)
        expect(game.winnerIds).toEqual([])
    })
})

// Adding TEAM_DEATHMATCH must NOT change how the two free-for-all modes resolve.
// These pin the existing behavior explicitly so a regression in the shared
// checkWinCondition path shows up here.
describe("free-for-all win conditions are unchanged by TEAM_DEATHMATCH", () => {
    it("DEATHMATCH still ends on the first player to reach maxKills (single winner)", () => {
        const game = makeAuthoritativeGame()
        const winner = new PipPlayer(game, "AA")
        const other = new PipPlayer(game, "BB")
        startLiveMatch(game, { mode: PipPipGameMode.DEATHMATCH, maxKills: 6 })

        // Two players share a team value, but DEATHMATCH leaves useTeams off, so
        // team scoring never applies - the lone top scorer wins as before.
        winner.team = 0
        other.team = 0
        other.score.kills = 5
        winner.score.kills = 6

        game.update()

        expect(game.phase).toBe(PipPipGamePhase.RESULTS)
        expect(game.winnerIds).toEqual(["AA"])
    })

    it("KILL_FRENZY still ignores maxKills and ends only on the clock", () => {
        const game = makeAuthoritativeGame()
        const a = new PipPlayer(game, "AA")
        startLiveMatch(game, { mode: PipPipGameMode.KILL_FRENZY, maxKills: 5, matchMinutes: 1 })

        // Far past the kill cap, but KILL_FRENZY never ends on kills.
        a.score.kills = 50
        game.update()
        expect(game.phase).toBe(PipPipGamePhase.MATCH)

        // It still ends when the clock runs out, with the top scorer winning.
        const ticks = game.matchTimer + 1
        for(let i = 0; i < ticks; i++){
            if(game.phase !== PipPipGamePhase.MATCH) break
            game.update()
        }
        expect(game.phase).toBe(PipPipGamePhase.RESULTS)
        expect(game.winnerIds).toEqual(["AA"])
    })
})

describe("non-authoritative client does not end matches", () => {
    it("never transitions to RESULTS on its own (no setScores/triggerPhases)", () => {
        // A client-style instance: none of the authoritative flags set.
        const game = new PipPipGame()
        const winner = new PipPlayer(game, "AA")
        game.setSettings({ mode: PipPipGameMode.DEATHMATCH, maxKills: 1 })
        // Drive the phase manually the way the client does from packets.
        game.setPhase(PipPipGamePhase.MATCH)

        winner.score.kills = 50
        game.update()

        // The client mirrors phase from the server; it must not end the match
        // itself. It stays in MATCH and records no winner locally.
        expect(game.phase).toBe(PipPipGamePhase.MATCH)
        expect(game.winnerIds).toEqual([])
    })
})
