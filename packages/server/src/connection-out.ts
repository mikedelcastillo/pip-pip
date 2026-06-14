import { PipPipGame, PipPipGameMode, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PING_REFRESH } from "@pip-pip/game/src/logic/constants"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import { encode } from "@pip-pip/game/src/networking/packets"
import { CUSTOM_MAP_INDEX } from "@pip-pip/game/src/maps"
import type { ConnectionContext } from "."
import { getApprovedChatEntries } from "./connection-in"

// Per-player bytes that are byte-IDENTICAL for every recipient this tick, so we
// encode them ONCE per tick (in buildSharedTickCache below) and reuse the same
// arrays for every connection instead of re-encoding the same player once per
// recipient. playerPosition/playerInputs depend only on the player's physics +
// input state, which are FIXED for the whole tick (physics already ran before
// the send loop), and playerPing is a plain per-player field; none of them vary
// by recipient. The self-exclusion (connection.id !== player.id) still happens
// at the composition site by simply skipping that player's cached entry, so a
// connection never receives its own playerPosition/playerInputs in the shared
// loop. The cached arrays are READ-ONLY: each connection still flattens its own
// final message array into its own buffer and never mutates these.
export type SharedPlayerPackets = {
    position: number[],
    inputs: number[],
    ping: number[],
}

export type SharedTickCache = {
    players: Map<string, SharedPlayerPackets>,
    // The one global tick header prepended to every recipient's message this
    // tick. Same tick number for all connections, so encode it once and reuse.
    serverTickHeader: number[],
}

// Encode the shared per-player broadcast packets ONCE for this tick. Built once
// per lobby (in the tick loop) before the per-connection send loop and passed
// into getPartialGameState for every recipient. Keyed by player id so the
// composition site can look up a player's cached bytes (and skip the recipient's
// own id for the self-excluded loops). Byte-for-byte equal to encoding the same
// packets per connection, just done M times instead of N*M times.
export function buildSharedTickCache(game: PipPipGame): SharedTickCache{
    const players = new Map<string, SharedPlayerPackets>()
    for(const player of Object.values(game.players)){
        players.set(player.id, {
            position: encode.playerPosition(player),
            inputs: encode.playerInputs(player),
            ping: encode.playerPing(player),
        })
    }
    return { players, serverTickHeader: encode.serverTickHeader(game) }
}

// Encode the active map for a recipient. A CUSTOM map (mapIndex === -1 with
// customMapData set) must carry its FULL GridMapData so a client - including a
// late joiner - can render + simulate geometry that has no index in PIP_MAPS;
// every built-in map rides the index-only gameMap packet. Shared by the
// initial-sync site and the on-change broadcast so they can never diverge on how
// a custom map reaches the wire.
function encodeActiveMap(game: PipPipGame): number[]{
    if(game.mapIndex === CUSTOM_MAP_INDEX && typeof game.customMapData !== "undefined"){
        return encode.customMap(game.customMapData)
    }
    return encode.gameMap(game.mapIndex)
}

export function sendPacketToConnection(context: ConnectionContext, sharedCache?: SharedTickCache){
    const { connection, gameEvents, game } = context

    // check if the player is new or just reconnecting
    let sendFullGameState = false

    for(const event of gameEvents.filter("addPlayer")){
        const { player } = event.addPlayer
        if(connection.id === player.id){
            // player just connected
            sendFullGameState = true
        }
    }

    for(const event of gameEvents.filter("playerIdleChange")){
        const { player } = event.playerIdleChange
        if(connection.id === player.id && player.idle === false){
            // player just reconnected
            sendFullGameState = true
        }
    }

    const messages = sendFullGameState ? getFullGameState(context) : getPartialGameState(context, sharedCache)

    if(messages.length){
        // One global tick header per message (decode is ID-keyed, so its
        // position in the batch is irrelevant). Lets the client run a shared
        // server clock instead of guessing time from round-trip ping. Same tick
        // number for every recipient, so reuse the per-tick shared cache when
        // present (unshift only mutates this connection's own messages array;
        // the cached header array itself is never mutated and is copied out by
        // the messages.flat() below).
        if(game.phase !== PipPipGamePhase.SETUP){
            messages.unshift(sharedCache ? sharedCache.serverTickHeader : encode.serverTickHeader(game))
        }
        const buffer = new Uint8Array(messages.flat()).buffer
        connection.send(buffer)
    }
}

export function getFullGameState(context: ConnectionContext): number[][] {
    const { game } = context

    const messages = []

    for(const player of Object.values(game.players)){
        messages.push(encode.addPlayer(player))
        messages.push(encode.playerName(player))
        messages.push(encode.playerIdle(player))
        messages.push(encode.playerSpectate(player))
        messages.push(encode.playerSetShip(player))
        messages.push(encode.playerTeam(player))
        messages.push(encode.playerReady(player))
        messages.push(encode.playerPositionSync(player))
        messages.push(encode.playerPosition(player))
        messages.push(encode.playerPing(player))
        messages.push(encode.playerShipTimings(player))
        messages.push(encode.playerShipCapacities(player))
        messages.push(encode.playerTimings(player))
        messages.push(encode.playerScores(player))

        if(player.spawned){
            messages.push(encode.spawnPlayer(player))
        } else{
            messages.push(encode.despawnPlayer(player))
        }
    }

    // send all bulelts
    for(const bullet of game.bullets.getActive()){
        if(bullet.owner instanceof PipPlayer){
            messages.push(encode.playerShootBullet(bullet.owner, bullet))
        }
    }

    // send all active powerups (full field state on join)
    for(const powerup of game.powerups.getActive()){
        messages.push(encode.powerupSpawn(powerup))
    }

    if(typeof game.host !== "undefined"){
        messages.push(encode.setHost(game.host))
    }

    messages.push(encode.gamePhase(game))
    messages.push(encode.gameCountdown(game))
    messages.push(encode.gameState(game))
    // A late joiner gets the FULL custom geometry here (encodeActiveMap branches
    // on a custom map), so it can render + simulate a map with no PIP_MAPS index.
    messages.push(encodeActiveMap(game))

    // KILL_FRENZY: seed the joining client's match clock so its HUD is correct
    // immediately, not only after the next per-tick matchTimer broadcast.
    if(game.settings.mode === PipPipGameMode.KILL_FRENZY && game.phase === PipPipGamePhase.MATCH){
        messages.push(encode.matchTimer(game))
    }

    // RESULTS: a client joining mid-results gets the winner straight away so it
    // can draw the podium instead of a blank end screen.
    if(game.phase === PipPipGamePhase.RESULTS){
        messages.push(encode.gameResults(game))
    }

    return messages
}

type PlayerUpdateObject = {
    shipTimings: boolean,
    shipCapacities: boolean,
    playerTimings: boolean,
    playerScores: boolean,
}
type PlayerUpdateType = Record<string, PlayerUpdateObject>

class PlayerUpdateTracker{
    states: PlayerUpdateType = {}
    
    track<K extends keyof PlayerUpdateObject>(id: string, key: K, value: PlayerUpdateObject[K] = true){
        if(!(id in this.states)){
            this.states[id] = {
                shipTimings: false,
                shipCapacities: false,
                playerTimings: false,
                playerScores: false,
            }
        }
        this.states[id][key] = value
    }
}

export function getPartialGameState(context: ConnectionContext, sharedCache?: SharedTickCache): number[][] {
    const { game, gameEvents, connection } = context

    const playerUpdates = new PlayerUpdateTracker()

    const messages = []
    
    // Send new players
    for(const event of gameEvents.filter("addPlayer")){
        const { player } = event.addPlayer
        messages.push(encode.addPlayer(player))
        messages.push(encode.playerName(player))
        messages.push(encode.playerIdle(player))
        messages.push(encode.playerSpectate(player))
        playerUpdates.track(player.id, "playerScores")
        playerUpdates.track(player.id, "playerTimings")
        playerUpdates.track(player.id, "shipCapacities")
        playerUpdates.track(player.id, "shipTimings")
    }

    // Send player idle
    for(const event of gameEvents.filter("playerIdleChange")){
        const { player } = event.playerIdleChange
        messages.push(encode.playerIdle(player))
    }

    // Send player spectator changes to everyone (player lists reflect it). The
    // setSpectator that fired this already despawned the player if needed, and
    // that despawn separately queued a despawnPlayer packet via playerSpawned.
    for(const event of gameEvents.filter("playerSpectateChange")){
        const { player } = event.playerSpectateChange
        messages.push(encode.playerSpectate(player))
    }

    // Send player details to other players
    for(const event of gameEvents.filter("playerDetailsChange")){
        const { player } = event.playerDetailsChange
        if(connection.id === player.id) continue // prevent update loop
        messages.push(encode.playerName(player))
    }

    // Send removed players
    for(const event of gameEvents.filter("removePlayer")){
        const { player } = event.removePlayer
        messages.push(encode.removePlayer(player))
    }

    // Send remove set ship
    for(const event of gameEvents.filter("playerSetShip")){
        const { player } = event.playerSetShip
        messages.push(encode.playerSetShip(player))
    }

    // Send team assignments (TEAM_DEATHMATCH). Fires on the balanced split at
    // match start, on a mid-match join filling the smaller team, and whenever a
    // player's team otherwise changes, so every client agrees on team colors +
    // team scores. A fresh joiner's team also rides the full game state they get
    // on connect (getFullGameState pushes playerTeam per player).
    for(const event of gameEvents.filter("playerTeamChange")){
        const { player } = event.playerTeamChange
        messages.push(encode.playerTeam(player))
    }

    // Send lobby "ready up" changes. Fires whenever a player toggles ready and
    // when startMatch clears everyone's ready for the next round, so every
    // client's lobby footer + player list agree on the ready tally. A fresh
    // joiner's ready also rides the full game state they get on connect
    // (getFullGameState pushes playerReady per player).
    for(const event of gameEvents.filter("playerReadyChange")){
        const { player } = event.playerReadyChange
        messages.push(encode.playerReady(player))
    }

    // player spawned
    for(const event of gameEvents.filter("playerSpawned")){
        const { player } = event.playerSpawned
        if(player.spawned === true){
            // player spawned
            messages.push(encode.spawnPlayer(player))
        } else{
            // player despawned
            messages.push(encode.despawnPlayer(player))
        }
        playerUpdates.track(player.id, "playerScores")
        playerUpdates.track(player.id, "playerTimings")
        playerUpdates.track(player.id, "shipCapacities")
        playerUpdates.track(player.id, "shipTimings")
    }

    // Send host
    if(gameEvents.filter("setHost").length > 0 && typeof game.host !== "undefined"){
        messages.push(encode.setHost(game.host))
    }

    // Send phase change
    if(gameEvents.filter("phaseChange").length > 0){
        messages.push(encode.gamePhase(game))
        // Entering RESULTS: ship the winner(s) alongside the phase so the client
        // can draw the podium the same tick the end screen appears.
        if(game.phase === PipPipGamePhase.RESULTS){
            messages.push(encode.gameResults(game))
        }
    }
    
    // Send game settings
    if(gameEvents.filter("settingsChange").length > 0){
        messages.push(encode.gameState(game))
    }

    // Send game map. On a custom map the full GridMapData rides instead of the
    // index, so every client (not just late joiners) applies the new geometry.
    if(gameEvents.filter("setMap").length > 0){
        messages.push(encodeActiveMap(game))
    }

    // Shoot bullet
    for(const event of gameEvents.filter("addBullet")){
        const { bullet } = event.addBullet
        if(bullet.owner instanceof PipPlayer){
            if(bullet.owner.id === connection.id) continue
            messages.push(encode.playerShootBullet(bullet.owner, bullet))
        }
    }

    // Powerup spawned: tell every client to create it.
    for(const event of gameEvents.filter("powerupSpawn")){
        messages.push(encode.powerupSpawn(event.powerupSpawn.powerup))
    }

    // Powerup picked up: tell every client to remove it. The effect on the
    // picker's ship is networked separately via that player's capacity update.
    for(const event of gameEvents.filter("powerupPickup")){
        const { powerup, player } = event.powerupPickup
        messages.push(encode.powerupPickup(powerup, player))
        // The pickup mutated the picker's ship capacities (health/ammo); push
        // the authoritative values so the client reflects the heal/refill.
        playerUpdates.track(player.id, "shipCapacities")
    }

    // Reload
    for(const event of gameEvents.filter("playerReloadStart")){
        const { player } = event.playerReloadStart
        if(connection.id === player.id){
            playerUpdates.track(player.id, "playerTimings")
            playerUpdates.track(player.id, "shipCapacities")
            playerUpdates.track(player.id, "shipTimings")
        }
    }
    for(const event of gameEvents.filter("playerReloadEnd")){
        const { player } = event.playerReloadEnd
        if(connection.id === player.id){
            playerUpdates.track(player.id, "playerTimings")
            playerUpdates.track(player.id, "shipCapacities")
            playerUpdates.track(player.id, "shipTimings")
        }
    }

    // Deal damage
    for(const event of gameEvents.filter("dealDamage")){
        const { dealer, target, damage } = event.dealDamage
        if(connection.id === dealer.id){
            messages.push(encode.playerDamage(dealer, target, damage))
        }
        playerUpdates.track(dealer.id, "playerScores")
        playerUpdates.track(dealer.id, "shipCapacities")
        playerUpdates.track(target.id, "shipCapacities")
    }

    // Track kill
    for(const event of gameEvents.filter("playerKill")){
        const { killer, killed } = event.playerKill
        messages.push(encode.playerKill(killer, killed))
        playerUpdates.track(killer.id, "playerScores")
        playerUpdates.track(killed.id, "playerScores")
        playerUpdates.track(killer.id, "playerTimings")
        playerUpdates.track(killed.id, "playerTimings")
    }

    // Any score change broadcasts that player's scores the SAME tick. This is
    // what reliably syncs a bystander ASSIST: the assister is not the killer, the
    // victim, or a player who dealt damage / spawned this tick, so none of the
    // loops above would queue their scores - without this their +1 assist would
    // only reach clients opportunistically (next time they damage/die/respawn).
    for(const event of gameEvents.filter("playerScoreChanged")){
        playerUpdates.track(event.playerScoreChanged.player.id, "playerScores")
    }

    // Broadcast chat. connection-in already validated, rate-limited and
    // de-commanded every sender's messages ONCE this tick; here we just re-emit
    // the approved text to this recipient. Iterating the approved entries (one
    // per sender) rather than raw packets means the length cap / rate limit are
    // enforced server-side and counted once, not once per recipient.
    for(const [senderId, chatMessages] of getApprovedChatEntries()){
        const player = game.players[senderId]
        if(typeof player === "undefined") continue
        for(const message of chatMessages){
            messages.push(encode.receiveChat(player, message))
        }
    }

    for(const playerId in playerUpdates.states){
        const player = game.players[playerId]
        if(typeof player === "undefined") continue
        const update = playerUpdates.states[playerId]

        if(update.playerScores === true){
            messages.push(encode.playerScores(player))
        }
        if(update.playerTimings === true){
            messages.push(encode.playerTimings(player))
        }
        if(update.shipCapacities === true){
            messages.push(encode.playerShipCapacities(player))
        }
        if(update.shipTimings === true){
            messages.push(encode.playerShipTimings(player))
        }
    }
    
    if(game.phase !== PipPipGamePhase.SETUP){
        const connectionPlayer = game.players[connection.id]
        if(game.phase === PipPipGamePhase.COUNTDOWN){
            // Send game countdown 4 times a second
            if(game.tickNumber % 4 === 0){
                messages.push(encode.gameCountdown(game))
            }
            // Force place player position
            if(typeof connectionPlayer !== "undefined"){
                messages.push(encode.playerPositionSync(connectionPlayer))
            }
        }

        // KILL_FRENZY: broadcast the remaining match clock 4 times a second
        // during MATCH (same cadence as the countdown). The wire value is whole
        // seconds, so a higher rate would add nothing.
        if(
            game.phase === PipPipGamePhase.MATCH &&
            game.settings.mode === PipPipGameMode.KILL_FRENZY &&
            game.tickNumber % 4 === 0
        ){
            messages.push(encode.matchTimer(game))
        }
        
        // Send OTHER players' locations + inputs. The owner's own position is
        // deliberately NOT echoed here (it used to be, which is what the
        // brittle client snap reacted to); the owner gets the precise
        // owner-only ownPlayerState below instead. These two packets are
        // byte-identical across recipients this tick, so reuse the per-tick
        // shared cache when present (encoded once per player up front) and only
        // fall back to encoding here when no cache was supplied; the
        // self-exclusion (connection.id !== player.id) is unchanged.
        for(const player of Object.values(game.players)){
            if(connection.id !== player.id){
                const shared = sharedCache?.players.get(player.id)
                messages.push(shared ? shared.position : encode.playerPosition(player))
                messages.push(shared ? shared.inputs : encode.playerInputs(player))
            }
        }

        // Owner-only authoritative state for client prediction reconciliation.
        if(game.phase === PipPipGamePhase.MATCH && typeof connectionPlayer !== "undefined"){
            messages.push(encode.ownPlayerState(connectionPlayer))
        }
    }

    // send player ping. playerPing is a plain per-player field that does not
    // vary by recipient, so it too rides the per-tick shared cache when present
    // (no self-exclusion here: ping IS broadcast for every player, including the
    // recipient, exactly as before).
    if(game.tickNumber % (game.tps - PING_REFRESH) === 0){
        for(const player of Object.values(game.players)){
            const shared = sharedCache?.players.get(player.id)
            messages.push(shared ? shared.ping : encode.playerPing(player))
        }
    }

    return messages
}