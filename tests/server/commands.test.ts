import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGameMode, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import {
    COMMANDS,
    dispatchCommand,
    helpText,
    isCommandMessage,
    parseCommand,
    resolveMention,
    type CommandContext,
} from "@pip-pip/server/src/commands"

// Build a CommandContext around a real game + requester. The reply hook records
// every line so a test can assert on the denial / usage / error text; the kick
// hook records the kicked target so /kick can be checked without a real socket.
function makeContext(game: PipPipGame, requester: PipPlayer){
    const replies: string[] = []
    const kicked: PipPlayer[] = []
    const ctx: CommandContext = {
        game,
        player: requester,
        isHost: game.host?.id === requester.id,
        reply: (message) => replies.push(message),
        kick: (target) => kicked.push(target),
    }
    return { ctx, replies, kicked }
}

describe("parseCommand", () => {
    it("parses a leading /command word (lower-cased) plus args", () => {
        expect(parseCommand("/Bots 4")).toEqual({ name: "/bots", args: ["4"] })
        expect(parseCommand("  /KICK  @Bob  ")).toEqual({ name: "/kick", args: ["@Bob"] })
        expect(parseCommand("/help")).toEqual({ name: "/help", args: [] })
    })

    it("returns undefined for ordinary chat (no leading slash)", () => {
        expect(parseCommand("hello there")).toBeUndefined()
        expect(parseCommand("nice /bot")).toBeUndefined()
        expect(parseCommand("")).toBeUndefined()
    })
})

describe("resolveMention", () => {
    it("matches a player by case-insensitive name, @ optional", () => {
        const game = new PipPipGame()
        const a = new PipPlayer(game, "AA")
        const b = new PipPlayer(game, "BB")
        a.setName("Maverick")
        b.setName("Goose")
        const players = Object.values(game.players)

        expect(resolveMention("@maverick", players)).toBe(a)
        expect(resolveMention("MAVERICK", players)).toBe(a)
        expect(resolveMention("@Goose", players)).toBe(b)
    })

    it("returns the FIRST match when names collide", () => {
        const game = new PipPipGame()
        const a = new PipPlayer(game, "AA")
        const b = new PipPlayer(game, "BB")
        a.setName("Twin")
        b.setName("Twin")
        expect(resolveMention("@twin", Object.values(game.players))).toBe(a)
    })

    it("returns undefined on a miss or an empty token", () => {
        const game = new PipPipGame()
        const a = new PipPlayer(game, "AA")
        a.setName("Solo")
        const players = Object.values(game.players)
        expect(resolveMention("@nobody", players)).toBeUndefined()
        expect(resolveMention("@", players)).toBeUndefined()
        expect(resolveMention("", players)).toBeUndefined()
    })
})

describe("command registry routing + host gating", () => {
    it("recognizes every registered command via isCommandMessage", () => {
        for(const command of COMMANDS){
            expect(isCommandMessage(command.name)).toBe(true)
        }
        expect(isCommandMessage("just chatting")).toBe(false)
        expect(isCommandMessage("/notacommand")).toBe(false)
    })

    it("denies a host-only command for a non-host with a short reply", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        const other = game.createPlayer("BB")
        game.setHost(host)

        const { ctx, replies } = makeContext(game, other)
        const handled = dispatchCommand("/bot", ctx)

        // It WAS a command (so chat suppresses it) but it did not run.
        expect(handled).toBe(true)
        expect(replies.some(r => /host-only/i.test(r))).toBe(true)
        expect(Object.values(game.players).filter(p => p.isBot).length).toBe(0)
    })

    it("runs a host-only command for the host", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.setHost(host)
        const { ctx } = makeContext(game, host)

        expect(dispatchCommand("/bot", ctx)).toBe(true)
        expect(Object.values(game.players).filter(p => p.isBot).length).toBe(1)
    })

    it("returns false for ordinary chat (not a command)", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.setHost(host)
        const { ctx } = makeContext(game, host)
        expect(dispatchCommand("hello world", ctx)).toBe(false)
    })
})

describe("/help generation", () => {
    it("lists EVERY registered command for the host", () => {
        const text = helpText(true)
        for(const command of COMMANDS){
            expect(text).toContain(command.usage)
        }
    })

    it("hides host-only commands from a non-host but shows open ones", () => {
        const text = helpText(false)
        for(const command of COMMANDS){
            if(command.hostOnly){
                expect(text).not.toContain(command.usage)
            } else{
                expect(text).toContain(command.usage)
            }
        }
        // Sanity: the open team commands are present, a host-only one is not.
        expect(text).toContain("/jointeam")
        expect(text).not.toContain("/kick")
    })

    it("replies with the help text when /help is dispatched", () => {
        const game = new PipPipGame()
        const player = game.createPlayer("AA")
        const { ctx, replies } = makeContext(game, player)
        dispatchCommand("/help", ctx)
        expect(replies.length).toBe(1)
        expect(replies[0]).toContain("/help")
    })
})

describe("config commands set settings with clamps", () => {
    it("/mode switches mode and toggles teams/friendlyfire consistently", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.setHost(host)
        const { ctx } = makeContext(game, host)

        dispatchCommand("/mode tdm", ctx)
        expect(game.settings.mode).toBe(PipPipGameMode.TEAM_DEATHMATCH)
        expect(game.settings.useTeams).toBe(true)
        expect(game.settings.friendlyFire).toBe(false)

        dispatchCommand("/mode deathmatch", ctx)
        expect(game.settings.mode).toBe(PipPipGameMode.DEATHMATCH)
        expect(game.settings.useTeams).toBe(false)
        expect(game.settings.friendlyFire).toBe(true)
    })

    it("/mode replies on an unknown mode name", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.setHost(host)
        const { ctx, replies } = makeContext(game, host)
        dispatchCommand("/mode banana", ctx)
        expect(replies.length).toBe(1)
    })

    it("/kills clamps below and above the bounds", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.setHost(host)
        const { ctx } = makeContext(game, host)

        dispatchCommand("/kills 1", ctx)
        expect(game.settings.maxKills).toBe(5) // MODE_MIN_KILLS

        dispatchCommand("/kills 9999", ctx)
        expect(game.settings.maxKills).toBe(50) // MODE_MAX_KILLS
    })

    it("/minutes clamps to the minute bounds", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.setHost(host)
        const { ctx } = makeContext(game, host)

        dispatchCommand("/minutes 0", ctx)
        expect(game.settings.matchMinutes).toBe(1)
        dispatchCommand("/minutes 99", ctx)
        expect(game.settings.matchMinutes).toBe(10)
    })

    it("/teams and /friendlyfire toggle their flags", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.setHost(host)
        const { ctx } = makeContext(game, host)

        dispatchCommand("/teams on", ctx)
        expect(game.settings.useTeams).toBe(true)
        dispatchCommand("/teams off", ctx)
        expect(game.settings.useTeams).toBe(false)

        dispatchCommand("/friendlyfire on", ctx)
        expect(game.settings.friendlyFire).toBe(true)
        dispatchCommand("/friendlyfire off", ctx)
        expect(game.settings.friendlyFire).toBe(false)
    })

    it("/map switches by name and replies on an unknown map", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.setHost(host)
        const { ctx, replies } = makeContext(game, host)

        // "Portal" is a known authored map (index 1).
        dispatchCommand("/map Portal", ctx)
        expect(game.mapType.name).toBe("Portal")

        dispatchCommand("/map nowhere", ctx)
        expect(replies.length).toBe(1)
    })

    it("/settotalteams clamps to [2, 6]", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.setHost(host)
        const { ctx } = makeContext(game, host)

        dispatchCommand("/settotalteams 1", ctx)
        expect(game.settings.numTeams).toBe(2)
        dispatchCommand("/settotalteams 99", ctx)
        expect(game.settings.numTeams).toBe(6)
        dispatchCommand("/settotalteams 4", ctx)
        expect(game.settings.numTeams).toBe(4)
    })
})

describe("team commands (anyone)", () => {
    it("/jointeam sets a valid team and rejects an out-of-range one", () => {
        const game = new PipPipGame()
        const player = game.createPlayer("AA")
        game.setSettings({ numTeams: 4 })
        const { ctx, replies } = makeContext(game, player)

        dispatchCommand("/jointeam 3", ctx)
        expect(player.team).toBe(3)

        dispatchCommand("/jointeam 9", ctx)
        // Still 3 (the bad value is rejected with a reply).
        expect(player.team).toBe(3)
        expect(replies.some(r => /0-3/.test(r))).toBe(true)
    })

    it("/leaveteam sets the unassigned sentinel (-1)", () => {
        const game = new PipPipGame()
        const player = game.createPlayer("AA")
        player.setTeam(1)
        const { ctx } = makeContext(game, player)

        dispatchCommand("/leaveteam", ctx)
        expect(player.team).toBe(-1)
    })

    it("/join @player joins that player's team", () => {
        const game = new PipPipGame()
        const me = game.createPlayer("AA")
        const friend = game.createPlayer("BB")
        friend.setName("Buddy")
        friend.setTeam(2)
        const { ctx } = makeContext(game, me)

        dispatchCommand("/join @Buddy", ctx)
        expect(me.team).toBe(2)
    })

    it("/join replies when the target has no team", () => {
        const game = new PipPipGame()
        const me = game.createPlayer("AA")
        const friend = game.createPlayer("BB")
        friend.setName("Buddy")
        const { ctx, replies } = makeContext(game, me)
        dispatchCommand("/join @Buddy", ctx)
        expect(me.team).toBe(-1)
        expect(replies.length).toBe(1)
    })
})

describe("moderation commands (host-only)", () => {
    it("/kick routes a real player through the kick hook", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        const target = game.createPlayer("BB")
        target.setName("Troll")
        game.setHost(host)
        const { ctx, kicked } = makeContext(game, host)

        dispatchCommand("/kick @Troll", ctx)
        expect(kicked).toEqual([target])
    })

    it("/kick removes a bot directly (no connection to drop)", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.setHost(host)
        const bot = game.addBot()
        const { ctx } = makeContext(game, host)

        dispatchCommand(`/kick @${bot.name}`, ctx)
        expect(bot.id in game.players).toBe(false)
    })

    it("/kick replies when the target is not found", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.setHost(host)
        const { ctx, replies, kicked } = makeContext(game, host)
        dispatchCommand("/kick @ghost", ctx)
        expect(kicked.length).toBe(0)
        expect(replies.length).toBe(1)
    })

    it("/kill registers a death with NO killer credit (suicide-style)", () => {
        // Live damage so dealDamage actually applies; MATCH + spawned so the
        // target is in a live match.
        const game = new PipPipGame({ triggerDamage: true })
        const host = game.createPlayer("AA")
        const target = game.createPlayer("BB")
        target.setName("Victim")
        game.setHost(host)
        game.setPhase(PipPipGamePhase.MATCH)
        game.spawnPlayer(target, 0, 0)

        let killEvents = 0
        let lastKill: { killer: PipPlayer, killed: PipPlayer } | undefined
        game.events.on("playerKill", (e) => { killEvents++; lastKill = e })

        const { ctx } = makeContext(game, host)
        dispatchCommand("/kill @Victim", ctx)

        // A death is recorded; no kill credit goes to anyone (the host did not get
        // a kill - the death routes as self-damage).
        expect(target.score.deaths).toBe(1)
        expect(host.score.kills).toBe(0)
        expect(target.score.kills).toBe(0)
        // The death shows in the kill feed as killer === killed (suicide-style).
        expect(killEvents).toBe(1)
        expect(lastKill?.killer.id).toBe(lastKill?.killed.id)
        // The target is despawned with a respawn timer.
        expect(target.spawned).toBe(false)
        expect(target.timings.spawnTimeout).toBeGreaterThan(0)
    })

    it("/kill replies and is a no-op when the target is not in a live match", () => {
        const game = new PipPipGame({ triggerDamage: true })
        const host = game.createPlayer("AA")
        const target = game.createPlayer("BB")
        target.setName("Idler")
        game.setHost(host)
        // Still in SETUP, target not spawned: not a live match.
        const { ctx, replies } = makeContext(game, host)
        dispatchCommand("/kill @Idler", ctx)
        expect(target.score.deaths).toBe(0)
        expect(replies.length).toBe(1)
    })
})
