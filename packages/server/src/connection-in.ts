import { PipPipGamePhase } from "@pip-pip/game/src/logic"
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

        // The server no longer trusts client-reported positions (it used to
        // copy them into authoritative state within a tolerance, which made
        // the local ship effectively client-authoritative). Position is now
        // derived purely from the simulation driven by queued inputs below.

        // Queue player inputs for consumption (one per tick, in seq order).
        for(const inputs of packets.playerInputs || []){
            const player = game.players[connection.id]
            if(typeof player !== "undefined"){
                player.pushInputFrame(inputs.inputSeq, {
                    movementAngle: inputs.movementAngle,
                    movementAmount: inputs.movementAmount,
                    aimRotation: inputs.aimRotation,
                    useWeapon: inputs.useWeapon,
                    useTactical: inputs.useTactical,
                    doReload: inputs.doReload,
                    spawn: false,
                })
            }
        }
    }
}