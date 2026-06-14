import { EventEmitter } from "@pip-pip/core/src/common/events"
import { PointPhysicsWorld, Vector2, airResistanceMultiplier, limitSpeed, WALL_RESOLVE_ITERATIONS } from "@pip-pip/core/src/physics"
import { distanceBetweenSegments, nearestPointFromSegment, radianDifference } from "@pip-pip/core/src/math"

import { Bullet, BulletPool, BulletType, MAX_BULLET_BOUNCES } from "./bullet"
import { Powerup, PowerupPool, PowerupType, applyPowerupEffect, HASTE_MULTIPLIER } from "./powerup"
import { PipPlayer, PlayerInputs } from "./player"
import { updateBotInputs, BotDifficulty, makeBotSkill } from "./ai"
import { generateId } from "@pip-pip/core/src/lib/utils"
import { PipShip } from "./ship"
import { PipGameMap } from "./map"
import { PipMapType, PIP_MAPS } from "../maps"
import { tickDown } from "./utils"
import { INTERP_DELAY_TICKS } from "./constants"


export type PipPipGameEventMap = {
    addPlayer: { player: PipPlayer },
    removePlayer: { player: PipPlayer },
    playerIdleChange: { player: PipPlayer },
    playerSpectateChange: { player: PipPlayer },

    playerDetailsChange: { player: PipPlayer },

    playerSetShip: { player: PipPlayer, ship: PipShip },
    playerRemoveShip: { player: PipPlayer, ship: PipShip },
    playerSpawned: { player: PipPlayer },
    playerScoreChanged: { player: PipPlayer },
    playerTeamChange: { player: PipPlayer },
    playerReadyChange: { player: PipPlayer },

    setHost: { player: PipPlayer },
    removeHost: undefined,

    settingsChange: undefined,
    phaseChange: undefined,

    setMap: { mapIndex: number, mapType: PipMapType},

    addBullet: { bullet: Bullet },
    removeBullet: { bullet: Bullet },

    addShip: { ship: PipShip },
    removeShip: { ship: PipShip },
    playerReloadStart: { player: PipPlayer },
    playerReloadEnd: { player: PipPlayer },

    dealDamage: { dealer: PipPlayer, target: PipPlayer, damage: number },
    playerKill: { killer: PipPlayer, killed: PipPlayer },

    powerupSpawn: { powerup: Powerup },
    powerupDespawn: { powerup: Powerup },
    powerupPickup: { player: PipPlayer, powerup: Powerup },
}

export type PipPipGameOptions = {
    shootAiBullets: boolean,
    shootPlayerBullets: boolean,

    calculateAi: boolean,
    assignHost: boolean,
    triggerPhases: boolean
    triggerSpawns: boolean,
    setScores: boolean,

    triggerDamage: boolean,
    considerPlayerPing: boolean,

    spawnPowerups: boolean,
}

export enum PipPipGameMode {
    // First to settings.maxKills kills wins (free-for-all).
    DEATHMATCH,
    // Timed match: the highest kill count when the clock runs out wins. Ties
    // (two or more players sharing the top kill count) are allowed.
    KILL_FRENZY,
    // Two balanced teams; a team's score is the sum of its members' kills.
    // First team to settings.maxKills (combined) wins. Friendly fire is off
    // (teammates cannot hurt each other). Drives useTeams + friendlyFire in the
    // host config path.
    TEAM_DEATHMATCH,
}

// The two TEAM_DEATHMATCH teams. -1 marks an unassigned player (lobby / before
// startMatch). Kept here so logic and the networking layer share one source.
export const TEAM_UNASSIGNED = -1
export const TDM_TEAMS = [0, 1] as const

// Hard cap on the number of bots in a single match. Intentional and
// load-bearing: every bot is server-simulated each tick (AI brain + physics +
// collision), so the per-tick cost scales with bot count. Capping it keeps the
// server CPU/RAM bounded. Enforced authoritatively in addBot, so no path
// (chat commands, host config, fill) can exceed it. The count stays a uint8 on
// the wire.
export const MAX_BOTS = 8

// fillBots' target headcount for the free-for-all modes (DEATHMATCH / KILL_FRENZY):
// it tops the lobby up toward this many TOTAL players (humans + bots) so a solo
// host gets a lively room without overcrowding it.
export const FILL_TARGET_PLAYERS = 8

// A host's bot-difficulty choice. A concrete BotDifficulty is stored on the bot;
// "mixed" is config-only - each added bot rolls its own random difficulty instead.
export type BotDifficultyChoice = BotDifficulty | "mixed"

export enum PipPipGamePhase {
    SETUP,
    COUNTDOWN,
    MATCH,
    RESULTS,
}

export type PipPipGameSettings = {
    mode: PipPipGameMode,
    useTeams: boolean,
    maxDeaths: 0 | number, // 0 for infinite respawn
    maxKills: 0 | number, // 0 for infinite kills
    // KILL_FRENZY match length in whole minutes. Ignored by DEATHMATCH.
    matchMinutes: number,
    friendlyFire: boolean,
}

export class PipPipGame{
    readonly tps = 20
    readonly deltaMs = 1000 / this.tps
    readonly maxTeams = 4

    clientPlayerId = ""

    options: PipPipGameOptions = {
        shootAiBullets: false,
        shootPlayerBullets: false,
        calculateAi: true,
        assignHost: false,
        triggerPhases: false,
        triggerSpawns: false,
        setScores: false,
        triggerDamage: false,
        considerPlayerPing: false,
        spawnPowerups: false,
    }

    events: EventEmitter<PipPipGameEventMap> = new EventEmitter()
    physics: PointPhysicsWorld = new PointPhysicsWorld()

    players: Record<string, PipPlayer> = {}
    bullets: BulletPool
    powerups: PowerupPool
    ships: Record<string, PipShip> = {}

    // Server-authoritative powerup spawning (gated on options.spawnPowerups):
    // at most POWERUP_MAX_ACTIVE alive at once, a fresh one attempted every
    // POWERUP_SPAWN_INTERVAL_TICKS during MATCH. Respawn falls out of the same
    // cap/interval loop once a pickup frees a slot.
    readonly POWERUP_MAX_ACTIVE = 4
    readonly POWERUP_SPAWN_INTERVAL_TICKS = this.tps * 8 // ~8 seconds
    // Counts down to the next spawn attempt; starts at a full interval so the
    // field is not flooded the instant a match begins.
    powerupSpawnTimer = this.tps * 8

    host?: PipPlayer

    tickNumber = 0
    lastTick = Date.now()

    phase: PipPipGamePhase = PipPipGamePhase.SETUP
    countdown = 0

    // KILL_FRENZY match clock, in ticks. Counts down only during MATCH and only
    // for the timed mode (0 / unused for DEATHMATCH). Networked via the
    // matchTimer packet so the client HUD can show the remaining time, and the
    // authoritative server ends the match when it reaches 0.
    matchTimer = 0

    // RESULTS hold timer, in ticks. When the win condition fires the game enters
    // RESULTS and this counts down; on reaching 0 the authoritative server
    // returns the lobby to SETUP so a fresh match can be started.
    readonly RESULTS_HOLD_TICKS = this.tps * 8 // ~8 seconds
    resultsTimer = 0

    // The winners recorded when the match ended, by player id. DEATHMATCH always
    // has exactly one; KILL_FRENZY has one OR several on a tie. Empty in every
    // other phase (and when a timed match ends with literally no kills scored).
    // The client mirrors this via the gameResults packet to draw the podium.
    winnerIds: string[] = []

    mapIndex!:number
    mapType!: PipMapType
    map!: PipGameMap

    settings: PipPipGameSettings = {
        mode: PipPipGameMode.DEATHMATCH,
        useTeams: false,
        maxDeaths: 0,
        maxKills: 25,
        matchMinutes: 3,
        friendlyFire: false,
    }

    constructor(options: Partial<PipPipGameOptions> = {}){
        this.options = {
            ...this.options,
            ...options,
        }
        this.physics.options.baseTps = this.tps
        this.bullets = new BulletPool(this)
        this.powerups = new PowerupPool(this)
        this.setMap()
    }

    setMap(index = 0){
        index = Math.max(0, Math.min(index, PIP_MAPS.length - 1))
        if(this.mapIndex === index) return
        if(typeof this.map !== "undefined"){
            // remove the current map
            for(const rectWall of this.map.rectWalls){
                this.physics.removeRectWall(rectWall)
            }
            for(const segWall of this.map.segWalls){
                this.physics.removeSegWall(segWall)
            }
        }

        const mapType = PIP_MAPS[index]
        const map = mapType.createMap()

        // Add walls
        for(const rectWall of map.rectWalls){
            this.physics.addRectWall(rectWall)
        }

        for(const segWall of map.segWalls){
            this.physics.addSegWall(segWall)
        }

        this.despawnPlayers()
        this.map = map
        this.mapIndex = index
        this.mapType = mapType

        this.events.emit("setMap", { mapIndex: index, mapType })
    }

    setSettings(settings: Partial<PipPipGameSettings> = {}){
        if(this.phase !== PipPipGamePhase.SETUP) return
        let changed = false
        for(const _key in settings){
            const key = _key as keyof PipPipGameSettings
            if(this.settings[key] !== settings[key]){
                changed = true
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const s = this.settings as any // TODO: Fix type
                if(key in s) s[key] = settings[key]
            }
        }
        if(changed){
            this.events.emit("settingsChange")
        }
    }

    createPlayer(id: string){
        return new PipPlayer(this, id)
    }

    // Bots are players keyed by a 2-char id whose FIRST char is "~" (0x7E), e.g.
    // "~0".."~z". The connection-id pool is alphanumerics only (see
    // generateId), so a "~"-prefixed id can never collide with a real
    // connection id, and it is exactly 2 chars so it round-trips through the
    // $string(CONNECTION_ID_LENGTH=2) playerId serializer like any player id.
    nextBotId(){
        const taken = Object.keys(this.players)
        let id = "~" + generateId(1)
        while(taken.includes(id)){
            id = "~" + generateId(1)
        }
        return id
    }

    // Every bot currently in the lobby, in INSERTION order (game.players keeps it,
    // since a bot id like "~0" is not an array-index key). The newest bots are at
    // the end, which removeBots relies on to drop the most-recently-added first.
    get bots(){
        return Object.values(this.players).filter(player => player.isBot === true)
    }

    // How many bots are in the lobby right now. Mirrored to the client store +
    // wire as a uint8 (MAX_BOTS keeps it well under 255).
    get botCount(){
        return this.bots.length
    }

    // A short difficulty tag for a bot's display NAME (so the difficulty syncs
    // through the existing player-name broadcast with no new per-player packet).
    // Kept tiny + alphanumeric so a full bot name stays inside the name limits.
    botDifficultyTag(difficulty: BotDifficulty){
        if(difficulty === BotDifficulty.HARD) return "H"
        if(difficulty === BotDifficulty.EASY) return "E"
        return "M"
    }

    // Turn a host's difficulty choice into a concrete BotDifficulty: "mixed" rolls
    // a random one PER bot, anything else is used as-is. rng is injected so the
    // spread is deterministic in tests.
    resolveBotDifficulty(choice: BotDifficultyChoice, rng: () => number = Math.random): BotDifficulty {
        if(choice === "mixed"){
            const all = [BotDifficulty.EASY, BotDifficulty.MEDIUM, BotDifficulty.HARD]
            return all[Math.floor(rng() * all.length)] ?? BotDifficulty.MEDIUM
        }
        return choice
    }

    // Add one training-grounds bot with a difficulty + a per-bot varied skill
    // profile. It self-registers into game.players (like any PipPlayer) and is
    // broadcast to every real client by the normal per-player broadcast, since
    // that iterates all players. During a live MATCH the bot is spawned
    // immediately so it joins the fight at once. The difficulty is reflected in
    // the display name (e.g. "BOT-H-3"), so it rides the existing name broadcast.
    // rng is injected so the skill variance is deterministic in tests.
    // Returns undefined (and adds nothing) once the match is already at the
    // MAX_BOTS hard cap, so every add path is bounded here at one authoritative
    // point.
    addBot(difficulty: BotDifficulty = BotDifficulty.MEDIUM, rng: () => number = Math.random){
        if(this.botCount >= MAX_BOTS) return undefined
        const bot = this.createPlayer(this.nextBotId())
        bot.isBot = true
        bot.difficulty = difficulty
        bot.skill = makeBotSkill(difficulty, rng)
        bot.setName("BOT-" + this.botDifficultyTag(difficulty) + "-" + bot.id.slice(1).toUpperCase())
        this.addPlayerMidGame(bot)
        return bot
    }

    // Add `count` bots, never pushing the total bot count past MAX_BOTS. difficulty
    // may be a concrete BotDifficulty or "mixed" (each bot then rolls its own).
    // rng is injected so both the difficulty spread and per-bot variance are
    // deterministic in tests.
    addBots(count: number, difficulty: BotDifficultyChoice = "mixed", rng: () => number = Math.random){
        const bots: PipPlayer[] = []
        const safeCount = Math.max(0, Math.floor(count))
        for(let i = 0; i < safeCount; i++){
            const bot = this.addBot(this.resolveBotDifficulty(difficulty, rng), rng)
            // Stop as soon as the MAX_BOTS hard cap is reached (addBot returns
            // undefined), so addBots never overshoots the authoritative cap.
            if(typeof bot === "undefined") break
            bots.push(bot)
        }
        return bots
    }

    // Remove the `count` most-recently-added bots (newest first). Real players are
    // never touched. Returns the number actually removed.
    removeBots(count: number){
        const safeCount = Math.max(0, Math.floor(count))
        // bots is in insertion order, so the newest are at the end - reverse to
        // remove them first.
        const newestFirst = this.bots.reverse()
        let removed = 0
        for(const bot of newestFirst){
            if(removed >= safeCount) break
            bot.remove()
            removed++
        }
        return removed
    }

    // Add enough bots to sensibly fill the lobby toward FILL_TARGET_PLAYERS total
    // players, capped at MAX_BOTS. The target is the same for every mode, but the
    // way bots land on teams differs: in TEAM_DEATHMATCH a bot added during a live
    // match lands on the SMALLER team (addPlayerMidGame reuses smallerTeam), and a
    // bot added in the lobby is split into a balanced team at startMatch
    // (assignTeams), so a fill keeps the two sides even either way. Free-for-all
    // modes just top the headcount up. rng is injected so the difficulty spread +
    // per-bot variance stay deterministic in tests.
    fillBots(difficulty: BotDifficultyChoice = "mixed", rng: () => number = Math.random){
        const target = FILL_TARGET_PLAYERS - this.playerCount
        return this.addBots(Math.max(0, target), difficulty, rng)
    }

    clearBots(){
        let removed = 0
        for(const player of Object.values(this.players)){
            if(player.isBot === true){
                player.remove()
                removed++
            }
        }
        return removed
    }

    destroy(){
        this.players = {}
        this.ships = {}
        this.bullets.destroy()
        this.powerups.destroy()
        this.events.destroy()
        this.physics.destroy()
    }

    setPhase(phase: PipPipGamePhase){
        this.phase = phase
        this.events.emit("phaseChange")
    }

    startMatch(){
        this.countdown = this.tps * 6 // 6 second count down
        this.powerupSpawnTimer = this.POWERUP_SPAWN_INTERVAL_TICKS
        // Arm the KILL_FRENZY clock (whole minutes -> ticks). DEATHMATCH never
        // reads matchTimer, so leaving it set is harmless there; clamped to at
        // least one minute so a misconfigured 0 can never end the match instantly.
        const minutes = Math.max(1, Math.floor(this.settings.matchMinutes))
        this.matchTimer = minutes * 60 * this.tps
        // Clear any winners left over from a previous match so the fresh round
        // starts with an empty podium.
        this.winnerIds = []
        this.resultsTimer = 0
        this.setPhase(PipPipGamePhase.COUNTDOWN)
        // TEAM_DEATHMATCH: assign balanced teams for the fresh match. Gated on
        // triggerSpawns (the authoritative server) like spawning, so the client
        // never invents team assignments - it mirrors them from playerTeam
        // packets. Free-for-all modes leave every player unassigned.
        if(this.options.triggerSpawns === true && this.settings.mode === PipPipGameMode.TEAM_DEATHMATCH){
            this.assignTeams()
        }
        // Clear every player's lobby "ready up" flag so each fresh round starts
        // unready. Gated on triggerSpawns (the authoritative server) like team
        // assignment, so the client never invents ready state - it mirrors it
        // from playerReady packets. setReady emits playerReadyChange for any
        // player that was ready, so the clear rides the wire.
        if(this.options.triggerSpawns === true){
            for(const player of Object.values(this.players)){
                player.setReady(false)
            }
        }
        if(this.options.triggerSpawns === true){
            const players = Object.values(this.players)
            for(const player of players){
                // Clear any leftover respawn timer from a previous round so a
                // dead-when-restarted player is not blocked from spawning (a
                // non-zero spawnTimeout fails canSpawn) and does not start the
                // match stranded on the respawn screen.
                player.timings.spawnTimeout = 0
                player.setSpawned(false)
                this.spawnPlayer(player)
            }
        }
        if(this.options.setScores){
            const players = Object.values(this.players)
            for(const player of players){
                player.resetScores()
            }
        }
    }

    get playerCount(){ return Object.keys(this.players).length }
    
    setHost(player: PipPlayer){
        this.host = player
        this.events.emit("setHost", { player })
    }

    // A player is eligible to be host only if it is a present, connected
    // (non-idle), real (non-bot) player. Idle players are disconnected tabs and
    // bots have no connection to drive host-only controls, so neither should
    // ever hold the host slot.
    isHostEligible(player: PipPlayer){
        if(!(player.id in this.players)) return false
        if(player.idle === true) return false
        if(player.isBot === true) return false
        return true
    }

    // Recompute the host so it is always a present, non-idle, non-bot player
    // when one exists. Called on join/leave (PipPlayer add/remove) and every
    // tick (update) so a host going idle/disconnecting hands off promptly.
    //
    // Keep the current host if it is still eligible (no needless churn / event
    // spam). Otherwise promote the first eligible player — effectively the
    // longest-present real, connected player, since insertion order is
    // preserved. When the lobby has no eligible player (empty, or only bots /
    // idle players remain) the host is cleared. A first player joining an empty
    // lobby falls out of this naturally: they are the only eligible candidate,
    // so they become host.
    setHostIfNeeded(){
        if(this.options.assignHost !== true) return
        if(typeof this.host !== "undefined" && this.isHostEligible(this.host)) return
        const candidate = Object.values(this.players).find(player => this.isHostEligible(player))
        if(typeof candidate === "undefined"){
            this.removeHost()
        } else{
            this.setHost(candidate)
        }
    }

    removeHost(){
        if(typeof this.host !== "undefined"){
            this.host = undefined
            this.events.emit("removeHost")
        }
    }

    update(){
        this.tickNumber++
        this.lastTick = Date.now()

        // Re-evaluate the host every tick (gated on assignHost). Joins/leaves
        // already trigger this via PipPlayer add/remove, but a host going idle
        // (disconnected tab) flips player.idle without going through here, so
        // the per-tick check is what hands the host off to an active player.
        this.setHostIfNeeded()

        if(this.phase === PipPipGamePhase.SETUP){
            // despawn all players
            this.despawnPlayers()
        }

        if(this.phase === PipPipGamePhase.COUNTDOWN){
            this.countdown--
            if(this.countdown <= 0){
                this.countdown = 0
                if(this.options.triggerPhases){
                    this.setPhase(PipPipGamePhase.MATCH)
                }
            }
        }

        if(this.phase === PipPipGamePhase.MATCH){
            // KILL_FRENZY clock. Tick it down only on the authoritative side
            // (setScores owns scoring/timing) so a non-authoritative client never
            // ends the match itself; it mirrors matchTimer purely from packets.
            if(this.options.setScores === true && this.settings.mode === PipPipGameMode.KILL_FRENZY){
                this.matchTimer = tickDown(this.matchTimer, 1)
            }
            // Decide a winner (DEATHMATCH kill cap, or the frenzy clock hitting 0)
            // and move to RESULTS. Gated so only the authoritative server drives
            // the transition; the client follows via the phase + results packets.
            if(this.options.setScores === true && this.options.triggerPhases === true){
                this.checkWinCondition()
            }
        }

        if(this.phase === PipPipGamePhase.RESULTS){
            // Hold the results for a few seconds, then drop the lobby back to
            // SETUP so the host can configure and start the next match. Only the
            // authoritative server advances this; the client waits for the phase
            // packet that this triggers.
            if(this.options.triggerPhases === true){
                this.resultsTimer = tickDown(this.resultsTimer, 1)
                if(this.resultsTimer <= 0){
                    this.setPhase(PipPipGamePhase.SETUP)
                }
            }
        }

        if(this.phase !== PipPipGamePhase.SETUP){
            this.updateSystems()
            this.updatePhysics()
        }
    }

    // Evaluate the active mode's win condition and, if met, record the winner(s)
    // and transition to RESULTS. Authoritative only: callers gate this on
    // setScores + triggerPhases. DEATHMATCH ends the instant any player reaches
    // settings.maxKills (the highest-kill player is the winner). KILL_FRENZY ends
    // when matchTimer hits 0, with the top scorer(s) winning and ties allowed.
    checkWinCondition(){
        if(this.settings.mode === PipPipGameMode.DEATHMATCH){
            const target = this.settings.maxKills
            // maxKills === 0 means "no kill cap", so DEATHMATCH never ends on its
            // own (there is no win condition to check).
            if(target <= 0) return
            const reached = Object.values(this.players).find(player => player.score.kills >= target)
            if(typeof reached === "undefined") return
            this.endMatch(this.topScorers())
            return
        }
        if(this.settings.mode === PipPipGameMode.KILL_FRENZY){
            if(this.matchTimer > 0) return
            // Time! The top kill count takes it; topScorers returns every player
            // tied at that count (so a tie naturally yields multiple winners, and
            // a match with zero kills yields no winner at all).
            this.endMatch(this.topScorers())
            return
        }
        if(this.settings.mode === PipPipGameMode.TEAM_DEATHMATCH){
            const target = this.settings.maxKills
            // maxKills === 0 means "no kill cap", so the match never ends on its
            // own (same as DEATHMATCH).
            if(target <= 0) return
            // The first team whose combined kills reach the cap wins; its members
            // become the winners (reusing the RESULTS / winnerIds machinery).
            const winningTeam = TDM_TEAMS.find(team => this.teamScore(team) >= target)
            if(typeof winningTeam === "undefined") return
            this.endMatch(this.teamPlayers(winningTeam))
        }
    }

    // The players currently on a given TEAM_DEATHMATCH team. Pure read; used by
    // team scoring, team assignment balancing, and endMatch's winner list.
    teamPlayers(team: number): PipPlayer[] {
        return Object.values(this.players).filter(player => player.team === team)
    }

    // A team's TEAM_DEATHMATCH score: the sum of its members' kills. Used by the
    // win condition and mirrored to the HUD. Pure read of current scores.
    teamScore(team: number): number {
        let total = 0
        for(const player of this.teamPlayers(team)){
            total += player.score.kills
        }
        return total
    }

    // Pick the team a NEW (or rebalancing) player should join: the smaller of the
    // two teams, breaking a tie toward team 0. Counts only non-spectator players
    // so spectators never skew the balance. Used by assignTeams (match start) and
    // when a player joins/deploys mid-TDM.
    smallerTeam(): number {
        const sizes = TDM_TEAMS.map(team =>
            this.teamPlayers(team).filter(player => player.spectator === false).length)
        return sizes[0] <= sizes[1] ? TDM_TEAMS[0] : TDM_TEAMS[1]
    }

    // Split every non-spectator player into two BALANCED teams, alternating so
    // the teams differ by at most one. Spectators are left unassigned (-1) so they
    // never count toward a team or its score. Called from startMatch on the
    // authoritative side; setTeam emits playerTeamChange so each assignment rides
    // the wire. Bots are players too, so they are assigned here like anyone else.
    assignTeams(){
        // Unassign spectators outright so a leftover team from a previous match
        // never lingers on someone sitting out.
        for(const player of Object.values(this.players)){
            if(player.spectator === true){
                player.setTeam(TEAM_UNASSIGNED)
            }
        }
        const active = Object.values(this.players).filter(player => player.spectator === false)
        active.forEach((player, index) => {
            player.setTeam(TDM_TEAMS[index % TDM_TEAMS.length])
        })
    }

    // The player(s) with the strictly highest kill count, or an empty array when
    // nobody has scored a single kill (so a 0-kill timed match has no winner).
    // Returns several entries when the top count is shared (a tie). Pure read of
    // current scores; used by checkWinCondition to pick winners.
    topScorers(): PipPlayer[] {
        const players = Object.values(this.players)
        let best = 0
        for(const player of players){
            if(player.score.kills > best) best = player.score.kills
        }
        if(best <= 0) return []
        return players.filter(player => player.score.kills === best)
    }

    // Record the given winners and move to RESULTS, arming the hold timer that
    // returns the lobby to SETUP. Authoritative only (callers are gated); the
    // client receives winnerIds via the gameResults packet, not from here.
    endMatch(winners: PipPlayer[]){
        this.winnerIds = winners.map(player => player.id)
        this.resultsTimer = this.RESULTS_HOLD_TICKS
        this.setPhase(PipPipGamePhase.RESULTS)
    }

    despawnPlayers() {
        if(this.options.triggerSpawns){
            const players = Object.values(this.players)
            for(const player of players){
                if(player.spawned === true){
                    player.setSpawned(false)
                }
            }
        }
    }

    spawnPlayer(player: PipPlayer, x?: number, y?: number){
        let finalX: number
        let finalY: number
        if(typeof x === "number" && typeof y === "number"){
            finalX = x
            finalY = y
        } else{
            if(player.canSpawn === false) return
            if(this.map.spawns.length === 0) return
            const index = Math.floor(Math.random() * this.map.spawns.length)
            const spawn = this.map.spawns[index]
            const angle = Math.random() * Math.PI * 2
            finalX = Math.round(spawn.x + Math.cos(angle) * spawn.radius)
            finalY = Math.round(spawn.y + Math.sin(angle) * spawn.radius)
        }
        player.ship.physics.position.x = finalX
        player.ship.physics.position.y = finalY
        player.ship.physics.velocity.x = 0
        player.ship.physics.velocity.y = 0

        player.ship.reset()
        player.positionStates = []
        // Spawn is an authoritative teleport: drop all prediction/interp state
        // so nothing replays or interpolates across the discontinuity.
        player.resetNetworkState()

        player.setSpawned(true)
    }

    addPlayerMidGame(player: PipPlayer){
        if(this.phase === PipPipGamePhase.SETUP) return
        // TEAM_DEATHMATCH: a mid-match joiner fills the SMALLER team so the sides
        // stay balanced. Gated on triggerSpawns (authoritative) so the client
        // mirrors the team from the playerTeam packet rather than guessing. Bots
        // count here too (they are assigned before spawning below). A real player
        // is assigned now even though they are parked as a spectator, so when they
        // deploy they are already on a team.
        if(this.options.triggerSpawns === true && this.settings.mode === PipPipGameMode.TEAM_DEATHMATCH){
            player.setTeam(this.smallerTeam())
        }
        // Bots are training targets: they must join the fight immediately, so
        // spawn them at once exactly as before.
        if(player.isBot === true){
            this.spawnPlayer(player)
            return
        }
        // A REAL player joining a live match does NOT get dropped straight into
        // combat. Park them as a spectator so the per-tick respawn loop leaves
        // them alone (it skips spectators), while the client shows them the
        // loadout screen to pick a ship and choose Deploy or Spectate. Deploying
        // is the un-spectate path: the client sends playerSpectate(false), the
        // server clears the spectator flag, and the respawn loop then spawns them
        // (spawnTimeout is 0 for a fresh join, so canSpawn is true).
        player.setSpectator(true)
    }

    updateSystems(){
        if(this.phase === PipPipGamePhase.MATCH){

            // Anti-farm: despawn idle (disconnected) real players during MATCH
            // so a closed/reloaded tab does not leave a free sitting-duck kill
            // on the field. Bots are deliberately exempt — they are training
            // targets and are never idle. Gated on triggerSpawns so only the
            // authoritative server despawns; the client mirrors it via packets.
            if(this.options.triggerSpawns === true){
                for(const player of Object.values(this.players)){
                    if(player.idle === true && player.isBot === false && player.spawned === true){
                        player.setSpawned(false)
                    }
                }
            }

            // Drive AI bots before inputs are consumed. The brain writes each
            // bot's inputs directly (their inputQueue is always empty, so the
            // consume step below is a no-op for them and leaves these inputs
            // intact). Gated by calculateAi so a non-authoritative client
            // instance never re-derives bot behaviour locally.
            if(this.options.calculateAi === true){
                const allPlayers = Object.values(this.players)
                for(const player of allPlayers){
                    if(player.isBot === true && player.spawned === true){
                        updateBotInputs(player, allPlayers)
                    }
                }
            }

            // Consume one queued input per player per tick, in seq order. This
            // is a no-op on the client and for AI (their queues are empty);
            // only the server populates inputQueue (one connection's stream
            // per player), so it stays server-authoritative without a flag.
            for(const player of Object.values(this.players)){
                player.consumeQueuedInput()
            }

            for(const player of Object.values(this.players)){
                const playerIsClient = player.id === this.clientPlayerId
                const authorizedToShootBullet = playerIsClient === true || this.options.shootPlayerBullets === true
                // update player (ticks the respawn timer down, among other things)
                player.update()
                if(this.options.triggerSpawns === true){
                    // Respawn any DEAD, active (non-spectator, non-idle) player
                    // once their timer has elapsed. Checking `spawnTimeout === 0`
                    // (rather than the old "was waiting AND just hit zero") also
                    // rescues a player who is somehow despawned with no timer at
                    // all (e.g. a spawn that could not be placed at match start):
                    // they respawn at once instead of being stranded on the
                    // respawn screen forever. Idle (disconnected) players are
                    // excluded so the anti-farm despawn sticks.
                    if(
                        player.spawned === false &&
                        player.spectator === false &&
                        player.idle === false &&
                        player.timings.spawnTimeout === 0
                    ){
                        this.spawnPlayer(player)
                    }
                }

                // reload input
                if(authorizedToShootBullet && player.ship.canReload && player.inputs.doReload){
                    player.ship.reload()
                }
            }


            for(const player of Object.values(this.players)){
                const playerIsClient = player.id === this.clientPlayerId
                const authorizedToShootBullet = playerIsClient === true || this.options.shootPlayerBullets === true

                // update bullet stuff
                if(authorizedToShootBullet && player.inputs.useWeapon === true && player.spawned === true){
                    // shoot bullets
                    if(player.ship.shoot()){
                        const spread = player.ship.stats.weapon.spread
                        // A multi-pellet primary splits its configured damage
                        // among the pellets so a wide spray is not strictly
                        // better than a single focused shot (total on-target
                        // damage matches a single bullet when every pellet hits).
                        const damage = player.ship.stats.bullet.damage.normal / Math.max(1, spread.count)
                        this.spawnSpread(
                            player,
                            spread.count,
                            spread.angle,
                            player.ship.stats.bullet.velocity,
                            player.ship.stats.bullet.radius,
                            damage,
                            "primary",
                        )
                    }
                }

                // tactical / secondary weapon: a slow, heavy cannon on its own
                // ammo + cooldown. Same authority + ping-rewind handling as the
                // primary weapon, driven by the useTactical input.
                if(authorizedToShootBullet && player.inputs.useTactical === true && player.spawned === true){
                    if(player.ship.shootTactical()){
                        const tactical = player.ship.stats.tactical
                        const spread = tactical.spread
                        const damage = tactical.damage.normal / Math.max(1, spread.count)
                        // The tactical weapon fires either the heavy single-target
                        // "cannon" round (default) or a "grenade" that detonates
                        // with area-of-effect damage when it ends its life. The
                        // ship's tactical.bulletKind picks which; a grenade also
                        // carries its blast radius so the AoE (and the client's
                        // explosion) can size itself.
                        const isGrenade = tactical.bulletKind === "grenade"
                        this.spawnSpread(
                            player,
                            spread.count,
                            spread.angle,
                            tactical.bullet.velocity,
                            tactical.bullet.radius,
                            damage,
                            isGrenade ? "grenade" : "tactical",
                            isGrenade ? tactical.explosionRadius : 0,
                        )
                    }
                }

                // accelerate players (shared with the client-side replay step)
                const accel = this.computeMovementAcceleration(player, player.inputs)
                player.ship.physics.velocity.x += accel.x
                player.ship.physics.velocity.y += accel.y
            }

            // update bullets
            for(const bullet of this.bullets.getActive()){
                bullet.update()

                // bullet lived too long
                if(bullet.lifespan <= 0) {
                    // A grenade that expires mid-air still detonates (AoE).
                    this.detonateGrenade(bullet)
                    this.bullets.unset(bullet)
                }
            }

            // spawn map powerups (server-authoritative)
            this.updatePowerupSpawns()
        } else{
            // destroy all bullets
            this.bullets.destroy()
            // destroy all powerups (so a match that ends clears the field)
            this.powerups.destroy()
        }
    }

    // Server-authoritative powerup spawning. Gated on options.spawnPowerups so a
    // non-authoritative client never invents pickups (it only receives them via
    // packets). Only runs during MATCH (the single MATCH-branch caller already
    // guarantees this). Tops the field up to POWERUP_MAX_ACTIVE, attempting one
    // new spawn every POWERUP_SPAWN_INTERVAL_TICKS; the same loop handles respawn
    // after a pickup frees a slot.
    updatePowerupSpawns(){
        if(this.options.spawnPowerups !== true) return

        if(this.powerupSpawnTimer > 0){
            this.powerupSpawnTimer = tickDown(this.powerupSpawnTimer, 1)
            return
        }
        this.powerupSpawnTimer = this.POWERUP_SPAWN_INTERVAL_TICKS

        if(this.powerups.getActive().length >= this.POWERUP_MAX_ACTIVE) return

        const position = this.randomPowerupPosition()
        if(typeof position === "undefined") return

        // Weighted pool: each entry is one "ticket", so a type listed more often
        // is more likely. health/ammo/haste/shield each get 2 tickets; the strong
        // "invis" cloak, "ricochet" and "rapidfire" each get a single ticket so
        // they show up roughly half as often. Extend this pool (adjust the repeats
        // to tune rarity) as types are added.
        const types: PowerupType[] = [
            "health", "health",
            "ammo", "ammo",
            "haste", "haste",
            "shield", "shield",
            "invis",
            "ricochet",
            "rapidfire",
        ]
        const type = types[Math.floor(Math.random() * types.length)]

        this.powerups.new({ position, type })
    }

    // Pick an open world position for a powerup. Reuses the map's spawn points
    // (already guaranteed open, away from walls) like spawnPlayer does — simple
    // and collision-free. Returns undefined when the map has no spawn points.
    randomPowerupPosition(){
        if(this.map.spawns.length === 0) return undefined
        const index = Math.floor(Math.random() * this.map.spawns.length)
        const spawn = this.map.spawns[index]
        const angle = Math.random() * Math.PI * 2
        return new Vector2(
            Math.round(spawn.x + Math.cos(angle) * spawn.radius),
            Math.round(spawn.y + Math.sin(angle) * spawn.radius),
        )
    }

    // Resolve powerup pickups: a SPAWNED player whose ship overlaps an active
    // powerup (circle-vs-circle, like bullet-vs-player) picks it up. The effect
    // is applied server-side and gated like damage on spawnPowerups, the powerup
    // is marked dead, and powerupPickup is emitted so the broadcast can tell
    // clients to remove it. A non-authoritative client never runs this (the flag
    // is off there); it removes powerups purely from the powerupPickup packet.
    updatePowerupPickups(){
        if(this.options.spawnPowerups !== true) return

        for(const player of Object.values(this.players)){
            if(player.spawned === false) continue
            for(const powerup of this.powerups.getActive()){
                const dx = player.ship.physics.position.x - powerup.position.x
                const dy = player.ship.physics.position.y - powerup.position.y
                const r = player.ship.physics.radius + powerup.radius
                if(dx * dx + dy * dy > r * r) continue
                this.pickupPowerup(player, powerup)
                break
            }
        }
    }

    pickupPowerup(player: PipPlayer, powerup: Powerup){
        applyPowerupEffect(powerup.type, player)
        this.events.emit("powerupPickup", { player, powerup })
        this.powerups.unset(powerup)
    }

    // Emit `count` bullets for one shot, fanned evenly across a cone of total
    // width `angle` (radians) centred on the firing direction. The base
    // position/rotation is the shooter's ship now, OR — when considerPlayerPing
    // is set — rewound to where the shooter's own ship was when they fired
    // (one-way latency, ping/2; the shooter sees themselves via prediction at
    // present time, so no interp delay). The same base is reused for every
    // pellet so the whole spray originates from one point.
    //
    // For count N and angle A, pellet i (0..N-1) is offset by
    // -A/2 + i * (A / (N - 1)); N === 1 always fires straight (offset 0).
    spawnSpread(
        player: PipPlayer,
        count: number,
        angle: number,
        speed: number,
        radius: number,
        damage: number,
        type: BulletType,
        explosionRadius = 0,
    ){
        const pellets = Math.max(1, Math.floor(count))

        let positionX = player.ship.physics.position.x
        let positionY = player.ship.physics.position.y
        let baseRotation = player.ship.rotation

        if(this.options.considerPlayerPing){
            const lookbackRaw = (player.ping / 2) / this.deltaMs
            const prev = player.getLastTickState(lookbackRaw)
            positionX = prev.positionX
            positionY = prev.positionY
            baseRotation = prev.rotation
        }

        for(let i = 0; i < pellets; i++){
            const offset = pellets === 1 ? 0 : -angle / 2 + i * (angle / (pellets - 1))
            this.bullets.new({
                position: new Vector2(positionX, positionY),
                owner: player,
                speed,
                radius,
                rotation: baseRotation + offset,
                damage,
                type,
                explosionRadius,
            })
        }
    }

    // Movement acceleration for a single input. Single source of truth shared
    // by the authoritative server tick (updateSystems) and the client-side
    // replay step (stepLocalPlayer) so the two cannot drift apart.
    computeMovementAcceleration(player: PipPlayer, inputs: PlayerInputs): { x: number, y: number }{
        const phys = player.ship.physics
        const vel = Math.sqrt(phys.velocity.x * phys.velocity.x + phys.velocity.y * phys.velocity.y)
        const movementInput = Math.max(0, Math.min(1, inputs.movementAmount))
        // HASTE buff: scale both acceleration and the speed cap by the same
        // factor so a hasted ship both accelerates harder AND tops out faster.
        // This lives in the shared movement step, so the local player's
        // prediction uses it too (the timing is networked, see playerShipTimings).
        const hasteFactor = player.ship.timings.haste > 0 ? HASTE_MULTIPLIER : 1
        const accelerationInput = player.ship.stats.movement.acceleration.normal * movementInput * hasteFactor
        const speedCap = (player.ship.stats.movement.speed.normal * hasteFactor) / (1 - phys.airResistance)
        const speedLimitTip = Math.max(0, (vel + accelerationInput) - speedCap)
        const cappedAccelerationInput = accelerationInput - speedLimitTip

        if(cappedAccelerationInput <= 0) return { x: 0, y: 0 }

        const agility = player.ship.stats.movement.agility
        const angleDiff = radianDifference(inputs.movementAngle, inputs.aimRotation)
        const angleEffect = (angleDiff / Math.PI) * (Math.PI / 6) * (1 - agility)
        const agilityModifier = Math.pow(agility + (1 - Math.abs(angleDiff) / Math.PI) * (1 - agility), 2)
        const agilityAcceleration = cappedAccelerationInput * agilityModifier
        return {
            x: Math.cos(inputs.movementAngle + angleEffect) * agilityAcceleration,
            y: Math.sin(inputs.movementAngle + angleEffect) * agilityAcceleration,
        }
    }

    // Advance ONLY the local player's kinematics by one tick for the given
    // input, reproducing the server's per-tick order exactly: accelerate →
    // damp (air resistance) → clamp speed → integrate → resolve walls →
    // world-bounds bounce. It shares the air-resistance, speed-clamp and wall
    // resolver (and its iteration count) with the authoritative world step so
    // the two cannot drift. dt is fixed at 1 (never the Date.now() ticker delta).
    stepLocalPlayer(player: PipPlayer, inputs: PlayerInputs, dt = 1){
        const phys = player.ship.physics

        const accel = this.computeMovementAcceleration(player, inputs)
        phys.velocity.x += accel.x
        phys.velocity.y += accel.y

        const airResistance = airResistanceMultiplier(phys.airResistance, dt)
        phys.velocity.x *= airResistance
        phys.velocity.y *= airResistance

        const limited = limitSpeed(phys.velocity.x, phys.velocity.y, this.physics.options.maxVelocity)
        phys.velocity.x = limited.x
        phys.velocity.y = limited.y

        phys.position.x += phys.velocity.x * dt
        phys.position.y += phys.velocity.y * dt

        // Resolve walls with the SAME resolver and iteration count as the
        // authoritative world step, so the replay stops at walls exactly as the
        // server does (this is what fully removes the wall rubber-band).
        for(let iteration = 0; iteration < WALL_RESOLVE_ITERATIONS; iteration++){
            this.physics.resolveWallCollisions(phys)
        }
        this.applyMapBounds(player)
    }

    applyMapBounds(player: PipPlayer){
        const R = -0.5
        const phys = player.ship.physics
        if(phys.position.x < this.map.bounds.min.x){
            phys.position.x = this.map.bounds.min.x
            phys.velocity.x *= R
        }
        if(phys.position.y < this.map.bounds.min.y){
            phys.position.y = this.map.bounds.min.y
            phys.velocity.y *= R
        }
        if(phys.position.x > this.map.bounds.max.x){
            phys.position.x = this.map.bounds.max.x
            phys.velocity.x *= R
        }
        if(phys.position.y > this.map.bounds.max.y){
            phys.position.y = this.map.bounds.max.y
            phys.velocity.y *= R
        }
    }

    dealDamage(dealer: PipPlayer, target: PipPlayer, weaponDamage = dealer.ship.stats.bullet.damage.normal){
        if(this.options.triggerDamage === false) return

        // Anti-farm: award NO damage/kill/score credit for hits against an idle
        // (disconnected) real player. Idle players are already despawned during
        // MATCH, but this is the authoritative backstop so a reload-the-tab
        // exploit can never farm a disconnected enemy for free score. Bots stay
        // farmable (never idle) so training still works. Same triggerDamage gate
        // as above, so only the server enforces it.
        if(target.idle === true && target.isBot === false) return

        // FRIENDLY FIRE OFF (team modes): a teammate cannot hurt another
        // teammate. Gated on useTeams so free-for-all modes are unaffected. The
        // dealer.id !== target.id guard is crucial - it leaves SELF-damage
        // (suicide / standing on your own grenade) untouched, since a player is
        // trivially on their own team. Enemies (different team) take damage
        // normally. Unassigned players (team -1) only block against another
        // unassigned player, which never happens in a live TDM match.
        if(
            this.settings.useTeams === true &&
            dealer.team === target.team &&
            dealer.id !== target.id
        ) return

        // SHIELD buff (or legacy invincibility): the target takes ZERO health
        // loss. It still exists and collides — only the health hit is blocked.
        // Covers grenades too, since detonateGrenade routes through dealDamage.
        if(target.ship.isShielded) return

        // decrease health
        const dealerDamage = weaponDamage
        const defenseRatio = 2 - target.ship.defense
        const rawDamage = Math.max(1, Math.round(defenseRatio * dealerDamage))
        const damage = Math.min(rawDamage, target.ship.capacities.health)
        target.ship.capacities.health = tickDown(target.ship.capacities.health, damage)

        // increase damage dealt - but NOT for self-damage: a suicide / standing
        // on your own grenade must not pad your damage-dealt stat (it only counts
        // as a death, see the kill block below). The health loss + the hit visual
        // still happen.
        if(dealer.id !== target.id){
            dealer.score.damage += damage
        }

        // log damage (drives the hit visuals; fires for self-damage too)
        this.events.emit("dealDamage", {
            dealer,
            target,
            damage,
        })

        // trigger kill / death
        if(target.ship.capacities.health === 0){
            // The death always counts. A SUICIDE (dying to your OWN weapon, e.g.
            // standing on your own grenade blast) is a death ONLY - it must not
            // pad the killer's kill count, the kill feed, or a multi-kill streak.
            // So the kill credit + the playerKill event fire only when someone
            // ELSE landed the killing blow.
            target.score.deaths += 1
            target.setSpawned(false)
            target.timings.spawnTimeout = 20 * 3 // 3 seconds
            // Only a kill by SOMEONE ELSE credits a kill. A suicide gives no kill
            // (and no damage-dealt credit, gated above).
            if(dealer.id !== target.id){
                dealer.score.kills += 1
            }
            // Always announce the death so it shows in the kill feed - including a
            // suicide, where killer === killed and the client renders it as
            // "killed themselves". The multi-kill streak ignores self-kills.
            this.events.emit("playerKill", {
                killer: dealer,
                killed: target,
            })
        }
    }

    // Detonate a grenade at its current position, dealing area-of-effect damage
    // to EVERY spawned player within the grenade's explosionRadius — including
    // the grenade's own owner (self-damage is intended: standing on your own
    // blast hurts, exactly like a real grenade). Damage falls off linearly with
    // distance: full base damage at the centre, scaling to ~0 at the radius
    // edge, with a floor of 1 for any player that overlaps the blast at all so a
    // graze always registers. Server-authoritative: gated on triggerDamage, and
    // computed at detonation time against players' CURRENT positions (the AoE is
    // a plain radius check, not ping-rewound — only direct-hit detection is
    // lag-compensated; see updateBulletPhysics). dealDamage emits the normal
    // dealDamage events so damage numbers and sounds already work. Call this
    // immediately before unsetting the grenade, so the blast originates from the
    // bullet's position before it is reset.
    detonateGrenade(bullet: Bullet){
        if(this.options.triggerDamage === false) return
        if(bullet.type !== "grenade") return
        if(!(bullet.owner instanceof PipPlayer)) return
        const radius = bullet.explosionRadius
        if(radius <= 0) return

        const blastX = bullet.physics.position.x
        const blastY = bullet.physics.position.y

        for(const player of Object.values(this.players)){
            if(player.spawned === false) continue
            const dx = player.ship.physics.position.x - blastX
            const dy = player.ship.physics.position.y - blastY
            const dist = Math.sqrt(dx * dx + dy * dy)
            // A player counts as caught in the blast when its hitbox overlaps the
            // explosion circle (centre distance within radius + ship radius).
            const reach = radius + player.ship.physics.radius
            if(dist > reach) continue

            // Linear falloff from full damage at the centre to 0 at the edge,
            // clamped to a minimum of 1 so any overlap deals at least 1.
            const falloff = Math.max(0, 1 - dist / reach)
            const scaled = Math.max(1, bullet.damage * falloff)
            this.dealDamage(bullet.owner, player, scaled)
        }
    }

    updateBulletPhysics(){
        // check wall collisions: swept circle (the bullet's motion segment,
        // inflated by both radii) vs each wall segment. The previous test used
        // a zero-width line intersection that missed corner grazes and skims
        // for fast bullets (velocity is 100/tick, larger than the bullet).
        const segWalls = Object.values(this.physics.segWalls)
        for(const bullet of this.bullets.getActive()){
            const hitRadius = bullet.physics.radius
            for(const segWall of segWalls){
                const dist = distanceBetweenSegments(
                    bullet.physics.position.x,
                    bullet.physics.position.y,
                    bullet.physics.position.x + bullet.physics.velocity.x,
                    bullet.physics.position.y + bullet.physics.velocity.y,
                    segWall.start.x,
                    segWall.start.y,
                    segWall.end.x,
                    segWall.end.y,
                )

                if(dist <= hitRadius + segWall.radius){
                    // Ricochet: while the bullet's SHOOTER has the buff, a
                    // non-grenade bullet bounces off the wall instead of dying,
                    // up to MAX_BULLET_BOUNCES. Reflect the velocity across the
                    // wall normal (v' = v - 2(v.n)n) and nudge the bullet back
                    // outside the surface so it does not immediately re-collide.
                    // Only one bounce per tick (break after) keeps it simple and
                    // avoids re-resolving the same contact. Grenades never
                    // ricochet - they detonate on any wall contact. Gated on the
                    // owner being a player with an active ricochet timer; this is
                    // server-authoritative because the bounced bullet's new
                    // velocity/position is broadcast like any other bullet state.
                    const owner = bullet.owner
                    const canRicochet = bullet.type !== "grenade" &&
                        owner instanceof PipPlayer &&
                        owner.ship.hasRicochet === true &&
                        bullet.bounces < MAX_BULLET_BOUNCES

                    if(canRicochet){
                        const near = nearestPointFromSegment(
                            segWall.start.x, segWall.start.y,
                            segWall.end.x, segWall.end.y,
                            bullet.physics.position.x, bullet.physics.position.y,
                        )
                        let nx = bullet.physics.position.x - near.x
                        let ny = bullet.physics.position.y - near.y
                        let nLen = Math.sqrt(nx * nx + ny * ny)
                        if(nLen < 0.0001){
                            // Bullet centre sits on the wall: fall back to the
                            // segment's perpendicular so the normal is defined.
                            const sx = segWall.end.x - segWall.start.x
                            const sy = segWall.end.y - segWall.start.y
                            const sLen = Math.max(0.0001, Math.sqrt(sx * sx + sy * sy))
                            nx = -sy / sLen
                            ny = sx / sLen
                            nLen = 1
                        } else{
                            nx /= nLen
                            ny /= nLen
                        }

                        const vDotN = bullet.physics.velocity.x * nx + bullet.physics.velocity.y * ny
                        bullet.physics.velocity.x -= 2 * vDotN * nx
                        bullet.physics.velocity.y -= 2 * vDotN * ny

                        // Push the bullet just clear of the surface along the
                        // normal so the next tick starts outside the wall.
                        const clearDist = hitRadius + segWall.radius + 0.5
                        bullet.physics.position.x = near.x + nx * clearDist
                        bullet.physics.position.y = near.y + ny * clearDist

                        bullet.bounces += 1
                        break
                    }

                    // A grenade that hits a wall detonates on contact (AoE).
                    this.detonateGrenade(bullet)
                    this.bullets.unset(bullet)
                    break
                }
            }
        }

        // collide with players
        const players = Object.values(this.players)
        for(const player of players){
            if(player.spawned === false) continue

            for(const bullet of this.bullets.getActive()){
                if(bullet.owner === player) continue
                // 1 is player
                // 2 is bullet

                let playerPositionX = player.ship.physics.position.x
                let playerPositionY = player.ship.physics.position.y
                let playerVelocityX = player.ship.physics.velocity.x
                let playerVelocityY = player.ship.physics.velocity.y

                if(this.options.considerPlayerPing === true && bullet.owner instanceof PipPlayer){
                    // Rewind the TARGET to where the SHOOTER saw it WHEN FIRING:
                    // the shooter's one-way latency (ping/2) plus the render
                    // interpolation delay the shooter views remote ships behind.
                    // The rewind is anchored to the bullet's spawn tick (via its
                    // age) so the target's hitbox stays frozen at the fired-at
                    // moment for the bullet's whole flight. Without the age term
                    // the lookback would track an ever-advancing "now", sliding
                    // the hitbox forward each tick so a bullet aimed where the
                    // shooter saw a moving target could never catch it.
                    const age = bullet.spawnTick >= 0 ? this.tickNumber - bullet.spawnTick : 0
                    const lookbackRaw = (bullet.owner.ping / 2) / this.deltaMs + INTERP_DELAY_TICKS + age
                    const prev = player.getLastTickState(lookbackRaw)
                    playerPositionX = prev.positionX
                    playerPositionY = prev.positionY
                    playerVelocityX = prev.velocityX
                    playerVelocityY = prev.velocityY
                }

                const Px = bullet.physics.position.x - playerPositionX
                const Py = bullet.physics.position.y - playerPositionY
                const r = player.ship.physics.radius + bullet.physics.radius

                // Swept-circle test over this tick's relative motion. Treat the
                // bullet as a point moving by the relative velocity V against a
                // circle of combined radius r centred on the (possibly rewound)
                // target. A hit is the FIRST contact: an overlap already present
                // at the start of the tick (t <= 0) or an entry root within the
                // tick (0 <= t_entry <= 1). The previous version solved for the
                // EXIT root and rejected anything already overlapping, so a bullet
                // sitting on a target — including the degenerate case where the
                // bullet and target share a velocity (relative speed 0) — dealt no
                // damage at all.
                const Vx = bullet.physics.velocity.x - playerVelocityX
                const Vy = bullet.physics.velocity.y - playerVelocityY
                const tDenominator = Vx * Vx + Vy * Vy

                let hit: boolean
                if(Px * Px + Py * Py <= r * r){
                    // Already overlapping at the start of the tick.
                    hit = true
                } else if(tDenominator === 0){
                    // No relative motion and not overlapping: cannot connect.
                    hit = false
                } else{
                    // Quadratic |P + tV|^2 = r^2. Real roots require a
                    // non-negative discriminant; the entry (smaller) root is the
                    // first contact. A hit lands this tick when it falls in [0, 1].
                    const b = 2 * (Px * Vx + Py * Vy)
                    const c = Px * Px + Py * Py - r * r
                    const discriminant = b * b - 4 * tDenominator * c
                    if(discriminant < 0){
                        hit = false
                    } else{
                        const tEntry = (-b - Math.sqrt(discriminant)) / (2 * tDenominator)
                        hit = tEntry >= 0 && tEntry <= 1
                    }
                }

                if(hit === false) continue
                if(bullet.type === "grenade"){
                    // A grenade that touches a player detonates with AoE rather
                    // than dealing single-target damage — the radius check inside
                    // detonateGrenade covers this player and anyone nearby.
                    this.detonateGrenade(bullet)
                } else if(bullet.owner instanceof PipPlayer){
                    this.dealDamage(bullet.owner, player, bullet.damage)
                }
                this.bullets.unset(bullet)
            }
        }
    }

    updatePhysics(){
        // Run physics
        this.updateBulletPhysics()
        this.physics.update(this.deltaMs)

        // Enforce map bounds
        for(const player of Object.values(this.players)){
            this.applyMapBounds(player)
        }

        // Resolve powerup pickups against final ship positions this tick.
        this.updatePowerupPickups()

        for(const player of Object.values(this.players)){
            player.trackPositionState()
        }
    }
}