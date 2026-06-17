import { PipPipGameMode, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { CUSTOM_MAP_INDEX } from "@pip-pip/game/src/maps"
import { CHAT_MAX_MESSAGE_LENGTH } from "@pip-pip/game/src/logic/constants"
import { PipPlayer, PlayerScores } from "@pip-pip/game/src/logic/player"
import { HASTE_TICKS, SHIELD_TICKS, INVIS_TICKS, RICOCHET_TICKS, RAPIDFIRE_TICKS, BuffType } from "@pip-pip/game/src/logic/buff"
import { PIP_SHIPS, ShipType } from "@pip-pip/game/src/ships"
import { create } from "zustand"
import { GAME_CONTEXT, getClientPlayer } from "."
import { ChatMessage } from "./chat"

// Pure clamped fraction helper: value / max, pinned to [0, 1]. Returns 0 when
// max is non-positive so callers never divide by zero. Used to turn raw tick
// counts (buff timers, reloads) into a 0..1 bar fill. Kept pure (no store/DOM
// access) so it is trivially unit-testable.
export function fraction(value: number, max: number): number {
    if (max <= 0) return 0
    return Math.max(0, Math.min(1, value / max))
}

// Pure tick-to-seconds helper for countdown labels: rounds a tick count UP to
// whole seconds at the given tick rate, clamped at 0 so a spent/negative timer
// never reads as a negative "Respawning in -1". Used by the respawn overlay and
// the player-list respawn indicator. Kept pure (no store/DOM access) so it is
// trivially unit-testable.
export function ticksToSeconds(ticks: number, tps: number): number {
    if (tps <= 0) return 0
    return Math.max(0, Math.ceil(ticks / tps))
}

export type GameStorePlayer = {
    id: string,
    name: string,
    idle: boolean,
    spectator: boolean,
    ping: number,
    score: PlayerScores,
    shipIndex: number,
    shipType: ShipType,
    isHost: boolean,
    isClient: boolean,
    // TEAM_DEATHMATCH team (0 or 1; -1 unassigned), mirrored from the networked
    // player.team so the HUD + scoreboard can color by team and total team scores.
    team: number,
    // Lobby "ready up" flag, mirrored from the networked player.ready so the lobby
    // footer Ready toggle + player list ready badges + the host's ready tally can
    // read it. Purely social: it never gates the host's start.
    ready: boolean,
    // Respawn state, networked to every player (client.ts applies playerTimings),
    // so the scoreboard can show a "Respawning Ns" indicator for anyone who is
    // currently dead. spawnTimeout is in ticks; convert with ticksToSeconds.
    spawned: boolean,
    spawnTimeout: number,
}

// The current DEATHMATCH "king": the player with the most kills. Ties go to the
// first such player in the array (stable: the players list order is itself
// stable across syncs). Returns null when nobody has scored yet, which the HUD
// renders as a neutral "First to N" target instead of crowning a 0-kill leader.
// Kept pure (no store/DOM access) so it is trivially unit-testable.
export interface MatchLeader {
    name: string
    kills: number
}

export function matchLeader(players: GameStorePlayer[]): MatchLeader | null {
    let best: GameStorePlayer | null = null
    for (const player of players) {
        // Spectators are not in the running; they hold no kills anyway, but skip
        // them so a stray spectator can never be crowned.
        if (player.spectator) continue
        if (best === null || player.score.kills > best.score.kills) {
            best = player
        }
    }
    if (best === null || best.score.kills <= 0) return null
    return { name: best.name, kills: best.score.kills }
}

// Map a networked player's live ship to the flat ClientPlayerStats shape the HUD
// reads (health/ammo/buff timers/tactical). One source of truth for BOTH the
// local self-HUD and the spectated-target mini-HUD, so the spectate panel shows
// the exact same numbers the player sees for themselves - just selected by a
// different player id. Reads only fields already present on the client each sync
// (the server networks ship.timings/capacities), so no packet or sim change is
// needed. Kept as a small mapper rather than a deep selector so it mirrors the
// previous inline self-HUD block exactly.
export function playerStats(player: PipPlayer): ClientPlayerStats {
    const ship = player.ship
    return {
        reloading: ship.isReloading,
        ammo: ship.capacities.weapon,
        ammoMax: ship.stats.weapon.capacity,
        health: ship.capacities.health,
        healthMax: ship.maxHealth,
        spawned: player.spawned,
        spawnTimeout: player.timings.spawnTimeout,
        shieldTicks: ship.timings.shield,
        shieldMaxTicks: SHIELD_TICKS,
        hasteTicks: ship.timings.haste,
        hasteMaxTicks: HASTE_TICKS,
        invisTicks: ship.timings.invisibility,
        invisMaxTicks: INVIS_TICKS,
        ricochetTicks: ship.timings.ricochet,
        ricochetMaxTicks: RICOCHET_TICKS,
        rapidfireTicks: ship.timings.rapidfire,
        rapidfireMaxTicks: RAPIDFIRE_TICKS,
        tacticalReloadTicks: ship.timings.tacticalReload,
        tacticalReloadMaxTicks: ship.stats.tactical.reload.ticks,
        tacticalAmmo: ship.capacities.tactical,
        tacticalAmmoMax: ship.stats.tactical.capacity,
    }
}

export function playerToGameStore(player: PipPlayer): GameStorePlayer {
    return {
        id: player.id,
        name: player.name,
        idle: player.idle,
        spectator: player.spectator,
        ping: player.ping,
        score: player.score,
        shipIndex: player.shipIndex,
        shipType: player.shipType,
        isHost: GAME_CONTEXT.game.host?.id === player.id,
        isClient: GAME_CONTEXT.client.connectionId === player.id,
        team: player.team,
        ready: player.ready,
        spawned: player.spawned,
        spawnTimeout: player.timings.spawnTimeout,
    }
}

export interface ClientPlayerStats {
    reloading: boolean
    ammo: number
    ammoMax: number
    health: number
    healthMax: number

    // Respawn state for the LOCAL player, read each tick. spawned is false while
    // dead; spawnTimeout is the respawn countdown in ticks (convert with
    // ticksToSeconds). Drives the centered "Respawning in N" overlay.
    spawned: boolean
    spawnTimeout: number

    // Timed-buff timers (in ticks) and their max durations, read from the local
    // ship.timings each tick. Remaining fraction = ticks / maxTicks; a buff is
    // active while its ticks > 0. Powers the bottom-right buff bars and the
    // Apex-style shield bar in the combat HUD.
    shieldTicks: number
    shieldMaxTicks: number
    hasteTicks: number
    hasteMaxTicks: number
    invisTicks: number
    invisMaxTicks: number
    // ricochet rides playerShipTimings like haste/shield/invis (networked), so
    // it lights up the buff bar and the tactical feed for the local AND remote
    // players. Read from ship.timings.ricochet, same as the others.
    ricochetTicks: number
    ricochetMaxTicks: number
    // rapidfire rides playerShipTimings like the others (networked); read from
    // ship.timings.rapidfire so it shows on the buff bar + tactical feed too.
    rapidfireTicks: number
    rapidfireMaxTicks: number

    // Secondary/tactical cannon state: reload countdown (ticks) vs its full
    // reload duration, plus remaining ammo. Drives the tactical cooldown
    // indicator so the player knows when the tactical is ready.
    tacticalReloadTicks: number
    tacticalReloadMaxTicks: number
    tacticalAmmo: number
    tacticalAmmoMax: number
}

// One transient line in the in-match kill feed. `time` is the Date.now() the
// kill was recorded at, used to fade and expire the entry (see visibleKills).
// `killerShipIndex` is the killer's ship at the moment of the kill (read from the
// live game.players at the addKill call site) so the feed can show their ship
// glyph; it is undefined when the killer's ship is unknown (e.g. they left), in
// which case the feed simply renders without an icon.
export interface KillEntry {
    id: number
    killerName: string
    killedName: string
    killerShipIndex?: number
    time: number
}

// How many entries the feed retains. The feed is short and transient; older
// kills scroll off both by this cap and by the duration in visibleKills.
export const KILL_FEED_MAX = 6

// How long (ms) a kill stays in the feed before it expires.
export const KILL_FEED_DURATION_MS = 5000

// Pure selector: the kills still young enough to show, NEWEST FIRST. An entry
// is visible while its age (now - time) is below durationMs. Kept pure (no
// store/Date access) so it is trivially unit-testable.
export function visibleKills(feed: KillEntry[], now: number, durationMs = KILL_FEED_DURATION_MS): KillEntry[] {
    return feed
        .filter((entry) => now - entry.time < durationMs)
        .sort((a, b) => b.time - a.time)
}

// One transient line in the in-match BUFF feed. Mirrors KillEntry: `time` is
// the Date.now() the pickup was recorded at, used to fade and expire the entry
// (see visibleBuffs). `playerId` is the picker (used to read that ship's live
// remaining buff time off the networked timings for the tactical countdown);
// `playerName` is shown; `type` drives the label.
export interface BuffEntry {
    id: number
    playerId: string
    playerName: string
    type: BuffType
    time: number
}

// The timed (buff) buff types: these set a ship timing that ticks down, so
// the buff HUD and the tactical feed can show a live countdown. "health"/"ammo"
// are instant (no timer) and are deliberately absent. Kept as a const set + a
// pure predicate so callers (and tests) share one source of truth.
const TIMED_BUFF_TYPES: ReadonlySet<BuffType> = new Set<BuffType>([
    "haste", "shield", "invis", "ricochet", "rapidfire",
])

export function isTimedBuff(type: BuffType): boolean {
    return TIMED_BUFF_TYPES.has(type)
}

// Pure tick-to-label formatter for buff countdowns. Rounds UP to whole seconds
// (so a buff never reads "0s" while time is left), then renders a clean "Ns"
// under a minute and "M:SS" at a minute or more. Clamped at 0 so a spent timer
// reads "0s", never negative. Kept pure (no store/DOM) so it is unit-testable.
export function formatBuffTime(ticks: number, tps: number): string {
    const seconds = ticksToSeconds(ticks, tps)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const rest = seconds % 60
    return `${minutes}:${rest.toString().padStart(2, "0")}`
}

// Friendly, shout-y label for each buff type. "Cloak" reads better than
// "Invis" on screen, and "ammo" gets a punchier name to match the kill feed's
// energy. Kept pure (no store/DOM) so it is trivially unit-testable.
const BUFF_LABELS: Record<BuffType, string> = {
    health: "HEALTH",
    ammo: "AMMO",
    haste: "HASTE",
    shield: "SHIELD",
    invis: "CLOAK",
    ricochet: "RICOCHET",
    rapidfire: "RAPIDFIRE",
}

export function buffLabel(type: BuffType): string {
    return BUFF_LABELS[type]
}

// Per-type colors, matching the HUD/pickup palette so a buff reads the same
// color in the feed as it does on the buff bars and the world pickup.
export const BUFF_COLORS: Record<BuffType, string> = {
    health: "#33DD55",
    ammo: "#FFAA33",
    haste: "#33CCFF",
    shield: "#AA66FF",
    invis: "#CCE6FF",
    ricochet: "#FF66AA",
    rapidfire: "#FFE14D",
}

// The same palette as Pixi numeric colors, derived here (the single source) so the
// world renderer's buff colors cannot drift from the HUD/feed CSS colors.
export const BUFF_COLORS_NUMERIC: Record<BuffType, number> = Object.fromEntries(
    Object.entries(BUFF_COLORS).map(([type, css]) => [type, parseInt(css.slice(1), 16)]),
) as Record<BuffType, number>

export function buffColor(type: BuffType): string {
    return BUFF_COLORS[type]
}

// How many entries the buff feed retains and how long (ms) each one lives.
// Mirrors the kill feed's cap + duration so the two feeds feel identical.
export const BUFF_FEED_MAX = 6
export const BUFF_FEED_DURATION_MS = 5000

// Pure selector: buff pickups still young enough to show, NEWEST FIRST.
// Mirrors visibleKills exactly. Kept pure (no store/Date access) so it is
// trivially unit-testable.
export function visibleBuffs(feed: BuffEntry[], now: number, durationMs = BUFF_FEED_DURATION_MS): BuffEntry[] {
    return feed
        .filter((entry) => now - entry.time < durationMs)
        .sort((a, b) => b.time - a.time)
}

// Live remaining buff ticks for EVERY player, keyed "<playerId>:<type>", mirrored
// each sync from that player's networked ship.timings. The tactical buff feed
// reads it so a buff line counts down (and persists) for as long as the picker
// still actually holds the buff, instead of fading on a blind 5s timer.
export type BuffRemaining = Record<string, number>

export function buffRemainingKey(playerId: string, type: BuffType): string {
    return `${playerId}:${type}`
}

// Pure selector backing the TACTICAL buff feed. An entry stays visible while:
//   - it is a timed buff (haste/shield/invis/ricochet) AND the picker still holds
//     that buff (its live remaining ticks are > 0), OR
//   - it is an instant pickup (health/ammo) still inside the brief fixed window.
// Each surviving timed entry is annotated with its live remainingTicks so the
// feed can render a countdown; instant entries carry remainingTicks 0. Returned
// NEWEST FIRST. Kept pure (no store/Date access) so it is trivially testable.
export interface TacticalBuffEntry extends BuffEntry {
    remainingTicks: number
}

export function visibleTacticalBuffs(
    feed: BuffEntry[],
    remaining: BuffRemaining,
    now: number,
    durationMs = BUFF_FEED_DURATION_MS,
): TacticalBuffEntry[] {
    return feed
        .map((entry) => {
            if (isTimedBuff(entry.type)) {
                const remainingTicks = remaining[buffRemainingKey(entry.playerId, entry.type)] ?? 0
                return { ...entry, remainingTicks }
            }
            return { ...entry, remainingTicks: 0 }
        })
        .filter((entry) => {
            // Timed buffs live as long as the picker still holds the buff; instant
            // pickups fall back to the short fixed transient window.
            if (isTimedBuff(entry.type)) return entry.remainingTicks > 0
            return now - entry.time < durationMs
        })
        .sort((a, b) => b.time - a.time)
}

// One active buff on the LOCAL player, for the Minecraft-style status HUD.
// `ticks`/`maxTicks` drive the depleting bar; `label`/`color` come from the
// shared buff helpers so the HUD reads the same as the feed + world pickup.
export interface ActiveBuff {
    type: BuffType
    label: string
    color: string
    ticks: number
    maxTicks: number
}

// Pure selector: the LOCAL player's active timed buffs, strongest/longest window
// first then by remaining time, so the most significant buff sits on top of the
// stack. Only buffs with ticks > 0 are returned. Reads from clientPlayerStats so
// it stays pure (no store/DOM) and is trivially unit-testable.
export function activeBuffs(stats: ClientPlayerStats): ActiveBuff[] {
    const all: ActiveBuff[] = [
        { type: "haste", label: buffLabel("haste"), color: buffColor("haste"), ticks: stats.hasteTicks, maxTicks: stats.hasteMaxTicks },
        { type: "shield", label: buffLabel("shield"), color: buffColor("shield"), ticks: stats.shieldTicks, maxTicks: stats.shieldMaxTicks },
        { type: "invis", label: buffLabel("invis"), color: buffColor("invis"), ticks: stats.invisTicks, maxTicks: stats.invisMaxTicks },
        { type: "ricochet", label: buffLabel("ricochet"), color: buffColor("ricochet"), ticks: stats.ricochetTicks, maxTicks: stats.ricochetMaxTicks },
        { type: "rapidfire", label: buffLabel("rapidfire"), color: buffColor("rapidfire"), ticks: stats.rapidfireTicks, maxTicks: stats.rapidfireMaxTicks },
    ]
    return all
        .filter((buff) => buff.ticks > 0)
        // Longer total window first; ties (and equal windows) broken by who has
        // more time left, so the freshest strong buff sits at the top.
        .sort((a, b) => (b.maxTicks - a.maxTicks) || (b.ticks - a.ticks))
}

// A single compact active-buff badge for ANY player, used by the scoreboard to
// dot a row when that player currently holds a timed buff. Carries only what a
// tiny chip needs: the buff type (for a stable React key), its shared label
// (tooltip) and color (the dot fill).
export interface PlayerBuffBadge {
    type: BuffType
    label: string
    color: string
}

// The fixed badge order, longest-window buffs first, so a player's chips always
// read in the same order no matter the insertion order of the BuffRemaining map.
const BUFF_BADGE_ORDER: readonly BuffType[] = [
    "haste", "ricochet", "rapidfire", "invis", "shield",
]

// Pure selector: the timed buffs a given player CURRENTLY holds, derived from the
// per-player live remaining-ticks map (BuffRemaining, keyed "<id>:<type>") that
// the store mirrors each sync off the networked ship.timings. A buff shows while
// its remaining ticks are > 0. Returned in a stable badge order. Reads only the
// already-mirrored map (no store/DOM access) so it is trivially unit-testable.
export function playerActiveBuffs(remaining: BuffRemaining, playerId: string): PlayerBuffBadge[] {
    return BUFF_BADGE_ORDER
        .filter((type) => (remaining[buffRemainingKey(playerId, type)] ?? 0) > 0)
        .map((type) => ({ type, label: buffLabel(type), color: buffColor(type) }))
}

export interface GameStoreState {
    loading: boolean

    phase: PipPipGamePhase
    countdownMs: number

    // Active mode + its target, mirrored from game.settings so the HUD can show
    // "First to N" (DEATHMATCH) or the match clock (KILL_FRENZY).
    mode: PipPipGameMode
    maxKills: number
    // TEAM_DEATHMATCH team count, mirrored from game.settings so the HUD + the
    // scoreboard render exactly the active number of teams (2..6).
    numTeams: number
    // KILL_FRENZY match length in whole minutes (the host-set target, mirrored so
    // the lobby Match panel can show + step it).
    matchMinutes: number
    // KILL_FRENZY remaining time, in whole seconds (0 outside that mode/MATCH).
    matchTimerSeconds: number

    // How many bots are currently in the lobby (derived each sync from the players
    // where isBot). Drives the host-only Bots section so it always shows the live
    // count after an add/remove/clear/fill rides back from the server.
    botCount: number

    // End-of-match result, shown on the RESULTS screen. winnerName is the lone
    // winner's name (empty for a tie or a no-kill "Time!"); winnerCount is the
    // number of winners (0 = none, 1 = clean win, >1 = tie).
    winnerName: string
    winnerCount: number

    isHost: boolean
    ping: number

    mapIndex: number
    // The active CUSTOM map's display name, or null when a built-in map is
    // active. Derived in sync from the game's mapIndex/mapType so MapSelect can
    // show the uploaded map as the current selection (built-in cards then show
    // none highlighted, which is correct since a custom mapIndex is -1).
    customMapName: string | null

    clientPlayerShipIndex: number
    clientPlayerShipType: ShipType
    clientPlayerStats: ClientPlayerStats

    // Spectator UI state for the local player.
    clientSpectating: boolean
    spectateTargetName: string
    // Live stats of the player currently being spectated, in the SAME shape the
    // self-HUD uses, so the spectate panel's mini-HUD reuses the same health/ammo/
    // buff presentation. null when not spectating, when free-roaming, or when there
    // is no valid target (so the mini-HUD hides instead of showing stale data).
    spectateTargetStats: ClientPlayerStats | null

    players: GameStorePlayer[]

    showPlayerList: boolean

    // Debug overlay visibility, toggled by the backquote (`) key. Exposed on the
    // store (not just local React state) so the Pixi renderer can read it each
    // frame to draw its in-world debug layer (e.g. bot paths) in lock-step with
    // the React DebugOverlay panel.
    debug: boolean

    chatMessages: ChatMessage[]
    outgoingMessages: string[]

    killFeed: KillEntry[]
    buffFeed: BuffEntry[]

    // Live remaining buff ticks for every player (see BuffRemaining), refreshed
    // each sync so the tactical feed can count down a picker's buff window. tps is
    // mirrored alongside so countdown labels can convert ticks to seconds.
    buffRemaining: BuffRemaining
    tps: number

    addChatMessage: (msg: ChatMessage) => void
    clearChatMessages: () => void
    addKill: (killerName: string, killedName: string, killerShipIndex?: number) => void
    addBuffPickup: (playerId: string, playerName: string, type: BuffType) => void
    addOutgoingMessage: (text: string) => void
    consumeOutgoingMessages: () => string[]
    setDebug: (debug: boolean) => void
    sync: () => void
}

// Monotonic id for kill/buff feed entries, used PURELY as the React list key.
// The old `Date.now() + feed.length` scheme collided once a feed hit its cap: the
// slice pins length at MAX, so a same-millisecond batch (a multi-kill, or several
// pickups in one tick) produced duplicate keys. A plain counter is always unique.
let feedEntrySeq = 0

export const useGameStore = create<GameStoreState>((set, get) => ({
    loading: false,

    phase: PipPipGamePhase.SETUP,
    countdownMs: 0,

    mode: PipPipGameMode.DEATHMATCH,
    maxKills: 0,
    numTeams: 2,
    matchMinutes: 0,
    matchTimerSeconds: 0,

    botCount: 0,

    winnerName: "",
    winnerCount: 0,

    isHost: false,
    ping: 0,

    mapIndex: 0,
    customMapName: null,

    clientPlayerShipIndex: 0,
    clientPlayerShipType: PIP_SHIPS[0],
    clientPlayerStats: {
        reloading: false,
        ammo: 0, ammoMax: 0,
        health: 0, healthMax: 0,
        spawned: false, spawnTimeout: 0,
        shieldTicks: 0, shieldMaxTicks: SHIELD_TICKS,
        hasteTicks: 0, hasteMaxTicks: HASTE_TICKS,
        invisTicks: 0, invisMaxTicks: INVIS_TICKS,
        ricochetTicks: 0, ricochetMaxTicks: RICOCHET_TICKS,
        rapidfireTicks: 0, rapidfireMaxTicks: RAPIDFIRE_TICKS,
        tacticalReloadTicks: 0, tacticalReloadMaxTicks: 0,
        tacticalAmmo: 0, tacticalAmmoMax: 0,
    },

    clientSpectating: false,
    spectateTargetName: "",
    spectateTargetStats: null,

    players: [],

    showPlayerList: false,

    debug: false,

    chatMessages: [],
    outgoingMessages: [],

    killFeed: [],
    buffFeed: [],

    buffRemaining: {},
    tps: 20,

    addChatMessage: (msg) => set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
    // Clearing chat also clears the kill + buff feeds: they share the same
    // lifecycle (e.g. the local player (re)joining) and the /clear command.
    clearChatMessages: () => set({ chatMessages: [], killFeed: [], buffFeed: [] }),
    addKill: (killerName, killedName, killerShipIndex) => set((s) => {
        const entry: KillEntry = {
            id: feedEntrySeq++,
            killerName,
            killedName,
            killerShipIndex,
            time: Date.now(),
        }
        return { killFeed: [...s.killFeed, entry].slice(-KILL_FEED_MAX) }
    }),
    addBuffPickup: (playerId, playerName, type) => set((s) => {
        const entry: BuffEntry = {
            id: feedEntrySeq++,
            playerId,
            playerName,
            type,
            time: Date.now(),
        }
        // A timed buff has at most ONE live feed row per player: drop any prior
        // entry for the same player+buff (an expired-but-not-yet-evicted one, or a
        // refresh) before appending, so visibleTacticalBuffs - which keys the
        // live remaining ticks on player+type - can never resurrect a stale row or
        // show two identical countdowns. Instant pickups (health/ammo) are not
        // deduped; each is its own transient line.
        const base = isTimedBuff(type)
            ? s.buffFeed.filter((e) => !(e.playerId === playerId && e.type === type))
            : s.buffFeed
        return { buffFeed: [...base, entry].slice(-BUFF_FEED_MAX) }
    }),
    addOutgoingMessage: (text) => set((s) => ({
        outgoingMessages: [...s.outgoingMessages, text.trim().substring(0, CHAT_MAX_MESSAGE_LENGTH)],
    })),
    consumeOutgoingMessages: () => {
        const current = get().outgoingMessages
        if (current.length === 0) return []
        set({ outgoingMessages: [] })
        return current
    },

    setDebug: (debug) => set({ debug }),

    sync: () => {
        const { game } = GAME_CONTEXT
        const gameClientPlayer = getClientPlayer(game)

        // Resolve the lone winner's name from game.winnerIds (the client mirrors
        // only the first id; winnerCount distinguishes win / tie / none).
        const winnerName = game.winnerIds.length > 0
            ? (game.players[game.winnerIds[0]]?.name ?? "")
            : ""

        // Mirror every player's live timed-buff remaining ticks (off the networked
        // ship.timings) so the tactical feed can count down a picker's window.
        // Only buffs with time left are written, keeping the map small.
        const buffRemaining: BuffRemaining = {}
        for (const player of Object.values(game.players)) {
            const t = player.ship.timings
            if (t.haste > 0) buffRemaining[buffRemainingKey(player.id, "haste")] = t.haste
            if (t.shield > 0) buffRemaining[buffRemainingKey(player.id, "shield")] = t.shield
            if (t.invisibility > 0) buffRemaining[buffRemainingKey(player.id, "invis")] = t.invisibility
            if (t.ricochet > 0) buffRemaining[buffRemainingKey(player.id, "ricochet")] = t.ricochet
            if (t.rapidfire > 0) buffRemaining[buffRemainingKey(player.id, "rapidfire")] = t.rapidfire
        }

        const next: Partial<GameStoreState> = {
            phase: game.phase,
            countdownMs: game.countdown / game.tps * 1000,
            mode: game.settings.mode,
            maxKills: game.settings.maxKills,
            numTeams: game.settings.numTeams,
            matchMinutes: game.settings.matchMinutes,
            matchTimerSeconds: Math.ceil(game.matchTimer / game.tps),
            botCount: Object.values(game.players).filter((p) => p.isBot === true).length,
            winnerName,
            winnerCount: game.winnerIds.length,
            mapIndex: game.mapIndex,
            // A custom map has mapIndex -1 and a synthetic mapType whose name is
            // the uploaded map's; surface that name so MapSelect shows it as the
            // current selection. null for any built-in map.
            customMapName: game.mapIndex === CUSTOM_MAP_INDEX
                ? (game.mapType?.name ?? "Custom Map")
                : null,
            showPlayerList: GAME_CONTEXT.keyboard.state.Tab === true,
            players: Object.values(game.players).map(playerToGameStore),
            buffRemaining,
            tps: game.tps,
        }

        if (typeof gameClientPlayer !== "undefined") {
            next.isHost = game.host?.id === gameClientPlayer.id
            next.ping = gameClientPlayer.ping
            next.clientPlayerShipIndex = gameClientPlayer.shipIndex
            next.clientPlayerShipType = PIP_SHIPS[gameClientPlayer.shipIndex]
            next.clientPlayerStats = playerStats(gameClientPlayer)
            next.clientSpectating = gameClientPlayer.spectator

            // While spectating, resolve who the camera is watching and mirror that
            // target's live stats with the SAME mapper the self-HUD uses, so the
            // spectate panel's mini-HUD shows their health/ammo/buffs. Free-roam
            // and a missing target both yield no target, so we clear the stats and
            // the mini-HUD hides (no stale data, no crash). getSpectateTarget reads
            // the live game.players, so a despawn/leave falls back or returns
            // undefined automatically; the stats update every sync as it changes.
            const target = gameClientPlayer.spectator && GAME_CONTEXT.spectateFreeRoam === false
                ? GAME_CONTEXT.getSpectateTarget()
                : undefined
            next.spectateTargetName = typeof target !== "undefined" ? target.name : ""
            next.spectateTargetStats = typeof target !== "undefined" ? playerStats(target) : null
        }

        set(next)
    },
}))
