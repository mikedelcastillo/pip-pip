import { PipPipGame, PipPipGamePhase, PipPipGameMode, BotDifficultyChoice } from "@pip-pip/game/src/logic"
import { BotDifficulty } from "@pip-pip/game/src/logic/ai"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import { sanitize } from "@pip-pip/game/src/logic/utils"
import { CHAT_MAX_MESSAGE_LENGTH } from "@pip-pip/game/src/logic/constants"
import {
    encode,
    HOST_BOTS_ACTION_ADD,
    HOST_BOTS_ACTION_REMOVE,
    HOST_BOTS_ACTION_CLEAR,
    HOST_BOTS_ACTION_FILL,
    HOST_BOTS_DIFFICULTY_MIXED,
} from "@pip-pip/game/src/networking/packets"
import { PIP_MAPS } from "@pip-pip/game/src/maps"
import { validateGridMapData } from "@pip-pip/game/src/logic/grid-map"
import type { GameTickContext } from "."
import { sanitizePlayerInputs } from "./input-sanitize"
import { dispatchCommand, isCommandMessage, parseCommand, type CommandContext } from "./commands"

// In-lobby mode-target bounds, mirrored from the host UI (HostSettingsModal /
// the lobby Match panel). The client clamps too, but the server never trusts
// the wire, so it re-clamps every incoming gameMode here.
const MODE_MIN_KILLS = 5
const MODE_MAX_KILLS = 50
const MODE_MIN_MINUTES = 1
const MODE_MAX_MINUTES = 10

const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value))

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

// True if `message` is a recognized bot-command word. Thin wrapper over the
// command registry (the registry is the single source of truth for command
// names), kept exported because existing tests + the chat-suppression path import
// it. Recognition only: host gating happens at dispatch time. "/botanist" and
// "nice /bot" are NOT commands (they do not parse to a bare command word).
export function isBotCommand(message: string){
    const parsed = parseCommand(message)
    if(typeof parsed === "undefined") return false
    return parsed.name === "/bot" || parsed.name === "/bots" || parsed.name === "/clearbots"
}

// True if `message` is a recognized host promote-command word. Mirrors
// isBotCommand: a thin wrapper over the registry kept for the tests + the chat
// path. The legacy "/makehost" alias is still recognized here; the registry
// canonical command is "/op", and dispatchCommand routes "/makehost" to it below.
export function isHostPromoteCommand(message: string){
    const parsed = parseCommand(message)
    if(typeof parsed === "undefined") return false
    return parsed.name === "/op" || parsed.name === "/makehost"
}

// "/makehost" is a legacy alias for the registry's "/op" command. The registry
// keys on "/op", so normalize the alias before dispatch so both still promote.
function normalizeCommandAliases(message: string){
    const parsed = parseCommand(message)
    if(typeof parsed === "undefined") return message
    if(parsed.name === "/makehost"){
        return message.trim().replace(/^\S+/, "/op")
    }
    return message
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
            // Suppress ANY recognized command from the chat log entirely; commands
            // are acted on in processLobbyPackets (with their replies sent only to
            // the requester), never broadcast. This covers a non-host's host-only
            // command too: it is suppressed here and answered with a denial reply
            // at dispatch rather than leaking the raw "/kick ..." into chat.
            if(isCommandMessage(message)) continue

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

// Upper bound on the bots a single host packet may add/remove. The game also
// hard-caps the TOTAL at MAX_BOTS, so this is just a per-request sanity clamp.
const MAX_BOTS_PER_COMMAND = 16

// Decode a hostBots wire difficulty into the BotDifficultyChoice the game logic
// wants: the mixed sentinel -> "mixed", a valid 0..2 -> that BotDifficulty,
// anything else falls back to "mixed" (the server never trusts the wire).
function decodeBotDifficulty(value: number): BotDifficultyChoice {
    if(value === HOST_BOTS_DIFFICULTY_MIXED) return "mixed"
    if(value === BotDifficulty.EASY) return BotDifficulty.EASY
    if(value === BotDifficulty.MEDIUM) return BotDifficulty.MEDIUM
    if(value === BotDifficulty.HARD) return BotDifficulty.HARD
    return "mixed"
}

// Apply one host bot-config request to the game. HOST-GATED by the caller exactly
// like the /bot chat commands. add/remove clamp their count; clear/fill ignore it.
// All paths go through the game methods, which enforce the MAX_BOTS hard cap.
function runHostBotsPacket(game: PipPipGame, action: number, count: number, difficulty: number){
    const difficultyChoice = decodeBotDifficulty(difficulty)
    if(action === HOST_BOTS_ACTION_ADD){
        const safe = Number.isFinite(count) ? count : 1
        game.addBots(Math.min(Math.max(1, safe), MAX_BOTS_PER_COMMAND), difficultyChoice)
        return
    }
    if(action === HOST_BOTS_ACTION_REMOVE){
        const safe = Number.isFinite(count) ? count : 1
        game.removeBots(Math.min(Math.max(1, safe), MAX_BOTS_PER_COMMAND))
        return
    }
    if(action === HOST_BOTS_ACTION_CLEAR){
        game.clearBots()
        return
    }
    if(action === HOST_BOTS_ACTION_FILL){
        game.fillBots(difficultyChoice)
        return
    }
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

        // Host-only: load a CUSTOM (uploaded / editor) map into the live match.
        // Mirrors the gameMap host gate above. The server NEVER trusts the wire:
        // it re-validates the GridMapData via validateGridMapData (the same shared
        // gate the client ran) and only applies it when valid; a malformed payload
        // is ignored. setCustomMap then rebuilds walls + despawns, and the new
        // geometry rides back to every client (including late joiners) through
        // connection-out's customMap branch.
        for(const { data } of packets.customMap || []){
            if(game.host?.id === connection.id){
                const valid = validateGridMapData(data)
                if(valid !== null){
                    game.setCustomMap(valid)
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
                if(
                    mode === PipPipGameMode.DEATHMATCH ||
                    mode === PipPipGameMode.KILL_FRENZY ||
                    mode === PipPipGameMode.TEAM_DEATHMATCH
                ){
                    // TEAM_DEATHMATCH turns on teams + friendly-fire-off; the
                    // free-for-all modes turn them back off, so switching modes
                    // in the lobby always lands a consistent settings pair.
                    const isTeam = mode === PipPipGameMode.TEAM_DEATHMATCH
                    game.setSettings({
                        mode,
                        useTeams: isTeam,
                        friendlyFire: !isTeam,
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

        // Host-only: configure the lobby's bots (add/remove/clear/fill). Gated on
        // the host identity exactly like the /bot chat commands, then dispatched to
        // the matching game method. The bot changes ride back to every client
        // through the normal add/remove/name broadcasts, so nothing extra is sent.
        for(const { action, count, difficulty } of packets.hostBots || []){
            if(game.host?.id === connection.id){
                runHostBotsPacket(game, action, count, difficulty)
            }
        }

        // Set player "ready up" state. A player may only set their OWN ready, so
        // authority comes from connection.id and the packet's playerId is ignored.
        // setReady emits playerReadyChange, which connection-out re-broadcasts so
        // every client's lobby footer + player list agree on the ready tally.
        for(const { ready } of packets.playerReady || []){
            game.players[connection.id]?.setReady(ready === 1)
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

        // Chat-channel commands. EVERY sender's messages run through the registry
        // dispatcher (per-command host gating lives inside dispatchCommand, not
        // here). Recognized commands are NOT echoed to chat - processChatMessages
        // suppresses them via isCommandMessage; their replies go ONLY to the
        // requester. "/makehost" is normalized to the registry's "/op" first.
        const requester = game.players[connection.id]
        if(typeof requester !== "undefined"){
            for(const { message } of packets.sendChat || []){
                if(!isCommandMessage(normalizeCommandAliases(message))) continue
                const ctx = buildCommandContext(context, connection, requester)
                dispatchCommand(normalizeCommandAliases(message), ctx)
            }
        }
    }

    // Validate + rate-limit chat ONCE this tick; connection-out broadcasts from
    // the approved store this builds (not the raw packets).
    processChatMessages(context)
}

// Build the CommandContext for one requester. Keeps connection-in declarative and
// the registry pure: the side-effect hooks (reply, kick) are constructed here,
// where the connection + lobby are in scope.
//
// reply: send a short line back to ONLY the requester over the existing chat wire
// (no new packet), using the requester as the sender so it renders as a normal
// chat line in their own log. Best-effort - a stub/socketless connection (unit
// tests) simply has no send and the reply is a no-op.
//
// kick: disconnect a target player's connection. Found by player id in the
// lobby's connections and dropped via the core Connection.destroy() API (the same
// teardown a normal disconnect uses: it leaves the lobby + game and frees the
// slot). No-op if the lobby or the target's connection is absent.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCommandContext(context: GameTickContext, connection: any, requester: PipPlayer): CommandContext{
    const { game, lobby } = context
    return {
        game,
        player: requester,
        isHost: game.host?.id === requester.id,
        reply: (message: string) => {
            if(typeof connection?.send !== "function") return
            const encoded = encode.receiveChat(requester, message)
            connection.send(new Uint8Array(encoded).buffer)
        },
        kick: (target: PipPlayer) => {
            if(typeof lobby === "undefined") return
            const targetConnection = lobby.connections[target.id]
            if(typeof targetConnection === "undefined") return
            targetConnection.destroy()
        },
    }
}
