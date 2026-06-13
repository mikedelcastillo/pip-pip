import { Vector2 } from "@pip-pip/core/src/physics"
import { PipPipGamePhase } from "@pip-pip/game/src/logic"
import { CHAT_MAX_MESSAGE_LENGTH, MAX_INPUT_BUFFER } from "@pip-pip/game/src/logic/constants"
import { cloneInputs, PlayerSnapshot } from "@pip-pip/game/src/logic/player"
import { encode } from "@pip-pip/game/src/networking/packets"
import { GameContext, getClientPlayer } from "."

// How many remote snapshots to retain (~1.2s at 20Hz) for interpolation.
const MAX_SNAPSHOTS = 24
// Cap on the smoothed reconciliation offset, so a large batched correction
// after a TCP stall eases in over several frames instead of teleporting.
const MAX_RENDER_ERROR = 400

// Reconciliation deadzone: if the server's authoritative position is within
// this many units of what the client predicted for that input, the prediction
// is trusted and the local ship is NOT corrected at all. This is what keeps
// normal movement crisp — we only snap-and-replay on a genuine divergence.
const RECONCILE_TOLERANCE = 40

// Wrap-safe "a comes after b" comparison for uint16 input sequence numbers.
const seqGreater = (a: number, b: number) => ((a - b) & 0xFFFF) !== 0 && ((a - b) & 0xFFFF) < 0x8000

const clampError = (v: number) => Math.max(-MAX_RENDER_ERROR, Math.min(MAX_RENDER_ERROR, v))

/**
 * Interpolate a remote player's render position from its snapshot buffer at
 * the given (fractional) server tick. Returns undefined if there are no
 * snapshots; freezes on the nearest end rather than extrapolating past it.
 */
export function sampleSnapshot(snapshots: PlayerSnapshot[], tick: number){
    if(snapshots.length === 0) return undefined
    let older: PlayerSnapshot | undefined
    let newer: PlayerSnapshot | undefined
    for(const snapshot of snapshots){
        if(snapshot.tick <= tick) older = snapshot
        if(snapshot.tick >= tick && typeof newer === "undefined") newer = snapshot
    }
    if(typeof older !== "undefined" && typeof newer !== "undefined"){
        if(older === newer) return { x: older.positionX, y: older.positionY }
        const t = (tick - older.tick) / (newer.tick - older.tick)
        return {
            x: older.positionX + (newer.positionX - older.positionX) * t,
            y: older.positionY + (newer.positionY - older.positionY) * t,
        }
    }
    const edge = older ?? newer
    if(typeof edge === "undefined") return undefined
    return { x: edge.positionX, y: edge.positionY }
}

export const processPackets = (gameContext: GameContext) => {
    const { game } = gameContext
    for(const events of gameContext.clientEvents.filter("packetMessage")){
        const { packets } = events.packetMessage

        // Sync the shared server clock from this message's tick header. The
        // tick also stamps the remote-player snapshots recorded below.
        const serverTick = (packets.serverTickHeader || [])[0]?.tick
        if(typeof serverTick === "number"){
            gameContext.serverClock.sync(serverTick)
        }

        // Add player
        for(const { playerId } of packets.addPlayer || []){
            game.createPlayer(playerId)
        }

        // Remove player
        for(const { playerId } of packets.removePlayer || []){
            game.players[playerId]?.remove()
        }

        // Set host
        for(const { playerId } of packets.setHost || []){
            const player = game.players[playerId]
            if(typeof player !== "undefined") game.setHost(player)
        }

        // Set player name
        for(const { playerId, name } of packets.playerName || []){
            const player = game.players[playerId]
            if(typeof player !== "undefined") player.setName(name)
        }

        // Set player idle
        for(const { playerId, idle } of packets.playerIdle || []){
            game.players[playerId]?.setIdle(idle)
        }

        // Set player ping
        for(const { playerId, ping } of packets.playerPing || []){
            const player = game.players[playerId]
            if(typeof player !== "undefined") player.ping = ping
        }

        // shoot bullet
        for(const packet of packets.playerShootBullet || []){
            const player = game.players[packet.playerId]
            if(typeof player !== "undefined"){
                game.bullets.new({
                    position: new Vector2(packet.positionX, packet.positionY),
                    velocity: new Vector2(packet.velocityX, packet.velocityY),
                    owner: player,
                    speed: player.ship.stats.bullet.velocity,
                    radius: player.ship.stats.bullet.radius,
                    rotation: 0,
                })
            }
        }

        // Set player ship
        for(const { playerId, shipIndex } of packets.playerSetShip || []){
            game.players[playerId]?.setShip(shipIndex)
        }

        // Set game state
        for(const settings of packets.gameState || []){
            game.setSettings(settings)
        }

        //  Set game phase
        for(const { phase } of packets.gamePhase || []){
            game.setPhase(phase)
        }

        //  Set game countdown
        for(const { countdown } of packets.gameCountdown || []){
            game.countdown = countdown
        }

        //  Set game map
        for(const { mapIndex } of packets.gameMap || []){
            game.setMap(mapIndex)
        }

        //  Force player positions (authoritative hard placement, e.g. during
        //  the countdown). Only ever sent to the owner.
        for(const pos of packets.playerPositionSync || []){
            const player = game.players[pos.playerId]
            if(typeof player === "undefined") continue

            if(pos.playerId === gameContext.client.connectionId){
                player.ship.physics.position.x = pos.positionX
                player.ship.physics.position.y = pos.positionY
                player.ship.physics.velocity.x = pos.velocityX
                player.ship.physics.velocity.y = pos.velocityY
                // Hard teleport: drop prediction/interp state so nothing
                // replays or eases across the discontinuity.
                player.resetNetworkState()
            }
        }

        //  Remote player positions: the physics object stays the collision/AI
        //  anchor, but rendering reads the snapshot buffer (render-behind
        //  interpolation). The owner's own position is no longer broadcast —
        //  it arrives via ownPlayerState below.
        for(const pos of packets.playerPosition || []){
            if(pos.playerId === gameContext.client.connectionId) continue
            const player = game.players[pos.playerId]
            if(typeof player === "undefined") continue

            player.ship.physics.position.x = pos.positionX
            player.ship.physics.position.y = pos.positionY
            player.ship.physics.velocity.x = pos.velocityX
            player.ship.physics.velocity.y = pos.velocityY

            if(typeof serverTick === "number"){
                player.snapshots.push({
                    tick: serverTick,
                    positionX: pos.positionX,
                    positionY: pos.positionY,
                    velocityX: pos.velocityX,
                    velocityY: pos.velocityY,
                })
                while(player.snapshots.length > MAX_SNAPSHOTS){
                    player.snapshots.shift()
                }
            }
        }

        //  Reconcile the local player ONLY when its prediction has genuinely
        //  diverged from the server. In normal play the prediction is accurate
        //  (within the deadzone), so the ship is left completely untouched —
        //  no reset, no replay, no visible correction. This is what removes the
        //  "heavy"/constantly-corrected feel. On a real divergence we reset to
        //  truth, replay the unacknowledged inputs, and ease the residual out
        //  via the decaying render offset.
        for(const state of packets.ownPlayerState || []){
            const player = getClientPlayer(game)
            if(typeof player === "undefined") continue

            // What did we predict for the input the server just acknowledged?
            const predicted = player.predictedStates.find(s => s.seq === state.lastInputSeq)

            // Drop acknowledged inputs regardless of whether we correct.
            player.predictedStates = player.predictedStates.filter(s => seqGreater(s.seq, state.lastInputSeq))

            if(typeof predicted !== "undefined"){
                const errorX = state.positionX - predicted.positionX
                const errorY = state.positionY - predicted.positionY
                if(errorX * errorX + errorY * errorY < RECONCILE_TOLERANCE * RECONCILE_TOLERANCE){
                    // Prediction was good — trust it, correct nothing.
                    continue
                }
            }

            const beforeX = player.ship.physics.position.x
            const beforeY = player.ship.physics.position.y

            // Snap the simulation to authoritative truth and replay the
            // unacknowledged input tail (positions kept as the original
            // predictions, so the deadzone check above stays meaningful).
            player.ship.physics.position.x = state.positionX
            player.ship.physics.position.y = state.positionY
            player.ship.physics.velocity.x = state.velocityX
            player.ship.physics.velocity.y = state.velocityY
            for(const pending of player.predictedStates){
                game.stepLocalPlayer(player, pending.inputs)
            }

            // The visible ship stays put and eases to the corrected position.
            player.renderError.x = clampError(player.renderError.x + (beforeX - player.ship.physics.position.x))
            player.renderError.y = clampError(player.renderError.y + (beforeY - player.ship.physics.position.y))
        }

        // update player ship timings
        for(const values of packets.playerShipTimings || []){
            const player = game.players[values.playerId]
            if(typeof player !== "undefined"){
                player.ship.timings.weaponReload = values.weaponReload
                player.ship.timings.weaponRate = values.weaponRate
                player.ship.timings.tacticalReload = values.tacticalReload
                player.ship.timings.tacticalRate = values.tacticalRate
                player.ship.timings.healthRegenerationRest = values.healthRegenerationRest
                player.ship.timings.healthRegenerationHeal = values.healthRegenerationHeal
                player.ship.timings.invincibility = values.invincibility
            }
        }

        // update player ship capacities
        for(const values of packets.playerShipCapacities || []){
            const player = game.players[values.playerId]
            if(typeof player !== "undefined"){
                player.ship.capacities.weapon = values.weapon
                player.ship.capacities.tactical = values.tactical
                player.ship.capacities.health = values.health
            }
        }

        // update player timings
        for(const values of packets.playerTimings || []){
            const player = game.players[values.playerId]
            if(typeof player !== "undefined"){
                player.timings.spawnTimeout = values.spawnTimeout
            }
        }

        // update player scores
        for(const values of packets.playerScores || []){
            const player = game.players[values.playerId]
            if(typeof player !== "undefined"){
                player.score.kills = values.kills
                player.score.assists = values.assists
                player.score.deaths = values.deaths
                player.score.damage = values.damage
            }
        }

        // show player kill
        for(const kill of packets.playerKill || []){
            const killer = game.players[kill.killerId]
            const killed = game.players[kill.killedId]
            if(typeof killer !== "undefined" && typeof killed !== "undefined"){
                game.events.emit("playerKill", { killer, killed })
            }
        }

        // render player damage
        for(const damage of packets.playerDamage || []){
            const dealer = game.players[damage.dealerId]
            const target = game.players[damage.targetId]
            if(typeof dealer !== "undefined" && typeof target !== "undefined"){
                game.events.emit("dealDamage", { dealer, target, damage: damage.damage })
            }
        }

        // set player inputs
        for(const inputs of packets.playerInputs || []){
            if(inputs.playerId === gameContext.client.connectionId) continue
            
            const player = game.players[inputs.playerId]
            if(typeof player === "undefined") continue
            player.inputs.movementAngle = inputs.movementAngle
            player.inputs.movementAmount = inputs.movementAmount
            player.inputs.aimRotation = inputs.aimRotation
        }

        // despawn player
        for(const { playerId } of packets.despawnPlayer || []){
            const player = game.players[playerId]
            if(typeof player === "undefined") continue
            player.setSpawned(false)
        }

        // spawn player
        for(const { playerId, x, y } of packets.spawnPlayer || []){
            const player = game.players[playerId]
            if(typeof player === "undefined") continue
            game.spawnPlayer(player, x, y)
        }
        
        // Receive chat messages
        for(const { playerId, message } of packets.receiveChat || []){
            const player = game.players[playerId]
            if(typeof player !== "undefined"){
                const sanitizedMessage = message.trim().substring(0, CHAT_MAX_MESSAGE_LENGTH)
                if(sanitizedMessage.length > 0){
                    gameContext.store.chatMessages.push({
                        text: [{
                            style: "player",
                            text: player.name,
                        }, {
                            text: `: ${sanitizedMessage}`,
                        }],
                    })
                }
            }
        }

        const ignorePacket = [
            "playerPositionSync",
            "playerPosition", "playerInputs",
            "serverTickHeader", "ownPlayerState",
            "gameCountdown",
            "ping", "playerPing"]
        for(const key of Object.keys(packets)){
            if(ignorePacket.includes(key)) continue
            for(const packet of packets[key as keyof typeof packets] || []){
                console.log(key, packet)
            }
        }
    }
}


export const sendPackets = (gameContext: GameContext) => {
    const { game, gameEvents, client } = gameContext

    const messages: number[][] = []
    const clientPlayer = getClientPlayer(game)

    if(game.phase === PipPipGamePhase.SETUP){
        if(typeof clientPlayer !== "undefined"){
            if(gameEvents.filter("playerSetShip").length > 0){
                messages.push(encode.playerSetShip(clientPlayer))
            }
        }
    }
    
    // Send only inputs (the server is authoritative over our position now and
    // derives it from these). Inputs carry a sequence number for replay.
    if(game.phase === PipPipGamePhase.MATCH){
        if(typeof clientPlayer !== "undefined"){
            messages.push(encode.playerInputs(clientPlayer))
        }
    }

    // send chat messages
    if(gameContext.store.outgoingMessages.length > 0){
        for(const text of gameContext.store.outgoingMessages){
            messages.push(encode.sendChat(text))
        }
        gameContext.store.outgoingMessages = []
    }
    
    // name change
    for(const event of gameEvents.filter("playerDetailsChange")){
        const { player } = event.playerDetailsChange
        if(player.id === client.connectionId){
            messages.push(encode.playerName(player))
        }
    }
    

    if(messages.length){
        let code: number[] = []
        messages.forEach(mes => code = code.concat(mes))
        const buffer = new Uint8Array(code).buffer
        gameContext.client.send(buffer)
    }
}

// Assign this tick's input sequence number BEFORE the local simulation runs,
// so the predicted state and the input packet sent to the server share it.
export const prepareClientInput = (gameContext: GameContext) => {
    const { game } = gameContext
    if(game.phase !== PipPipGamePhase.MATCH) return
    const clientPlayer = getClientPlayer(game)
    if(typeof clientPlayer === "undefined") return
    clientPlayer.inputSeq = (clientPlayer.inputSeq + 1) & 0xFFFF
}

// Record the predicted state AFTER the local simulation runs, keeping a
// bounded ring of unacknowledged inputs for reset-and-replay reconciliation.
export const recordClientPrediction = (gameContext: GameContext) => {
    const { game } = gameContext
    if(game.phase !== PipPipGamePhase.MATCH) return
    const clientPlayer = getClientPlayer(game)
    if(typeof clientPlayer === "undefined") return
    clientPlayer.predictedStates.push({
        seq: clientPlayer.inputSeq,
        inputs: cloneInputs(clientPlayer.inputs),
        positionX: clientPlayer.ship.physics.position.x,
        positionY: clientPlayer.ship.physics.position.y,
    })
    while(clientPlayer.predictedStates.length > MAX_INPUT_BUFFER){
        clientPlayer.predictedStates.shift()
    }
}