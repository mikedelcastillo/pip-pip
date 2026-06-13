import { $bool, $float16, $float32, $quant16, $string, $uint16, $uint32, $uint8, $varstring } from "@pip-pip/core/src/networking/packets/serializer"
import { PacketManager, ExtractSerializerMap } from "@pip-pip/core/src/networking/packets/manager"
import { Packet } from "@pip-pip/core/src/networking/packets/packet"

import { PipPlayer } from "../logic/player"
import { PipPipGame, PipPipGamePhase } from "../logic"
import { Bullet } from "../logic/bullet"
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
        bulletType: $uint8,
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
        kills: $uint8,
        assists: $uint8,
        deaths: $uint8,
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
        friendlyFire: $bool,
    }),
    gamePhase: new Packet({
        phase: $uint8,
    }),
    gameCountdown: new Packet({
        countdown: $uint8,
    }),
    gameMap: new Packet({
        mapIndex: $uint8,
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
        friendlyFire: game.settings.friendlyFire,
    }),
    gamePhase: (gameOrPhase: PipPipGame | PipPipGamePhase) => packetManager.serializers.gamePhase.encode({
        phase: gameOrPhase instanceof PipPipGame ? gameOrPhase.phase : gameOrPhase,
    }),
    gameCountdown: (game: PipPipGame) => packetManager.serializers.gameCountdown.encode({
        countdown: game.countdown,
    }),
    gameMap: (mapIndex: number) => packetManager.serializers.gameMap.encode({
        mapIndex,
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
        bulletType: bullet.type === "tactical" ? 1 : 0,
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