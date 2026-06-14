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
import { PIP_MAPS } from "@pip-pip/game/src/maps"

// Extensible chat-command system. The whole game is configurable from chat even
// before a GUI exists: config (mode/kills/teams), team management, moderation and
// an auto-generated /help all flow through one registry. The registry is the
// single source of truth - it drives BOTH execution AND /help, so a command can
// never be runnable but undocumented (a hard project rule). The pure parts
// (parsing, mention resolution, the registry, /help text) live here so they are
// unit-testable without standing up a websocket Connection.

// In-lobby mode-target bounds, mirrored from the host UI (HostSettingsModal / the
// lobby Match panel). The client clamps too, but the server never trusts the
// wire, so config commands re-clamp here. These match the existing gameMode
// handler in connection-in so a /kills (etc.) command and the GUI agree exactly.
export const MODE_MIN_KILLS = 5
export const MODE_MAX_KILLS = 50
export const MODE_MIN_MINUTES = 1
export const MODE_MAX_MINUTES = 10

// Max bots a single command may add, to bound server work (mirrors the original
// connection-in constant the bot commands used).
export const MAX_BOTS_PER_COMMAND = 16

const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value))

// Parse a raw chat string into a leading command word (lower-cased, includes the
// leading "/") plus the remaining whitespace-split argument tokens. Returns
// undefined when the trimmed message does not begin with "/", so ordinary chat is
// never treated as a command. Pure + shared by isCommand and the dispatcher.
export type ParsedCommand = {
    name: string,
    args: string[],
}

export function parseCommand(message: string): ParsedCommand | undefined {
    if(typeof message !== "string") return undefined
    const trimmed = message.trim()
    if(trimmed.length === 0) return undefined
    if(trimmed[0] !== "/") return undefined
    const parts = trimmed.split(/\s+/)
    return {
        name: parts[0].toLowerCase(),
        args: parts.slice(1),
    }
}

// Resolve an "@name" (or bare "name") mention token to a player by
// case-insensitive name, first match wins. The leading "@" is optional and
// stripped. Returns undefined on no match. Pure + reusable: /join, /kick, /kill
// all use it, and it is ready for future Battle Royale targeting too.
export function resolveMention(token: string, players: PipPlayer[]): PipPlayer | undefined {
    if(typeof token !== "string") return undefined
    const wanted = (token[0] === "@" ? token.slice(1) : token).trim().toLowerCase()
    if(wanted.length === 0) return undefined
    return players.find(player => player.name.trim().toLowerCase() === wanted)
}

// Side-effect hooks the dispatcher injects so the registry stays pure + testable.
// `reply` sends a short line back to ONLY the requester (the dispatcher routes it
// over the chat channel). `kick` disconnects a target player's connection (the
// server entry wires this to the core Connection API). Both are optional: a unit
// test can omit them, and a command that needs a missing hook simply no-ops.
export type CommandContext = {
    game: PipPipGame,
    player: PipPlayer,
    isHost: boolean,
    reply: (message: string) => void,
    kick?: (target: PipPlayer) => void,
}

export type Command = {
    name: string,
    usage: string,
    hostOnly: boolean,
    description: string,
    run: (ctx: CommandContext, args: string[]) => void,
}

// Map a mode name token to a PipPipGameMode (and whether it is a team mode). Used
// by /mode. Returns undefined for an unknown name so the command can reply with an
// error instead of silently doing nothing.
const MODE_ALIASES: Record<string, PipPipGameMode> = {
    deathmatch: PipPipGameMode.DEATHMATCH,
    dm: PipPipGameMode.DEATHMATCH,
    frenzy: PipPipGameMode.KILL_FRENZY,
    killfrenzy: PipPipGameMode.KILL_FRENZY,
    tdm: PipPipGameMode.TEAM_DEATHMATCH,
    teamdeathmatch: PipPipGameMode.TEAM_DEATHMATCH,
    teams: PipPipGameMode.TEAM_DEATHMATCH,
}

// Parse an on/off token to a boolean, or undefined if it is neither. Shared by
// /teams and /friendlyfire so both accept the same friendly words.
function parseOnOff(token: string | undefined): boolean | undefined {
    if(typeof token === "undefined") return undefined
    const word = token.trim().toLowerCase()
    if(word === "on" || word === "true" || word === "yes" || word === "1") return true
    if(word === "off" || word === "false" || word === "no" || word === "0") return false
    return undefined
}

// A player is in a LIVE match (targetable by /kill) when the game is in MATCH and
// the player is currently spawned. /kill is a no-op otherwise (a short reply).
function isInLiveMatch(game: PipPipGame, player: PipPlayer): boolean {
    return game.phase === PipPipGamePhase.MATCH && player.spawned === true
}

// The command registry. Order here is the order /help lists them. Each command
// owns its own validation + reply text, so adding a command is purely additive.
export const COMMANDS: Command[] = [
    // --- Bots (host-only; behaviour preserved exactly from the old runBotCommand) ---
    {
        name: "/bot",
        usage: "/bot",
        hostOnly: true,
        description: "Add one training bot.",
        run: (ctx) => {
            ctx.game.addBot()
        },
    },
    {
        name: "/bots",
        usage: "/bots <n>",
        hostOnly: true,
        description: "Add N training bots.",
        run: (ctx, args) => {
            const requested = Number.parseInt(args[0] ?? "1", 10)
            const count = Number.isFinite(requested) ? requested : 1
            ctx.game.addBots(Math.min(Math.max(1, count), MAX_BOTS_PER_COMMAND))
        },
    },
    {
        name: "/clearbots",
        usage: "/clearbots",
        hostOnly: true,
        description: "Remove all training bots.",
        run: (ctx) => {
            ctx.game.clearBots()
        },
    },
    // --- Host promote (host-only; behaviour preserved from runHostPromoteCommand) ---
    {
        name: "/op",
        usage: "/op <name|id>",
        hostOnly: true,
        description: "Promote a player to host.",
        run: (ctx, args) => {
            const target = args.join(" ").trim()
            if(target.length === 0) return
            const wanted = target.toLowerCase()
            const match = Object.values(ctx.game.players).find(player =>
                player.id.toLowerCase() === wanted ||
                player.name.trim().toLowerCase() === wanted)
            if(typeof match === "undefined") return
            ctx.game.setHost(match)
        },
    },
    // --- Config (host-only): apply the SAME clamps the gameMode handler uses ---
    {
        name: "/mode",
        usage: "/mode <deathmatch|frenzy|tdm>",
        hostOnly: true,
        description: "Set the match mode.",
        run: (ctx, args) => {
            const wanted = (args[0] ?? "").trim().toLowerCase()
            const mode = MODE_ALIASES[wanted]
            if(typeof mode === "undefined"){
                ctx.reply("Usage: /mode <deathmatch|frenzy|tdm>")
                return
            }
            // TEAM_DEATHMATCH turns teams on + friendly-fire off; the free-for-all
            // modes turn them back off, mirroring the lobby gameMode handler so a
            // mode switch always lands a consistent settings pair.
            const isTeam = mode === PipPipGameMode.TEAM_DEATHMATCH
            ctx.game.setSettings({ mode, useTeams: isTeam, friendlyFire: !isTeam })
        },
    },
    {
        name: "/kills",
        usage: "/kills <n>",
        hostOnly: true,
        description: "Set the kill target.",
        run: (ctx, args) => {
            const n = Number.parseInt(args[0] ?? "", 10)
            if(!Number.isFinite(n)){
                ctx.reply("Usage: /kills <n>")
                return
            }
            ctx.game.setSettings({ maxKills: clamp(n, MODE_MIN_KILLS, MODE_MAX_KILLS) })
        },
    },
    {
        name: "/minutes",
        usage: "/minutes <n>",
        hostOnly: true,
        description: "Set the match length (Kill Frenzy).",
        run: (ctx, args) => {
            const n = Number.parseInt(args[0] ?? "", 10)
            if(!Number.isFinite(n)){
                ctx.reply("Usage: /minutes <n>")
                return
            }
            ctx.game.setSettings({ matchMinutes: clamp(n, MODE_MIN_MINUTES, MODE_MAX_MINUTES) })
        },
    },
    {
        name: "/teams",
        usage: "/teams <on|off>",
        hostOnly: true,
        description: "Turn teams on or off.",
        run: (ctx, args) => {
            const on = parseOnOff(args[0])
            if(typeof on === "undefined"){
                ctx.reply("Usage: /teams <on|off>")
                return
            }
            ctx.game.setSettings({ useTeams: on })
        },
    },
    {
        name: "/friendlyfire",
        usage: "/friendlyfire <on|off>",
        hostOnly: true,
        description: "Turn friendly fire on or off.",
        run: (ctx, args) => {
            const on = parseOnOff(args[0])
            if(typeof on === "undefined"){
                ctx.reply("Usage: /friendlyfire <on|off>")
                return
            }
            ctx.game.setSettings({ friendlyFire: on })
        },
    },
    {
        name: "/map",
        usage: "/map <name>",
        hostOnly: true,
        description: "Switch the map by name.",
        run: (ctx, args) => {
            const wanted = args.join(" ").trim().toLowerCase()
            if(wanted.length === 0){
                ctx.reply("Usage: /map <name>")
                return
            }
            const index = PIP_MAPS.findIndex(map => map.name.trim().toLowerCase() === wanted)
            if(index < 0){
                ctx.reply(`No map named "${args.join(" ").trim()}".`)
                return
            }
            ctx.game.setMap(index)
        },
    },
    {
        name: "/settotalteams",
        usage: "/settotalteams <n>",
        hostOnly: true,
        description: `Set the number of teams (${MIN_TEAMS}-${MAX_TEAMS}).`,
        run: (ctx, args) => {
            const n = Number.parseInt(args[0] ?? "", 10)
            if(!Number.isFinite(n)){
                ctx.reply("Usage: /settotalteams <n>")
                return
            }
            ctx.game.setSettings({ numTeams: clampNumTeams(n) })
        },
    },
    // --- Team management (anyone) ---
    {
        name: "/jointeam",
        usage: "/jointeam <n>",
        hostOnly: false,
        description: "Join team number n.",
        run: (ctx, args) => {
            const n = Number.parseInt(args[0] ?? "", 10)
            const teams = teamIndices(ctx.game.settings.numTeams)
            if(!Number.isFinite(n) || !teams.includes(n)){
                ctx.reply(`Team must be 0-${teams.length - 1}.`)
                return
            }
            ctx.player.setTeam(n)
        },
    },
    {
        name: "/leaveteam",
        usage: "/leaveteam",
        hostOnly: false,
        description: "Leave your team (become unassigned).",
        run: (ctx) => {
            // -1 is the unassigned sentinel (TEAM_UNASSIGNED); setTeam already
            // maps it onto the wire via encodeTeam.
            ctx.player.setTeam(-1)
        },
    },
    {
        name: "/join",
        usage: "/join @player",
        hostOnly: false,
        description: "Join another player's team.",
        run: (ctx, args) => {
            const target = resolveMention(args[0] ?? "", Object.values(ctx.game.players))
            if(typeof target === "undefined"){
                ctx.reply("Player not found.")
                return
            }
            if(target.team < 0){
                ctx.reply(`${target.name} is not on a team.`)
                return
            }
            ctx.player.setTeam(target.team)
        },
    },
    // --- Moderation (host-only) ---
    {
        name: "/kick",
        usage: "/kick @player",
        hostOnly: true,
        description: "Disconnect a player.",
        run: (ctx, args) => {
            const target = resolveMention(args[0] ?? "", Object.values(ctx.game.players))
            if(typeof target === "undefined"){
                ctx.reply("Player not found.")
                return
            }
            // A bot has no connection to drop; remove it from the game directly so
            // /kick still does the sensible thing on a bot. Real players are routed
            // through the injected kick hook (closes their connection).
            if(target.isBot === true){
                target.remove()
                return
            }
            if(typeof ctx.kick === "undefined"){
                ctx.reply("Cannot kick that player.")
                return
            }
            ctx.kick(target)
        },
    },
    {
        name: "/kill",
        usage: "/kill @player",
        hostOnly: true,
        description: "Kill a player in the match.",
        run: (ctx, args) => {
            const target = resolveMention(args[0] ?? "", Object.values(ctx.game.players))
            if(typeof target === "undefined"){
                ctx.reply("Player not found.")
                return
            }
            if(!isInLiveMatch(ctx.game, target)){
                ctx.reply(`${target.name} is not in a live match.`)
                return
            }
            // Route through the existing death path so the death counts, the player
            // despawns with a respawn timeout, and the kill feed shows it. Self-
            // damage (dealer === target) credits NO killer and no damage-dealt - a
            // suicide-style death - which is exactly what a moderation /kill should
            // be. dealDamage caps the loss at current health, so a huge number is a
            // guaranteed one-shot.
            ctx.game.dealDamage(target, target, 99999)
        },
    },
    // --- Help (everyone; auto-generated from this registry) ---
    {
        name: "/help",
        usage: "/help",
        hostOnly: false,
        description: "List available commands.",
        run: (ctx) => {
            ctx.reply(helpText(ctx.isHost))
        },
    },
]

// Index the registry by command name for O(1) dispatch. Built once at module load
// from COMMANDS so it can never drift from what /help lists.
const COMMAND_BY_NAME: Record<string, Command> = {}
for(const command of COMMANDS){
    COMMAND_BY_NAME[command.name] = command
}

// Look up a command by its already-lower-cased name (the "/word" form).
export function getCommand(name: string): Command | undefined {
    return COMMAND_BY_NAME[name]
}

// True if `message` parses to a REGISTERED command word. Used by the outgoing
// chat broadcast to suppress echoing a recognized command back into the chat log
// (commands are acted on, not chatted). A non-host's host-only command still
// counts as a command here so it is suppressed and answered with the denial reply
// rather than leaking into chat.
export function isCommandMessage(message: string): boolean {
    const parsed = parseCommand(message)
    if(typeof parsed === "undefined") return false
    return typeof getCommand(parsed.name) !== "undefined"
}

// Auto-generated /help body. Lists every command available to the requester: a
// non-host sees only the open commands; the host additionally sees host-only ones.
// Built straight from COMMANDS so every registered command appears (the hard
// project rule that no command can be hidden from /help).
export function helpText(isHost: boolean): string {
    const visible = COMMANDS.filter(command => isHost || command.hostOnly === false)
    const lines = visible.map(command => `${command.usage} - ${command.description}`)
    return ["Commands:", ...lines].join("\n")
}

// Execute one parsed chat command. Returns true when the message WAS a registered
// command (so the caller suppresses it from chat), false when it is ordinary chat.
// Host-only commands run only for the host; a non-host gets a short denial reply
// (mirroring today's host gating) and the command still counts as handled.
export function dispatchCommand(message: string, ctx: CommandContext): boolean {
    const parsed = parseCommand(message)
    if(typeof parsed === "undefined") return false
    const command = getCommand(parsed.name)
    if(typeof command === "undefined") return false
    if(command.hostOnly === true && ctx.isHost === false){
        ctx.reply("That command is host-only.")
        return true
    }
    command.run(ctx, parsed.args)
    return true
}
