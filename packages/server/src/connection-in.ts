import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { sanitize } from "@pip-pip/game/src/logic/utils"
import { PIP_MAPS } from "@pip-pip/game/src/maps"
import type { GameTickContext } from "."
import { sanitizePlayerInputs } from "./input-sanitize"

// Max bots a single command may add, to bound server work. The default lobby
// caps at 16 connections; this keeps a bot flood from blowing past that idea.
const MAX_BOTS_PER_COMMAND = 16

// True if `message` is a recognized host bot-command. Used by both the
// command processor (to act on it) and the outgoing chat broadcast (to avoid
// echoing the raw command back into the chat log). Only the lobby host's
// commands are honoured; everyone else's "/bot" is treated as plain chat.
export function isBotCommand(message: string){
    const word = message.trim().toLowerCase().split(/\s+/)[0]
    return word === "/bot" || word === "/bots" || word === "/clearbots"
}

// True if `message` is a recognized host promote-command. Mirrors isBotCommand:
// used by the command processor (to act on it) and the outgoing chat broadcast
// (to suppress echoing the raw command). Only honoured for the lobby host.
export function isHostPromoteCommand(message: string){
    const word = message.trim().toLowerCase().split(/\s+/)[0]
    return word === "/op" || word === "/makehost"
}

// Execute a host bot-command. No-op (returns false) if the text is not a
// recognized command. Centralised here so the chat path stays declarative.
function runBotCommand(game: PipPipGame, message: string){
    const parts = message.trim().split(/\s+/)
    const command = parts[0].toLowerCase()

    if(command === "/bot"){
        game.addBot()
        return true
    }
    if(command === "/bots"){
        const requested = Number.parseInt(parts[1] ?? "1", 10)
        const count = Number.isFinite(requested) ? requested : 1
        game.addBots(Math.min(Math.max(1, count), MAX_BOTS_PER_COMMAND))
        return true
    }
    if(command === "/clearbots"){
        game.clearBots()
        return true
    }
    return false
}

// Execute a host promote-command. No-op (returns false) if the text is not a
// recognized command or no matching target player exists. The target is named
// by player name (case-insensitive, trimmed) or by its 2-char id; on a match
// game.setHost overrides setHostIfNeeded's players[0] default and sticks.
function runHostPromoteCommand(game: PipPipGame, message: string){
    const parts = message.trim().split(/\s+/)
    const command = parts[0].toLowerCase()

    if(command !== "/op" && command !== "/makehost") return false

    const target = parts.slice(1).join(" ").trim()
    if(target.length === 0) return false

    const wanted = target.toLowerCase()
    const players = Object.values(game.players)
    const match = players.find(player =>
        player.id.toLowerCase() === wanted ||
        player.name.trim().toLowerCase() === wanted)

    if(typeof match === "undefined") return false

    game.setHost(match)
    return true
}

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
                // Drop/clamp hostile non-finite floats before they reach the sim.
                const safe = sanitizePlayerInputs(inputs)
                player.pushInputFrame(inputs.inputSeq, {
                    movementAngle: safe.movementAngle,
                    movementAmount: safe.movementAmount,
                    aimRotation: safe.aimRotation,
                    useWeapon: inputs.useWeapon,
                    useTactical: inputs.useTactical,
                    doReload: inputs.doReload,
                    spawn: false,
                })
            }
        }

        // Host-only commands sent through the chat channel:
        //   /bot        add one training-grounds bot
        //   /bots N     add N bots (clamped to MAX_BOTS_PER_COMMAND)
        //   /clearbots  remove all bots
        //   /op <name|id> (alias /makehost) promote a player to host
        // Recognized commands are NOT echoed back to chat (connection-out skips
        // them via isBotCommand / isHostPromoteCommand). Only the host may run them.
        if(game.host?.id === connection.id){
            for(const { message } of packets.sendChat || []){
                if(isBotCommand(message)){
                    runBotCommand(game, message)
                } else if(isHostPromoteCommand(message)){
                    runHostPromoteCommand(game, message)
                }
            }
        }
    }
}