import { $bool, $float16, $float32, $quant16, $string, $uint16, $uint32, $uint8, $varstring } from "@pip-pip/core/src/networking/packets/serializer"
import { PacketManager, ExtractSerializerMap } from "@pip-pip/core/src/networking/packets/manager"
import { Packet } from "@pip-pip/core/src/networking/packets/packet"

import { PipPlayer } from "../logic/player"
import { PipPipGame, PipPipGamePhase, PipPipGameMode } from "../logic"
import { Bullet } from "../logic/bullet"
import { Powerup, POWERUP_ID_LENGTH, POWERUP_TYPE_TO_CODE } from "../logic/powerup"
import { WORLD_QUANT_RANGE } from "../logic/constants"

export const CONNECTION_ID_LENGTH = 2
export const LOBBY_ID_LENGTH = 4

// Fixed-point world position serializer shared by every position field on the
// all-to-all broadcast. Every field that decodes a world coordinate MUST use
// this same instance so they share one quantization lattice.
const $worldPos = $quant16(WORLD_QUANT_RANGE)

export const packetManager = new PacketManager({
    sendChat: new Packet({
        message: $varstring,
    }),
    receiveChat: new Packet({
        playerId: $string(CONNECTION_ID_LENGTH),
        message: $varstring,
    }),

    addPlayer: new Packet({
        playerId: $string(CONNECTION_ID_LENGTH),
    }),
    removePlayer: new Packet({
        playerId: $string(CONNECTION_ID_LENGTH),
    }),
    
    despawnPlayer: new Packet({
        playerId: $string(CONNECTION_ID_LENGTH),
    }),
    spawnPlayer: new Packet({
        playerId: $string(CONNECTION_ID_LENGTH),
        x: $worldPos,
        y: $worldPos,
    }),
    playerName: new Packet({
        playerId: $string(CONNECTION_ID_LENGTH),
        name: $varstring,
    }),
    playerIdle: new Packet({
        playerId: $string(CONNECTION_ID_LENGTH),
        idle: $bool
    }),
    playerSpectate: new Packet({
        playerId: $string(CONNECTION_ID_LENGTH),
        spectating: $bool,
    }),
    playerPing: new Packet({
        playerId: $string(CONNECTION_ID_LENGTH),
        ping: $uint16,
    }),
    playerSetShip: new Packet({
        playerId: $string(CONNECTION_ID_LENGTH),
        shipIndex: $uint8,
    }),
    playerPosition: new Packet({
        playerId: $string(CONNECTION_ID_LENGTH),
        positionX: $worldPos,
        positionY: $worldPos,
        velocityX: $float16,
        velocityY: $float16,
    }),
    playerPositionSync: new Packet({
        playerId: $string(CONNECTION_ID_LENGTH),
        positionX: $worldPos,
        positionY: $worldPos,
        velocityX: $float16,
        velocityY: $float16,
    }),
    playerInputs: new Packet({
        playerId: $string(CONNECTION_ID_LENGTH),
        inputSeq: $uint16,
        movementAngle: $float16,
        movementAmount: $float16,
        aimRotation: $float16,
        useWeapon: $bool,
        useTactical: $bool,
        doReload: $bool,
    }),

    playerShootBullet: new Packet({
        playerId: $string(CONNECTION_ID_LENGTH),
        positionX: $worldPos,
        positionY: $worldPos,
        velocityX: $float16,
        velocityY: $float16,
        radius: $float16,
        // 0 = primary, 1 = tactical, 2 = grenade (see the encode helper below).
        bulletType: $uint8,
        // AoE blast radius for grenade bullets (0 for primary/tactical) so the
        // client can reconstruct the grenade and size its explosion to match.
        explosionRadius: $float16,
    }),

    // One global header prepended once per outgoing message carrying the
    // authoritative server tick. NOT per-player (the broadcast is O(n^2)).
    serverTickHeader: new Packet({
        tick: $uint32,
    }),

    // Sent ONLY to the owning connection. float32 position kills the
    // quantization noise on the exact path reconciliation compares against,
    // and lastInputSeq tells the client how far the server has consumed its
    // input stream so it can replay the unacknowledged tail.
    ownPlayerState: new Packet({
        positionX: $float32,
        positionY: $float32,
        velocityX: $float32,
        velocityY: $float32,
        lastInputSeq: $uint16,
    }),

    playerShipTimings: new Packet({
        playerId: $string(CONNECTION_ID_LENGTH),
        weaponReload: $uint8,
        weaponRate: $uint8,
        tacticalReload: $uint8,
        tacticalRate: $uint8,
        healthRegenerationRest: $uint8,
        healthRegenerationHeal: $uint8,
        invincibility: $uint8,
        // Timed-buff timers (HASTE_TICKS / SHIELD_TICKS / INVIS_TICKS). uint8, so
        // durations must stay <= 255 ticks. Networked so remote ships' buffs are
        // known (for the visual) and the local player's prediction uses the same
        // haste. `invisibility` drives the cloak fade and is DISTINCT from the
        // `invincibility` no-damage timer above.
        haste: $uint8,
        shield: $uint8,
        invisibility: $uint8,
    }),

    playerShipCapacities: new Packet({
        playerId: $string(CONNECTION_ID_LENGTH),
        weapon: $uint8,
        tactical: $uint8,
        health: $uint8,
    }),

    playerTimings: new Packet({
        playerId: $string(CONNECTION_ID_LENGTH),
        spawnTimeout: $uint8,
    }),

    playerScores: new Packet({
        playerId: $string(CONNECTION_ID_LENGTH),
        kills: $uint16,
        assists: $uint16,
        deaths: $uint16,
        damage: $uint32,
    }),

    playerDamage: new Packet({
        dealerId: $string(CONNECTION_ID_LENGTH),
        targetId: $string(CONNECTION_ID_LENGTH),
        damage: $uint32,
    }),

    playerKill: new Packet({
        killerId: $string(CONNECTION_ID_LENGTH),
        killedId: $string(CONNECTION_ID_LENGTH),
    }),

    setHost: new Packet({
        playerId: $string(CONNECTION_ID_LENGTH),
    }),
    gameState: new Packet({
        mode: $uint8,
        useTeams: $bool,
        maxDeaths: $uint8,
        maxKills: $uint8,
        // KILL_FRENZY match length in whole minutes (see settings.matchMinutes).
        matchMinutes: $uint8,
        friendlyFire: $bool,
    }),
    gamePhase: new Packet({
        phase: $uint8,
    }),
    gameCountdown: new Packet({
        countdown: $uint8,
    }),
    // KILL_FRENZY match clock, sent during MATCH as REMAINING SECONDS (whole
    // seconds, ceil'd) so the HUD can count down without knowing the tick rate.
    // uint16, so it comfortably covers any sane match length.
    matchTimer: new Packet({
        seconds: $uint16,
    }),
    // End-of-match results. winnerId is one winner's player id, or the empty
    // (padded) string when there is no single winner to name (a tie, or a timed
    // match that ended with zero kills). winnerCount lets the client tell a tie
    // (>1) apart from a clean win (1) or a no-winner "Time!" (0) without putting
    // every id on the wire, since the final scoreboard already shows standings.
    gameResults: new Packet({
        winnerId: $string(CONNECTION_ID_LENGTH),
        winnerCount: $uint8,
    }),
    gameMap: new Packet({
        mapIndex: $uint8,
    }),
    // Host-only request to change the match mode + its target while still in the
    // lobby (SETUP). The server validates the host, clamps the values and applies
    // them via game.setSettings (a no-op outside SETUP); the change then rides the
    // normal per-tick gameState broadcast back to every client. mode is the
    // PipPipGameMode wire value; maxKills is the DEATHMATCH target, matchMinutes
    // the KILL_FRENZY length - both sent every time so neither is lost on a switch.
    gameMode: new Packet({
        mode: $uint8,
        maxKills: $uint8,
        matchMinutes: $uint8,
    }),

    // A powerup that became active (full state on join + on spawn). type is the
    // PowerupType wire code (see POWERUP_TYPE_TO_CODE); the id is a fixed-length
    // string so the matching powerupPickup can remove it by id.
    powerupSpawn: new Packet({
        id: $string(POWERUP_ID_LENGTH),
        type: $uint8,
        x: $worldPos,
        y: $worldPos,
    }),
    // A powerup that was picked up: clients remove it by id. playerId names the
    // picker (so the client can play a pickup cue) and is left empty-padded when
    // there is no relevant player.
    powerupPickup: new Packet({
        id: $string(POWERUP_ID_LENGTH),
        playerId: $string(CONNECTION_ID_LENGTH),
    }),
})

export type PipPacketManager = typeof packetManager
export type PipPacketSerializerMap = ExtractSerializerMap<PipPacketManager>

export const encode = {
    sendChat: (message: string) => packetManager.serializers.sendChat.encode({
        message,
    }),
    receiveChat: (player: PipPlayer, message: string) => packetManager.serializers.receiveChat.encode({
        playerId: player.id,
        message,
    }),

    gameState: (game: PipPipGame) => packetManager.serializers.gameState.encode({
        mode: game.settings.mode,
        useTeams: game.settings.useTeams,
        maxDeaths: game.settings.maxDeaths,
        maxKills: game.settings.maxKills,
        matchMinutes: game.settings.matchMinutes,
        friendlyFire: game.settings.friendlyFire,
    }),
    gamePhase: (gameOrPhase: PipPipGame | PipPipGamePhase) => packetManager.serializers.gamePhase.encode({
        phase: gameOrPhase instanceof PipPipGame ? gameOrPhase.phase : gameOrPhase,
    }),
    gameCountdown: (game: PipPipGame) => packetManager.serializers.gameCountdown.encode({
        countdown: game.countdown,
    }),
    // Remaining match seconds, ceil'd so a partial final second still reads as
    // "1" (never 0 while time is left). Tick rate lives only on the server side
    // of this conversion, so the wire carries plain seconds.
    matchTimer: (game: PipPipGame) => packetManager.serializers.matchTimer.encode({
        seconds: Math.ceil(game.matchTimer / game.tps),
    }),
    // Name one winner (or empty when there is none) plus the winner count, so the
    // client can render "winner", "tie" or "Time!" without the full id list.
    gameResults: (game: PipPipGame) => packetManager.serializers.gameResults.encode({
        winnerId: game.winnerIds[0] ?? "",
        winnerCount: game.winnerIds.length,
    }),
    gameMap: (mapIndex: number) => packetManager.serializers.gameMap.encode({
        mapIndex,
    }),
    gameMode: (mode: PipPipGameMode, maxKills: number, matchMinutes: number) => packetManager.serializers.gameMode.encode({
        mode,
        maxKills,
        matchMinutes,
    }),

    addPlayer: (player: PipPlayer) => packetManager.serializers.addPlayer.encode({
        playerId: player.id,
    }),
    removePlayer: (player: PipPlayer) => packetManager.serializers.removePlayer.encode({
        playerId: player.id,
    }),
    despawnPlayer: (player: PipPlayer) => packetManager.serializers.despawnPlayer.encode({
        playerId: player.id,
    }),
    spawnPlayer: (player: PipPlayer) => packetManager.serializers.spawnPlayer.encode({
        playerId: player.id,
        x: player.ship.physics.position.x,
        y: player.ship.physics.position.y,
    }),

    setHost: (player: PipPlayer) => packetManager.serializers.setHost.encode({
        playerId: player.id,
    }),
    playerName: (player: PipPlayer) => packetManager.serializers.playerName.encode({
        playerId: player.id,
        name: player.name,
    }),
    playerIdle: (player: PipPlayer) => packetManager.serializers.playerIdle.encode({
        playerId: player.id,
        idle: player.idle,
    }),
    playerSpectate: (player: PipPlayer) => packetManager.serializers.playerSpectate.encode({
        playerId: player.id,
        spectating: player.spectator,
    }),
    playerPing: (player: PipPlayer) => packetManager.serializers.playerPing.encode({
        playerId: player.id,
        ping: player.ping,
    }),
    playerSetShip: (player: PipPlayer) => packetManager.serializers.playerSetShip.encode({
        playerId: player.id,
        shipIndex: player.shipIndex,
    }),
    playerPosition: (player: PipPlayer) => packetManager.serializers.playerPosition.encode({
        playerId: player.id,
        positionX: player.ship.physics.position.x,
        positionY: player.ship.physics.position.y,
        velocityX: player.ship.physics.velocity.x,
        velocityY: player.ship.physics.velocity.y,
    }),
    playerPositionSync: (player: PipPlayer) => packetManager.serializers.playerPositionSync.encode({
        playerId: player.id,
        positionX: player.ship.physics.position.x,
        positionY: player.ship.physics.position.y,
        velocityX: player.ship.physics.velocity.x,
        velocityY: player.ship.physics.velocity.y,
    }),
    playerInputs: (player: PipPlayer) => packetManager.serializers.playerInputs.encode({
        playerId: player.id,
        inputSeq: player.inputSeq,
        movementAngle: player.inputs.movementAngle,
        movementAmount: player.inputs.movementAmount,
        aimRotation: player.inputs.aimRotation,
        useWeapon: player.inputs.useWeapon,
        useTactical: player.inputs.useTactical,
        doReload: player.inputs.doReload,
    }),
    playerShipTimings: (player: PipPlayer) => packetManager.serializers.playerShipTimings.encode({
        playerId: player.id,
        weaponReload: player.ship.timings.weaponReload,
        weaponRate: player.ship.timings.weaponRate,
        tacticalReload: player.ship.timings.tacticalReload,
        tacticalRate: player.ship.timings.tacticalRate,
        healthRegenerationRest: player.ship.timings.healthRegenerationRest,
        healthRegenerationHeal: player.ship.timings.healthRegenerationHeal,
        invincibility: player.ship.timings.invincibility,
        haste: player.ship.timings.haste,
        shield: player.ship.timings.shield,
        invisibility: player.ship.timings.invisibility,
    }),
    playerShipCapacities: (player: PipPlayer) => packetManager.serializers.playerShipCapacities.encode({
        playerId: player.id,
        weapon: player.ship.capacities.weapon,
        tactical: player.ship.capacities.tactical,
        health: player.ship.capacities.health,
    }),
    playerTimings: (player: PipPlayer) => packetManager.serializers.playerTimings.encode({
        playerId: player.id,
        spawnTimeout: player.timings.spawnTimeout,
    }),
    playerScores: (player: PipPlayer) => packetManager.serializers.playerScores.encode({
        playerId: player.id,
        kills: player.score.kills,
        assists: player.score.assists,
        deaths: player.score.deaths,
        damage: player.score.damage,
    }),

    playerDamage: (dealer: PipPlayer, target: PipPlayer, damage: number) => packetManager.serializers.playerDamage.encode({
        dealerId: dealer.id,
        targetId: target.id,
        damage,
    }),

    playerKill: (killer: PipPlayer, killed: PipPlayer) => packetManager.serializers.playerKill.encode({
        killerId: killer.id,
        killedId: killed.id,
    }),
    
    playerShootBullet: (player: PipPlayer, bullet: Bullet) => packetManager.serializers.playerShootBullet.encode({
        playerId: player.id,
        positionX: bullet.physics.position.x,
        positionY: bullet.physics.position.y,
        velocityX: bullet.physics.velocity.x,
        velocityY: bullet.physics.velocity.y,
        radius: bullet.physics.radius,
        // Bullet type wire mapping: 0 = primary, 1 = tactical, 2 = grenade.
        // The client reverses this same mapping in processPackets (client.ts).
        bulletType: bullet.type === "grenade" ? 2 : bullet.type === "tactical" ? 1 : 0,
        explosionRadius: bullet.explosionRadius,
    }),

    powerupSpawn: (powerup: Powerup) => packetManager.serializers.powerupSpawn.encode({
        id: powerup.id,
        type: POWERUP_TYPE_TO_CODE[powerup.type],
        x: powerup.position.x,
        y: powerup.position.y,
    }),
    powerupPickup: (powerup: Powerup, player?: PipPlayer) => packetManager.serializers.powerupPickup.encode({
        id: powerup.id,
        playerId: player?.id ?? "",
    }),

    serverTickHeader: (game: PipPipGame) => packetManager.serializers.serverTickHeader.encode({
        tick: game.tickNumber,
    }),
    ownPlayerState: (player: PipPlayer) => packetManager.serializers.ownPlayerState.encode({
        positionX: player.ship.physics.position.x,
        positionY: player.ship.physics.position.y,
        velocityX: player.ship.physics.velocity.x,
        velocityY: player.ship.physics.velocity.y,
        lastInputSeq: player.lastProcessedInputSeq,
    }),
}