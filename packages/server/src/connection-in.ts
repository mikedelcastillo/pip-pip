import { forgivingEqual } from "@pip-pip/core/src/math"
import { PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PLAYER_POSITION_TOLERANCE } from "@pip-pip/game/src/logic/constants"
import { sanitize } from "@pip-pip/game/src/logic/utils"
import { PIP_MAPS } from "@pip-pip/game/src/maps"
import { GameTickContext } from "."

export function processLobbyPackets(context: GameTickContext){
    const { game, lobbyEvents } = context
    // Add players
    for(const events of lobbyEvents.filter("addConnection")){
        const { connection } = events.addConnection
        const player = game.createPlayer(connection.id)
        game.addPlayerMidGame(player)
    }
    // Remove players
    for(const events of lobbyEvents.filter("removeConnection")){
        const { connection } = events.removeConnection
        const player = game.players[connection.id]
        if(player !== undefined){
            player.remove()
        }
    }

    // Update player status
    for(const events of lobbyEvents.filter("connectionStatusChange")){
        const { connection } = events.connectionStatusChange
        game.players[connection.id]?.setIdle(connection.isIdle)
    }

    // Process packets
    for(const events of lobbyEvents.filter("packetMessage")){
        const { packets, connection } = events.packetMessage

        for(const { mapIndex } of packets.gameMap || []){
            if(game.host?.id === connection.id){
                if(mapIndex in PIP_MAPS){
                    game.setMap(mapIndex)
                }
            }
        }

        // set player ship
        for(const { playerId, shipIndex } of packets.playerSetShip || []){
            const player = game.players[connection.id]
            if(typeof player !== "undefined" && connection.id === playerId){
                player.setShip(shipIndex)
            }
        }

        // set player name
        for(const { playerId, name } of packets.playerName || []){
            const player = game.players[playerId]
            if(typeof player !== "undefined" && connection.id === playerId){
                const safeName = sanitize(name)
                player.setName(safeName)
            }
        }

        //  Set game phase if host
        for(const { phase } of packets.gamePhase || []){
            if(game.host?.id === connection.id){
                if(phase === PipPipGamePhase.SETUP){
                    // cancel game if ever
                    game.setPhase(phase)
                }
                if(phase === PipPipGamePhase.MATCH){
                    game.startMatch()
                }
            }
        }

        //  Set player position
        for(const pos of packets.playerPosition || []){
            const player = game.players[connection.id]
            if(typeof player !== "undefined"){
                const lookbackRaw = player.ping / game.deltaMs
                const state = player.getLastTickState(lookbackRaw)
                const x = forgivingEqual((state.positionX + state.velocityX), (pos.positionX), PLAYER_POSITION_TOLERANCE)
                const y = forgivingEqual((state.positionY + state.velocityY), (pos.positionY), PLAYER_POSITION_TOLERANCE)
                if(x && y){
                    player.ship.physics.position.x = pos.positionX
                    player.ship.physics.position.y = pos.positionY
                    player.ship.physics.velocity.x = pos.velocityX
                    player.ship.physics.velocity.y = pos.velocityY
                } else{
                    console.log(`Player ${player.id} position discarded. x: ${state.positionX.toFixed(2)}, y: ${state.positionY.toFixed(2)}`)
                }
            }
        }

        // set player inputs
        for(const inputs of packets.playerInputs || []){
            const player = game.players[connection.id]
            if(typeof player !== "undefined"){
                player.inputs.movementAngle = inputs.movementAngle
                player.inputs.movementAmount = inputs.movementAmount
                player.inputs.aimRotation = inputs.aimRotation
                player.inputs.useWeapon = inputs.useWeapon
                player.inputs.useTactical = inputs.useTactical
                player.inputs.doReload = inputs.doReload
            }
        }
    }
}