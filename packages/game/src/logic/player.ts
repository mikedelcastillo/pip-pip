import { radianDifference } from "@pip-pip/core/src/math"
import { PointPhysicsObject, Vector2 } from "@pip-pip/core/src/physics"
import { PipPipGame } from "."
import { PIP_SHIPS, ShipType } from "../ships"

import { PipShip } from "./ship"
import { tickDown } from "./utils"
import { SERVER_INPUT_QUEUE_MAX } from "./constants"
import { BotDifficulty, BotSkill } from "./ai"

export type PlayerInputs = {
    movementAngle: number,
    movementAmount: number,

    aimRotation: number,

    useWeapon: boolean,
    useTactical: boolean,
    doReload: boolean,

    spawn: boolean,
}

export function cloneInputs(inputs: PlayerInputs): PlayerInputs{
    return {
        movementAngle: inputs.movementAngle,
        movementAmount: inputs.movementAmount,
        aimRotation: inputs.aimRotation,
        useWeapon: inputs.useWeapon,
        useTactical: inputs.useTactical,
        doReload: inputs.doReload,
        spawn: inputs.spawn,
    }
}

// Server: one buffered input awaiting consumption (one consumed per tick).
export type PlayerInputFrame = {
    seq: number,
    inputs: PlayerInputs,
}

// Client (local player): an unacknowledged input plus the position it
// predicted, kept for reset-and-replay reconciliation.
export type PredictedInputState = {
    seq: number,
    inputs: PlayerInputs,
    positionX: number,
    positionY: number,
}

// Client (remote players): a timestamped server snapshot for render-behind
// interpolation, keyed by the authoritative server tick.
export type PlayerSnapshot = {
    tick: number,
    positionX: number,
    positionY: number,
    velocityX: number,
    velocityY: number,
}

export type PlayerTimings = {
    spawnTimeout: number,
}

export type PlayerTickState = {
    positionX: number,
    positionY: number,
    velocityX: number,
    velocityY: number,
    rotation: number,
}

export type PlayerScores = {
    kills: number,
    assists: number,
    deaths: number,
    damage: number,
}

export const MAX_PLAYER_POSITION_STATES = 8

// Client (local player): max unacknowledged predicted frames kept for
// reconciliation. ~6s at 20Hz — far beyond any sane RTT, but bounded so a
// stalled server can never grow this without limit.
export const MAX_PREDICTED_STATES = 128

// Wrap-safe "seq a is strictly after seq b" across the uint16 input-seq space.
// (a - b) mod 2^16 lands in (0, 0x8000) when a leads b, accounting for wrap.
export function isInputSeqAfter(a: number, b: number){
    const delta = (a - b) & 0xFFFF
    return delta !== 0 && delta < 0x8000
}

export class PipPlayer{
    id: string
    
    ship!: PipShip
    shipIndex!: number
    shipType!: ShipType

    game: PipPipGame
    spectating?: PipPlayer | PipShip | PointPhysicsObject | Vector2

    name = "Pilot" + Math.floor(Math.random() * 1000)
    idle = false
    ping = 0

    // True for server-simulated "training-grounds" bots (no connection). The AI
    // brain drives a bot's inputs each tick; connection-specific code uses this
    // to tell bots apart from real, connection-backed players.
    isBot = false

    // Bot-only: the difficulty this bot was created with and the per-bot varied
    // skill profile derived from it (see makeBotSkill). Both are undefined for a
    // real (connection-backed) player and for a plain bot constructed in a test;
    // the AI brain reads bot.skill with a fallback to the BOT_* constants, so an
    // undefined profile leaves the legacy behaviour untouched.
    difficulty?: BotDifficulty
    skill?: BotSkill

    // TEAM_DEATHMATCH team (0 or 1). -1 marks an unassigned player: the default
    // for every player outside a live TDM match (free-for-all modes never read
    // it, and a TDM player is assigned a real team at startMatch / on join).
    team = -1

    // Lobby "ready up" flag. Purely informational + social: it never blocks the
    // host (who can force-start at any time). Defaults to false and is cleared
    // for every player at startMatch so each fresh lobby round starts unready.
    ready = false

    score: PlayerScores = {
        kills: 0,
        assists: 0,
        deaths: 0,
        damage: 0,
    }

    inputs: PlayerInputs = {
        movementAngle: 0,
        movementAmount: 0,

        aimRotation: 0,

        useWeapon: false,
        useTactical: false,
        doReload: false,

        spawn: false,
    }

    timings: PlayerTimings = {
        spawnTimeout: 0,
    }

    spectator = false
    spawned = false

    positionStates: PlayerTickState[] = []

    // --- Networking: input sequencing & client-side prediction ---
    // Client: seq of the input produced this tick. Server: stays 0.
    inputSeq = 0
    // Server: seq of the most recent input actually consumed by the sim.
    lastProcessedInputSeq = 0
    // Server: inputs awaiting consumption (one per tick, in order).
    inputQueue: PlayerInputFrame[] = []
    // Client (local player only): unacknowledged inputs + predicted positions.
    predictedStates: PredictedInputState[] = []
    // Client (remote players only): server snapshots for render interpolation.
    snapshots: PlayerSnapshot[] = []
    // Client (local player only): smoothed visual offset so a correction eases
    // in instead of teleporting the rendered ship.
    renderError = { x: 0, y: 0 }

    constructor(game: PipPipGame, id: string){
        this.game = game
        this.id = id

        if(id in this.game.players) throw new Error("Player already in game.")
        this.game.players[id] = this
        this.game.events.emit("addPlayer", { player: this })
        this.game.setHostIfNeeded()
        this.setShip()
    }

    get canSpawn(){
        if(this.spectator === true) return false
        if(this.spawned === true) return false
        if(this.timings.spawnTimeout > 0) return false
        return true
    }

    setName(name: string){
        this.name = name
        this.game.events.emit("playerDetailsChange", { player: this })
    }

    remove(){
        if(!(this.id in this.game.players)) return
        this.setSpawned(false)
        delete this.game.players[this.id]
        this.game.events.emit("removePlayer", { player: this })
        this.game.setHostIfNeeded()
    }
    
    setKills(n: number){
        this.score.kills = n
        this.game.events.emit("playerScoreChanged", { player: this })
    }
    
    setAssists(n: number){
        this.score.assists = n
        this.game.events.emit("playerScoreChanged", { player: this })
    }
    
    setDeaths(n: number){
        this.score.deaths = n
        this.game.events.emit("playerScoreChanged", { player: this })
    }
    
    setDamage(n: number){
        this.score.damage = n
        this.game.events.emit("playerScoreChanged", { player: this })
    }

    resetScores(){
        this.setKills(0)
        this.setAssists(0)
        this.setDeaths(0)
        this.setDamage(0)
    }

    setIdle(idle: boolean){
        this.idle = idle
        this.game.events.emit("playerIdleChange", { player: this })
    }

    // Assign this player's TEAM_DEATHMATCH team (0 or 1; -1 unassigned). Emits
    // playerTeamChange so the per-player broadcast can put the team on the wire
    // and every client agrees on team colors + team scores. A no-op (no event)
    // when the team is unchanged, so re-assigning the same team never spams.
    setTeam(team: number){
        if(this.team === team) return
        this.team = team
        this.game.events.emit("playerTeamChange", { player: this })
    }

    // Toggle this player's lobby "ready up" flag. Emits playerReadyChange so the
    // per-player broadcast can put the ready state on the wire and every client
    // agrees on the ready tally. A no-op (no event) when unchanged, so re-setting
    // the same value never spams. Ready is purely social: it never gates the
    // host's force-start.
    setReady(ready: boolean){
        if(this.ready === ready) return
        this.ready = ready
        this.game.events.emit("playerReadyChange", { player: this })
    }

    // Toggle this player into/out of spectator mode. A spectator can never
    // spawn (canSpawn already returns false while spectator === true); if it is
    // currently spawned, becoming a spectator despawns it immediately so it
    // leaves play at once. Emits playerSpectateChange so the renderer/UI and the
    // per-player broadcast can react (mirrors setIdle).
    setSpectator(spectator: boolean){
        if(this.spectator === spectator) return
        this.spectator = spectator
        if(spectator === true && this.spawned === true){
            this.setSpawned(false)
        }
        this.game.events.emit("playerSpectateChange", { player: this })
    }

    setSpawned(state: boolean){
        if(typeof this.ship !== "undefined"){
            if(state === true){
                this.game.physics.addObject(this.ship.physics)
            } else{
                this.game.physics.removeObject(this.ship.physics)
            }
        }
        this.spawned = state
        this.game.events.emit("playerSpawned", { player: this })
    }

    setShip(index?: number){
        if(typeof index === "number"){
            index = Math.max(0, Math.min(index, PIP_SHIPS.length - 1))
        } else{
            index = Math.floor(Math.random() * PIP_SHIPS.length)
        }
        if(this.shipIndex === index) return
        
        const shipType = PIP_SHIPS[index]

        const ship = new shipType.Ship(this.game, this.id)
        ship.setPlayer(this)

        if(typeof this.ship !== "undefined"){
            ship.physics.position.x = this.ship.physics.position.x
            ship.physics.position.y = this.ship.physics.position.y
            ship.physics.velocity.x = this.ship.physics.velocity.x
            ship.physics.velocity.y = this.ship.physics.velocity.y
            this.game.physics.removeObject(this.ship.physics)
        }

        if(this.spawned === true){
            this.game.physics.addObject(ship.physics)
        }

        this.ship = ship
        this.shipIndex = index
        this.shipType = shipType

        this.game.events.emit("playerSetShip", {
            player: this,
            ship,
        })
    }

    getTickState(): PlayerTickState{
        return {
            positionX: this.ship.physics.position.x,
            positionY: this.ship.physics.position.y,
            velocityX: this.ship.physics.velocity.x,
            velocityY: this.ship.physics.velocity.y,
            rotation: this.ship.rotation,
        }
    }

    trackPositionState(){
        const state = this.getTickState()

        if(this.positionStates.length >= MAX_PLAYER_POSITION_STATES){
            this.positionStates.pop()
        }
        this.positionStates.unshift(state)
    }

    getLastTickState(index: number){
        if(this.positionStates.length === 0){
            return this.getTickState()
        }
        index = Math.max(0, Math.min(index, this.positionStates.length - 1))
        const fromIndex = Math.floor(index)
        const toIndex = Math.ceil(index)
        const from = this.positionStates[fromIndex]
        const to = this.positionStates[toIndex]
        if(fromIndex === toIndex) return this.positionStates[fromIndex]
        const dist = index - fromIndex
        return {
            positionX: from.positionX + (to.positionX - from.positionX) * dist,
            positionY: from.positionY + (to.positionY - from.positionY) * dist,
            velocityX: from.velocityX + (to.velocityX - from.velocityX) * dist,
            velocityY: from.velocityY + (to.velocityY - from.velocityY) * dist,
            rotation: from.rotation + radianDifference(from.rotation, to.rotation) * dist,
        }
    }

    // Server: enqueue an input received from this player's connection.
    // TCP keeps order, so stale/duplicate seqs are ignored defensively. The
    // comparison is wrap-safe across the uint16 seq boundary.
    pushInputFrame(seq: number, inputs: PlayerInputs){
        const last = this.inputQueue[this.inputQueue.length - 1]
        if(typeof last !== "undefined"){
            const ahead = (seq - last.seq) & 0xFFFF
            if(ahead === 0 || ahead >= 0x8000) return
        }
        this.inputQueue.push({ seq, inputs: cloneInputs(inputs) })
        // Bound the queue at INGEST, not only at consume time. A flood of input
        // frames in one message (or many messages between ticks) would otherwise
        // grow this without limit until the next consume; dropping the oldest
        // excess here caps memory and keeps consumed input recent. The consumer
        // still fast-forwards past any residual excess as a second line of
        // defence.
        while(this.inputQueue.length > SERVER_INPUT_QUEUE_MAX){
            this.inputQueue.shift()
        }
    }

    // Server: pull one input for this tick. Empty queue → keep last input
    // (starvation). A queue grown past the cap (post-stall burst) drops its
    // oldest excess so latency stays bounded.
    consumeQueuedInput(){
        if(this.inputQueue.length === 0) return
        while(this.inputQueue.length > SERVER_INPUT_QUEUE_MAX){
            this.inputQueue.shift()
        }
        const frame = this.inputQueue.shift()
        if(typeof frame === "undefined") return
        this.inputs.movementAngle = frame.inputs.movementAngle
        this.inputs.movementAmount = frame.inputs.movementAmount
        this.inputs.aimRotation = frame.inputs.aimRotation
        this.inputs.useWeapon = frame.inputs.useWeapon
        this.inputs.useTactical = frame.inputs.useTactical
        this.inputs.doReload = frame.inputs.doReload
        this.lastProcessedInputSeq = frame.seq
    }

    // Reset all client-side prediction/interpolation state. Called on
    // authoritative teleports (spawn, force-sync) so nothing replays or
    // interpolates across the discontinuity.
    resetNetworkState(){
        this.predictedStates = []
        this.snapshots = []
        this.renderError.x = 0
        this.renderError.y = 0
        this.inputQueue = []
    }

    // Client (local player): advance the input sequence for the frame produced
    // this tick. Each sent input carries a unique, monotonically increasing seq
    // so the server can acknowledge exactly how far it has consumed our stream
    // and we can reconcile the unacknowledged tail. uint16, wraps.
    advanceInputSeq(){
        this.inputSeq = (this.inputSeq + 1) & 0xFFFF
    }

    // Client (local player): snapshot this tick's input + predicted position,
    // keyed by the current inputSeq. Call AFTER the local sim has stepped so the
    // position is post-physics. reconcileTo compares the server's authoritative
    // position at a given seq against the prediction recorded here.
    recordPredictedState(){
        this.predictedStates.push({
            seq: this.inputSeq,
            inputs: cloneInputs(this.inputs),
            positionX: this.ship.physics.position.x,
            positionY: this.ship.physics.position.y,
        })
        while(this.predictedStates.length > MAX_PREDICTED_STATES){
            this.predictedStates.shift()
        }
    }

    // Client (local player): reconcile the locally-predicted ship against the
    // server's authoritative own-state (the ownPlayerState packet), which
    // reports the authoritative position/velocity AFTER the server consumed
    // input up to lastInputSeq.
    //
    // We measure the prediction error at the acknowledged seq (authoritative
    // minus what we predicted for that same seq) and shift the CURRENT predicted
    // position by that error. Because every later predicted frame was built on
    // the same erroneous base via the same inputs, one translation realigns the
    // whole unacknowledged tail — the cheap, collision-free form of
    // reset-and-replay. Without a matching prediction (cold start, just after a
    // spawn/teleport that cleared predictedStates, or a seq gap) we hard-resync
    // to the authoritative state instead.
    reconcileTo(positionX: number, positionY: number, velocityX: number, velocityY: number, lastInputSeq: number){
        const acked = this.predictedStates.find(state => state.seq === lastInputSeq)
        // Drop every acknowledged frame; keep only the unacknowledged tail.
        this.predictedStates = this.predictedStates.filter(state => isInputSeqAfter(state.seq, lastInputSeq))

        if(typeof this.ship === "undefined") return

        if(typeof acked === "undefined"){
            // No prediction to reconcile against (cold start / post-spawn gap) —
            // snap to authoritative state and drop the now-stale tail so the next
            // ack measures error against a fresh, correctly-based prediction.
            this.ship.physics.position.x = positionX
            this.ship.physics.position.y = positionY
            this.ship.physics.velocity.x = velocityX
            this.ship.physics.velocity.y = velocityY
            this.predictedStates = []
            return
        }

        const errorX = positionX - acked.positionX
        const errorY = positionY - acked.positionY
        this.ship.physics.position.x += errorX
        this.ship.physics.position.y += errorY
        // CRUCIAL: re-base the retained (unacknowledged) predictions onto the
        // corrected trajectory. Without this, a PERSISTENT error (the client
        // running on a constant offset from the server) is re-measured against
        // the stale-based predictions and re-applied EVERY tick — it compounds
        // and the ship flies off "corner to corner". Re-basing makes the next
        // ack's error ~0 in steady state, so corrections converge instead.
        for(const state of this.predictedStates){
            state.positionX += errorX
            state.positionY += errorY
        }
    }

    update(){
        this.timings.spawnTimeout = tickDown(this.timings.spawnTimeout, 1)

        if(typeof this.ship !== "undefined"){
            this.ship.update()
        }
    }
}