import { PipPipGame, PipPipGamePhase, PipPipGameMode } from "@pip-pip/game/src/logic"
import { sanitize } from "@pip-pip/game/src/logic/utils"
import { CHAT_MAX_MESSAGE_LENGTH } from "@pip-pip/game/src/logic/constants"
import { encode } from "@pip-pip/game/src/networking/packets"
import { PIP_MAPS } from "@pip-pip/game/src/maps"
import type { GameTickContext } from "."
import { sanitizePlayerInputs } from "./input-sanitize"

// In-lobby mode-target bounds, mirrored from the host UI (HostSettingsModal /
// the lobby Match panel). The client clamps too, but the server never trusts
// the wire, so it re-clamps every incoming gameMode here.
const MODE_MIN_KILLS = 5
const MODE_MAX_KILLS = 50
const MODE_MIN_MINUTES = 1
const MODE_MAX_MINUTES = 10

const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value))

// Max bots a single command may add, to bound server work. The default lobby
// caps at 16 connections; this keeps a bot flood from blowing past that idea.
const MAX_BOTS_PER_COMMAND = 16

// Chat rate limit: a token bucket per connection. Capacity is the burst a peer
// may send back-to-back; tokens refill at CHAT_RATE_PER_SECOND/sec. ~3 msg/sec
// sustained with a small burst is plenty for humans and starves a chat-flood.
const CHAT_RATE_PER_SECOND = 3
const CHAT_BURST = 5

type ChatRateState = {
    tokens: number,
    lastRefill: number,
}

// Per-connection rate-limit state, persisted across ticks. Keyed by connection
// id. Entries are pruned lazily in pruneChatState once a connection is gone.
const chatRateStates = new Map<string, ChatRateState>()

// Per-tick set of approved (validated, rate-limited, non-command) chat messages
// keyed by sender connection id. Rebuilt every tick by processChatMessages
// (runs once, in connection-in) and consumed by the per-recipient broadcast in
// connection-out - so the rate limit counts each message ONCE, not once per
// recipient. Drained/replaced wholesale each tick; never grows unbounded.
const approvedChat = new Map<string, string[]>()

// Refill + spend one token. Returns true if the message is allowed to pass.
function takeChatToken(connectionId: string, now: number){
    let state = chatRateStates.get(connectionId)
    if(typeof state === "undefined"){
        state = { tokens: CHAT_BURST, lastRefill: now }
        chatRateStates.set(connectionId, state)
    }
    const elapsed = Math.max(0, now - state.lastRefill) / 1000
    state.tokens = Math.min(CHAT_BURST, state.tokens + elapsed * CHAT_RATE_PER_SECOND)
    state.lastRefill = now
    if(state.tokens < 1) return false
    state.tokens -= 1
    return true
}

// Validate one raw chat message. Returns the broadcast-ready text, or undefined
// to drop it. Empty/whitespace-only messages are dropped; the rest is clamped
// to CHAT_MAX_MESSAGE_LENGTH so a single message can never be oversized even if
// the client ignores its own limit.
export function sanitizeChatMessage(message: string){
    if(typeof message !== "string") return undefined
    const trimmed = message.trim()
    if(trimmed.length === 0) return undefined
    return trimmed.slice(0, CHAT_MAX_MESSAGE_LENGTH)
}

// Every (senderId, messages) pair approved for broadcast THIS tick. Returns one
// entry per sender (already de-duplicated across that sender's ws messages), so
// connection-out can emit each approved message exactly once per recipient.
export function getApprovedChatEntries(): [string, string[]][]{
    return Array.from(approvedChat.entries())
}

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

// Drop rate-limit state for connections that have left the lobby so the map
// does not grow without bound over the server's lifetime.
function pruneChatState(game: PipPipGame){
    for(const id of chatRateStates.keys()){
        if(!(id in game.players)) chatRateStates.delete(id)
    }
}

// Validate, rate-limit and de-command every sender's chat for THIS tick, once.
// Builds the approvedChat map that connection-out broadcasts from. Runs before
// the broadcast (same tick, before lobbyEvents flush) so its results are live
// for every recipient's send. Host commands are NOT echoed to chat (they are
// executed in processLobbyPackets and suppressed from the broadcast here).
export function processChatMessages(context: GameTickContext){
    const { game, lobbyEvents } = context
    approvedChat.clear()
    const now = Date.now()

    for(const events of lobbyEvents.filter("packetMessage")){
        const { packets, connection } = events.packetMessage
        const player = game.players[connection.id]
        if(typeof player === "undefined") continue

        for(const { message } of packets.sendChat || []){
            // Suppress recognized host commands from the chat log entirely; they
            // are acted on in processLobbyPackets, not broadcast.
            if(game.host?.id === connection.id && (isBotCommand(message) || isHostPromoteCommand(message))) continue

            const clean = sanitizeChatMessage(message)
            if(typeof clean === "undefined") continue
            // Rate-limit AFTER validation so dropped empties don't burn tokens.
            if(!takeChatToken(connection.id, now)) continue

            const list = approvedChat.get(connection.id)
            if(typeof list === "undefined"){
                approvedChat.set(connection.id, [clean])
            } else{
                list.push(clean)
            }
        }
    }

    pruneChatState(game)
}

// Host-only: disband the whole lobby and send everyone home. Tell every
// connection still in the lobby that it closed (so each client navigates home
// and shows the on-brand notice), THEN remove the lobby via the core API. The
// lobbyClosed packet must go out BEFORE removeLobby, because removeLobby ->
// lobby.destroy() drops every connection and tears the game down, after which
// there is nobody left to notify. Returns true once a close ran (a missing
// lobby - e.g. a unit-test context with no lobby - makes this a no-op).
function closeLobbyForHost(context: GameTickContext){
    const { lobby } = context
    if(typeof lobby === "undefined") return false

    const closed = encode.lobbyClosed()
    for(const connection of Object.values(lobby.connections)){
        // Best-effort: a connection whose socket is already gone just no-ops on
        // send; we still tear the lobby down for the rest below.
        connection.send(new Uint8Array(closed).buffer)
    }

    // Full teardown via the core API: destroy() removes every connection from the
    // lobby and the server entry's "destroy" handler stops the ticks + game.
    lobby.server.removeLobby(lobby)
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

        // Host-only: change the match mode + its target from the lobby. Validate
        // the mode and clamp the targets to the same bounds the host UI enforces,
        // then setSettings applies it (a no-op outside SETUP, so this can only
        // change things in the lobby). The new settings reach every client on the
        // next gameState broadcast.
        for(const { mode, maxKills, matchMinutes } of packets.gameMode || []){
            if(game.host?.id === connection.id){
                if(mode === PipPipGameMode.DEATHMATCH || mode === PipPipGameMode.KILL_FRENZY){
                    game.setSettings({
                        mode,
                        maxKills: clamp(maxKills, MODE_MIN_KILLS, MODE_MAX_KILLS),
                        matchMinutes: clamp(matchMinutes, MODE_MIN_MINUTES, MODE_MAX_MINUTES),
                    })
                }
            }
        }

        // Host-only: close the lobby. Server-authoritative - ONLY the host may
        // disband it, so a non-host's closeLobby is ignored. The handler notifies
        // every connection then removes the lobby; because that teardown drops all
        // connections and stops the game, we return immediately rather than touch
        // the now-dead lobby/game for the rest of this tick.
        if((packets.closeLobby || []).length > 0 && game.host?.id === connection.id){
            closeLobbyForHost(context)
            return
        }

        // set player ship
        for(const { playerId, shipIndex } of packets.playerSetShip || []){
            const player = game.players[connection.id]
            if(typeof player !== "undefined" && connection.id === playerId){
                player.setShip(shipIndex)
            }
        }

        // Set player spectator state. Only honoured for the connection's OWN
        // player; setSpectator despawns it if currently spawned, and the
        // re-broadcast in connection-out tells every other client (so their
        // player lists reflect who is spectating).
        for(const { playerId, spectating } of packets.playerSpectate || []){
            const player = game.players[connection.id]
            if(typeof player !== "undefined" && connection.id === playerId){
                player.setSpectator(spectating)
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

    // Validate + rate-limit chat ONCE this tick; connection-out broadcasts from
    // the approved store this builds (not the raw packets).
    processChatMessages(context)
}