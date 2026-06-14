import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGameMode, PipPipGamePhase, TDM_TEAMS } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"

// TEAM_DEATHMATCH is authoritative the same way the other modes are: setScores
// owns scoring + the win-condition check, triggerPhases drives the RESULTS
// transition, and triggerSpawns gates the balanced team assignment at match
// start. Enable exactly those gates so the team logic runs deterministically.
function makeTeamGame(){
    return new PipPipGame({ setScores: true, triggerPhases: true, triggerSpawns: true })
}

// Put the game straight into a live MATCH for TEAM_DEATHMATCH with the given kill
// cap, bypassing COUNTDOWN. startMatch() assigns balanced teams (triggerSpawns),
// so set the mode/cap BEFORE calling it; setPhase then jumps past the countdown.
function startLiveTeamMatch(game: PipPipGame, maxKills: number){
    game.setSettings({ mode: PipPipGameMode.TEAM_DEATHMATCH, useTeams: true, friendlyFire: false, maxKills })
    game.startMatch()
    game.setPhase(PipPipGamePhase.MATCH)
}

// A minimal arena game for friendly-fire damage tests: teams on, friendly fire
// off, damage live. No spawning gate needed (we call dealDamage directly).
function makeDamageGame(){
    const game = new PipPipGame({ triggerDamage: true })
    game.setSettings({ mode: PipPipGameMode.TEAM_DEATHMATCH, useTeams: true, friendlyFire: false })
    game.setPhase(PipPipGamePhase.MATCH)
    return game
}

describe("TEAM_DEATHMATCH team assignment", () => {
    it("splits non-spectator players into two balanced teams at match start", () => {
        const game = makeTeamGame()
        const ids = ["AA", "BB", "CC", "DD", "EE"]
        for(const id of ids) new PipPlayer(game, id)

        startLiveTeamMatch(game, 25)

        // Every player lands on a real team (0 or 1).
        for(const id of ids){
            expect(TDM_TEAMS).toContain(game.players[id].team)
        }

        // 5 players split 3/2 - balanced to within one.
        const team0 = game.teamPlayers(0).length
        const team1 = game.teamPlayers(1).length
        expect(team0 + team1).toBe(5)
        expect(Math.abs(team0 - team1)).toBeLessThanOrEqual(1)
    })

    it("leaves spectators unassigned and balances only the active players", () => {
        const game = makeTeamGame()
        const a = new PipPlayer(game, "AA")
        const b = new PipPlayer(game, "BB")
        const spec = new PipPlayer(game, "CC")
        spec.setSpectator(true)

        startLiveTeamMatch(game, 25)

        expect(spec.team).toBe(-1)
        // The two active players land on opposite teams (balanced 1/1).
        expect(a.team).not.toBe(b.team)
        expect(TDM_TEAMS).toContain(a.team)
        expect(TDM_TEAMS).toContain(b.team)
    })

    it("assigns bots a team like any other player", () => {
        const game = makeTeamGame()
        new PipPlayer(game, "AA")
        new PipPlayer(game, "BB")
        const bot = game.addBot()

        startLiveTeamMatch(game, 25)

        expect(TDM_TEAMS).toContain(bot.team)
    })

    it("puts a mid-match joiner on the smaller team", () => {
        const game = makeTeamGame()
        new PipPlayer(game, "AA")
        new PipPlayer(game, "BB")
        startLiveTeamMatch(game, 25)

        // Force an imbalance so the smaller team is unambiguous, then join.
        for(const player of Object.values(game.players)) player.setTeam(0)
        const joiner = new PipPlayer(game, "CC")
        game.addPlayerMidGame(joiner)

        // The two existing players are on team 0, so the joiner fills team 1.
        expect(joiner.team).toBe(1)
    })
})

describe("TEAM_DEATHMATCH win condition", () => {
    it("ends the match when a team's combined kills reach maxKills, with that team as winners", () => {
        const game = makeTeamGame()
        const a = new PipPlayer(game, "AA")
        const b = new PipPlayer(game, "BB")
        const c = new PipPlayer(game, "CC")
        const d = new PipPlayer(game, "DD")
        startLiveTeamMatch(game, 5)

        // Force a known split: AA + CC on team 0, BB + DD on team 1.
        a.setTeam(0)
        c.setTeam(0)
        b.setTeam(1)
        d.setTeam(1)

        // Team 0 combined kills (3 + 2 = 5) hit the cap; team 1 trails.
        a.score.kills = 3
        c.score.kills = 2
        b.score.kills = 1
        d.score.kills = 1

        game.update()

        expect(game.phase).toBe(PipPipGamePhase.RESULTS)
        // Both team-0 members are winners; neither team-1 member is.
        expect(game.winnerIds.sort()).toEqual(["AA", "CC"])
    })

    it("does not end the match before either team reaches the cap", () => {
        const game = makeTeamGame()
        const a = new PipPlayer(game, "AA")
        const b = new PipPlayer(game, "BB")
        startLiveTeamMatch(game, 10)

        a.setTeam(0)
        b.setTeam(1)
        a.score.kills = 4
        b.score.kills = 9

        game.update()

        expect(game.phase).toBe(PipPipGamePhase.MATCH)
        expect(game.winnerIds).toEqual([])
    })

    it("computes a team's score as the sum of its members' kills", () => {
        const game = makeTeamGame()
        const a = new PipPlayer(game, "AA")
        const b = new PipPlayer(game, "BB")
        const c = new PipPlayer(game, "CC")
        startLiveTeamMatch(game, 25)

        a.setTeam(0)
        b.setTeam(0)
        c.setTeam(1)
        a.score.kills = 4
        b.score.kills = 3
        c.score.kills = 9

        expect(game.teamScore(0)).toBe(7)
        expect(game.teamScore(1)).toBe(9)
    })
})

describe("TEAM_DEATHMATCH friendly fire", () => {
    it("deals no damage between same-team players", () => {
        const game = makeDamageGame()
        const a = new PipPlayer(game, "AA")
        const b = new PipPlayer(game, "BB")
        a.setTeam(0)
        b.setTeam(0)
        game.spawnPlayer(a, 0, 0)
        game.spawnPlayer(b, 0, 0)

        const before = b.ship.capacities.health
        let dealt = 0
        game.events.on("dealDamage", ({ damage }) => { dealt += damage })

        game.dealDamage(a, b, 50)

        // No health lost, no event, no score - a teammate cannot hurt a teammate.
        expect(b.ship.capacities.health).toBe(before)
        expect(dealt).toBe(0)
        expect(a.score.damage).toBe(0)
    })

    it("still damages enemies on the other team", () => {
        const game = makeDamageGame()
        const a = new PipPlayer(game, "AA")
        const enemy = new PipPlayer(game, "BB")
        a.setTeam(0)
        enemy.setTeam(1)
        game.spawnPlayer(enemy, 0, 0)

        const before = enemy.ship.capacities.health
        game.dealDamage(a, enemy, 50)

        expect(enemy.ship.capacities.health).toBeLessThan(before)
        expect(a.score.damage).toBeGreaterThan(0)
    })

    it("still applies SELF damage (suicide) to a player on their own team", () => {
        const game = makeDamageGame()
        const a = new PipPlayer(game, "AA")
        a.setTeam(0)
        game.spawnPlayer(a, 0, 0)

        // Lethal self-damage: dealer === target. Friendly fire off must NOT block
        // a suicide (a player is trivially on their own team).
        game.dealDamage(a, a, 9999)

        expect(a.score.deaths).toBe(1)
        // Suicide is a death only - no kill credit, no damage-dealt (unchanged).
        expect(a.score.kills).toBe(0)
        expect(a.score.damage).toBe(0)
    })
})

describe("friendly fire stays OFF only with teams on", () => {
    it("a same-team hit DOES damage when useTeams is false (free-for-all)", () => {
        // DEATHMATCH leaves useTeams false, so the friendly-fire gate is inert even
        // if two players happen to share a team value.
        const game = new PipPipGame({ triggerDamage: true })
        game.setSettings({ mode: PipPipGameMode.DEATHMATCH })
        game.setPhase(PipPipGamePhase.MATCH)
        const a = new PipPlayer(game, "AA")
        const b = new PipPlayer(game, "BB")
        a.team = 0
        b.team = 0
        game.spawnPlayer(b, 0, 0)

        const before = b.ship.capacities.health
        game.dealDamage(a, b, 50)

        expect(b.ship.capacities.health).toBeLessThan(before)
    })
})
