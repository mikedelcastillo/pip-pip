import { Vector2 } from "@pip-pip/core/src/physics"
import { PipPipGamePhase } from "@pip-pip/game/src/logic"
import { POWERUP_CODE_TO_TYPE } from "@pip-pip/game/src/logic/powerup"
import { CHAT_MAX_MESSAGE_LENGTH } from "@pip-pip/game/src/logic/constants"
import { encode } from "@pip-pip/game/src/networking/packets"
import { GameContext, getClientPlayer } from "."
import { useGameStore } from "./store"

export const processPackets = (gameContext: GameContext) => {
    const { game } = gameContext
    const { addChatMessage } = useGameStore.getState()

    for (const events of gameContext.clientEvents.filter("packetMessage")) {
        const { packets } = events.packetMessage

        // Add player
        for (const { playerId } of packets.addPlayer || []) {
            game.createPlayer(playerId)
        }

        // Remove player
        for (const { playerId } of packets.removePlayer || []) {
            game.players[playerId]?.remove()
        }

        // Set host
        for (const { playerId } of packets.setHost || []) {
            const player = game.players[playerId]
            if (typeof player !== "undefined") game.setHost(player)
        }

        // Set player name
        for (const { playerId, name } of packets.playerName || []) {
            const player = game.players[playerId]
            if (typeof player !== "undefined") player.setName(name)
        }

        // Set player idle
        for (const { playerId, idle } of packets.playerIdle || []) {
            game.players[playerId]?.setIdle(idle)
        }

        // Set player spectator state (server-broadcast for every player, so the
        // player list / camera can reflect who is spectating). setSpectator also
        // despawns the player locally if it was spawned.
        for (const { playerId, spectating } of packets.playerSpectate || []) {
            game.players[playerId]?.setSpectator(spectating)
        }

        // Set player ping
        for (const { playerId, ping } of packets.playerPing || []) {
            const player = game.players[playerId]
            if (typeof player !== "undefined") player.ping = ping
        }

        // shoot bullet
        for (const packet of packets.playerShootBullet || []) {
            const player = game.players[packet.playerId]
            if (typeof player !== "undefined") {
                // Reverse the wire mapping from packets.ts: 0 = primary,
                // 1 = tactical, 2 = grenade. Grenades also carry their blast
                // radius so the client renders a matching explosion on death.
                const type = packet.bulletType === 2
                    ? "grenade"
                    : packet.bulletType === 1
                        ? "tactical"
                        : "primary"
                game.bullets.new({
                    position: new Vector2(packet.positionX, packet.positionY),
                    velocity: new Vector2(packet.velocityX, packet.velocityY),
                    owner: player,
                    speed: player.ship.stats.bullet.velocity,
                    radius: packet.radius,
                    rotation: 0,
                    type,
                    explosionRadius: packet.explosionRadius,
                })
            }
        }

        // Set player ship
        for (const { playerId, shipIndex } of packets.playerSetShip || []) {
            game.players[playerId]?.setShip(shipIndex)
        }

        // Powerup spawned: create it locally (server-authoritative; the client
        // never spawns powerups itself). Re-keys onto the server's id so the
        // matching powerupPickup removes the right one.
        for (const { id, type, x, y } of packets.powerupSpawn || []) {
            const powerupType = POWERUP_CODE_TO_TYPE[type]
            if (typeof powerupType === "undefined") continue
            game.powerups.new({ id, type: powerupType, position: new Vector2(x, y) })
        }

        // Powerup picked up: remove it locally by id.
        for (const { id } of packets.powerupPickup || []) {
            game.powerups.unsetById(id)
        }

        // Set game state
        for (const settings of packets.gameState || []) {
            game.setSettings(settings)
        }

        //  Set game phase
        for (const { phase } of packets.gamePhase || []) {
            game.setPhase(phase)
        }

        //  Set game countdown
        for (const { countdown } of packets.gameCountdown || []) {
            game.countdown = countdown
        }

        //  Set game map
        for (const { mapIndex } of packets.gameMap || []) {
            game.setMap(mapIndex)
        }

        //  Set force player positions
        for (const pos of packets.playerPositionSync || []) {
            const player = game.players[pos.playerId]
            if (typeof player === "undefined") continue

            if (pos.playerId === gameContext.client.connectionId) {
                player.ship.physics.position.x = pos.positionX
                player.ship.physics.position.y = pos.positionY
                player.ship.physics.velocity.x = pos.velocityX
                player.ship.physics.velocity.y = pos.velocityY
            }
        }

        //  Set player positions — REMOTE players only. The local player's
        //  authoritative state arrives via ownPlayerState (below) and is
        //  reconciled against client prediction; applying the quantized
        //  broadcast here would fight that prediction and snap the local ship.
        for (const pos of packets.playerPosition || []) {
            if (pos.playerId === gameContext.client.connectionId) continue
            const player = game.players[pos.playerId]
            if (typeof player === "undefined") continue

            player.ship.physics.position.x = pos.positionX
            player.ship.physics.position.y = pos.positionY
            player.ship.physics.velocity.x = pos.velocityX
            player.ship.physics.velocity.y = pos.velocityY
        }

        // Owner-only authoritative state for client-prediction reconciliation.
        // The server reports our position/velocity AFTER consuming our input up
        // to lastInputSeq; reconcileTo shifts the predicted ship to match. This
        // is what keeps the local player in the same place everyone else sees —
        // without it the local ship free-runs its prediction and appears far
        // offset on other screens (worst right after a mid-match join or spawn).
        for (const state of packets.ownPlayerState || []) {
            const player = getClientPlayer(game)
            if (typeof player === "undefined") continue
            player.reconcileTo(
                state.positionX,
                state.positionY,
                state.velocityX,
                state.velocityY,
                state.lastInputSeq,
            )
        }

        // update player ship timings
        for (const values of packets.playerShipTimings || []) {
            const player = game.players[values.playerId]
            if (typeof player !== "undefined") {
                player.ship.timings.weaponReload = values.weaponReload
                player.ship.timings.weaponRate = values.weaponRate
                player.ship.timings.tacticalReload = values.tacticalReload
                player.ship.timings.tacticalRate = values.tacticalRate
                player.ship.timings.healthRegenerationRest = values.healthRegenerationRest
                player.ship.timings.healthRegenerationHeal = values.healthRegenerationHeal
                player.ship.timings.invincibility = values.invincibility
                player.ship.timings.haste = values.haste
                player.ship.timings.shield = values.shield
                player.ship.timings.invisibility = values.invisibility
            }
        }

        // update player ship capacities
        for (const values of packets.playerShipCapacities || []) {
            const player = game.players[values.playerId]
            if (typeof player !== "undefined") {
                player.ship.capacities.weapon = values.weapon
                player.ship.capacities.tactical = values.tactical
                player.ship.capacities.health = values.health
            }
        }

        // update player timings
        for (const values of packets.playerTimings || []) {
            const player = game.players[values.playerId]
            if (typeof player !== "undefined") {
                player.timings.spawnTimeout = values.spawnTimeout
            }
        }

        // update player scores
        for (const values of packets.playerScores || []) {
            const player = game.players[values.playerId]
            if (typeof player !== "undefined") {
                player.score.kills = values.kills
                player.score.assists = values.assists
                player.score.deaths = values.deaths
                player.score.damage = values.damage
            }
        }

        // show player kill
        for (const kill of packets.playerKill || []) {
            const killer = game.players[kill.killerId]
            const killed = game.players[kill.killedId]
            if (typeof killer !== "undefined" && typeof killed !== "undefined") {
                game.events.emit("playerKill", { killer, killed })
            }
        }

        // render player damage
        for (const damage of packets.playerDamage || []) {
            const dealer = game.players[damage.dealerId]
            const target = game.players[damage.targetId]
            if (typeof dealer !== "undefined" && typeof target !== "undefined") {
                game.events.emit("dealDamage", { dealer, target, damage: damage.damage })
            }
        }

        // set player inputs
        for (const inputs of packets.playerInputs || []) {
            if (inputs.playerId === gameContext.client.connectionId) continue

            const player = game.players[inputs.playerId]
            if (typeof player === "undefined") continue
            player.inputs.movementAngle = inputs.movementAngle
            player.inputs.movementAmount = inputs.movementAmount
            player.inputs.aimRotation = inputs.aimRotation
        }

        // despawn player
        for (const { playerId } of packets.despawnPlayer || []) {
            const player = game.players[playerId]
            if (typeof player === "undefined") continue
            player.setSpawned(false)
        }

        // spawn player
        for (const { playerId, x, y } of packets.spawnPlayer || []) {
            const player = game.players[playerId]
            if (typeof player === "undefined") continue
            game.spawnPlayer(player, x, y)
        }

        // Receive chat messages
        for (const { playerId, message } of packets.receiveChat || []) {
            const player = game.players[playerId]
            if (typeof player !== "undefined") {
                const sanitizedMessage = message.trim().substring(0, CHAT_MAX_MESSAGE_LENGTH)
                if (sanitizedMessage.length > 0) {
                    addChatMessage({
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
            "ownPlayerState",
            "gameCountdown",
            "playerSpectate",
            "powerupSpawn", "powerupPickup",
            "ping", "playerPing"]
        // Per-tick packet trace — dev only. In production this logged every
        // non-ignored packet (timings/capacities/scores/damage/kills...) at the
        // tick rate, spamming the console.
        if (import.meta.env.DEV) {
            for (const key of Object.keys(packets)) {
                if (ignorePacket.includes(key)) continue
                for (const packet of packets[key as keyof typeof packets] || []) {
                    console.log(key, packet)
                }
            }
        }
    }
}


export const sendPackets = (gameContext: GameContext) => {
    const { game, gameEvents, client } = gameContext

    const messages: number[][] = []
    const clientPlayer = getClientPlayer(game)

    if (game.phase === PipPipGamePhase.SETUP) {
        if (typeof clientPlayer !== "undefined") {
            if (gameEvents.filter("playerSetShip").length > 0) {
                messages.push(encode.playerSetShip(clientPlayer))
            }
        }
    }

    // send inputs (server-authoritative: it simulates from these, NOT from any
    // client-reported position — so we no longer send playerPosition at all).
    // Record the predicted post-sim position for THIS tick's inputSeq first, so
    // ownPlayerState can later reconcile against it.
    if (game.phase === PipPipGamePhase.MATCH) {
        if (typeof clientPlayer !== "undefined") {
            clientPlayer.recordPredictedState()
            messages.push(encode.playerInputs(clientPlayer))
        }
    }

    // send chat messages
    const outgoing = useGameStore.getState().consumeOutgoingMessages()
    for (const text of outgoing) {
        messages.push(encode.sendChat(text))
    }

    // name change
    for (const event of gameEvents.filter("playerDetailsChange")) {
        const { player } = event.playerDetailsChange
        if (player.id === client.connectionId) {
            messages.push(encode.playerName(player))
        }
    }

    if (messages.length) {
        let code: number[] = []
        messages.forEach(mes => code = code.concat(mes))
        const buffer = new Uint8Array(code).buffer
        gameContext.client.send(buffer)
    }
}
