import { forgivingEqual } from "@pip-pip/core/src/math";
import { Vector2 } from "@pip-pip/core/src/physics";
import { PipPipGamePhase } from "@pip-pip/game/src/logic";
import { CHAT_MAX_MESSAGE_LENGTH, PLAYER_POSITION_TOLERANCE } from "@pip-pip/game/src/logic/constants";
import { encode } from "@pip-pip/game/src/networking/packets";
import { getClientPlayer } from ".";
import { useGameStore } from "./store";
export const processPackets = (gameContext) => {
    const { game } = gameContext;
    const { addChatMessage } = useGameStore.getState();
    for (const events of gameContext.clientEvents.filter("packetMessage")) {
        const { packets } = events.packetMessage;
        // Add player
        for (const { playerId } of packets.addPlayer || []) {
            game.createPlayer(playerId);
        }
        // Remove player
        for (const { playerId } of packets.removePlayer || []) {
            game.players[playerId]?.remove();
        }
        // Set host
        for (const { playerId } of packets.setHost || []) {
            const player = game.players[playerId];
            if (typeof player !== "undefined")
                game.setHost(player);
        }
        // Set player name
        for (const { playerId, name } of packets.playerName || []) {
            const player = game.players[playerId];
            if (typeof player !== "undefined")
                player.setName(name);
        }
        // Set player idle
        for (const { playerId, idle } of packets.playerIdle || []) {
            game.players[playerId]?.setIdle(idle);
        }
        // Set player ping
        for (const { playerId, ping } of packets.playerPing || []) {
            const player = game.players[playerId];
            if (typeof player !== "undefined")
                player.ping = ping;
        }
        // shoot bullet
        for (const packet of packets.playerShootBullet || []) {
            const player = game.players[packet.playerId];
            if (typeof player !== "undefined") {
                game.bullets.new({
                    position: new Vector2(packet.positionX, packet.positionY),
                    velocity: new Vector2(packet.velocityX, packet.velocityY),
                    owner: player,
                    speed: player.ship.stats.bullet.velocity,
                    radius: player.ship.stats.bullet.radius,
                    rotation: 0,
                });
            }
        }
        // Set player ship
        for (const { playerId, shipIndex } of packets.playerSetShip || []) {
            game.players[playerId]?.setShip(shipIndex);
        }
        // Set game state
        for (const settings of packets.gameState || []) {
            game.setSettings(settings);
        }
        //  Set game phase
        for (const { phase } of packets.gamePhase || []) {
            game.setPhase(phase);
        }
        //  Set game countdown
        for (const { countdown } of packets.gameCountdown || []) {
            game.countdown = countdown;
        }
        //  Set game map
        for (const { mapIndex } of packets.gameMap || []) {
            game.setMap(mapIndex);
        }
        //  Set force player positions
        for (const pos of packets.playerPositionSync || []) {
            const player = game.players[pos.playerId];
            if (typeof player === "undefined")
                continue;
            if (pos.playerId === gameContext.client.connectionId) {
                player.ship.physics.position.x = pos.positionX;
                player.ship.physics.position.y = pos.positionY;
                player.ship.physics.velocity.x = pos.velocityX;
                player.ship.physics.velocity.y = pos.velocityY;
            }
        }
        //  Set player positions
        for (const pos of packets.playerPosition || []) {
            const player = game.players[pos.playerId];
            if (typeof player === "undefined")
                continue;
            let xOffset = 0;
            let yOffset = 0;
            if (pos.playerId === gameContext.client.connectionId) {
                // TODO: Improve server reconciliation
                const lookbackRaw = player.ping / game.deltaMs;
                const state = player.getLastTickState(lookbackRaw);
                const x = forgivingEqual((state.positionX + state.velocityX), (pos.positionX), PLAYER_POSITION_TOLERANCE);
                const y = forgivingEqual((state.positionY + state.velocityY), (pos.positionY), PLAYER_POSITION_TOLERANCE);
                if (x && y)
                    continue;
                xOffset = -state.velocityX;
                yOffset = -state.velocityY;
            }
            player.ship.physics.position.x = pos.positionX + xOffset;
            player.ship.physics.position.y = pos.positionY + yOffset;
            player.ship.physics.velocity.x = pos.velocityX;
            player.ship.physics.velocity.y = pos.velocityY;
        }
        // update player ship timings
        for (const values of packets.playerShipTimings || []) {
            const player = game.players[values.playerId];
            if (typeof player !== "undefined") {
                player.ship.timings.weaponReload = values.weaponReload;
                player.ship.timings.weaponRate = values.weaponRate;
                player.ship.timings.tacticalReload = values.tacticalReload;
                player.ship.timings.tacticalRate = values.tacticalRate;
                player.ship.timings.healthRegenerationRest = values.healthRegenerationRest;
                player.ship.timings.healthRegenerationHeal = values.healthRegenerationHeal;
                player.ship.timings.invincibility = values.invincibility;
            }
        }
        // update player ship capacities
        for (const values of packets.playerShipCapacities || []) {
            const player = game.players[values.playerId];
            if (typeof player !== "undefined") {
                player.ship.capacities.weapon = values.weapon;
                player.ship.capacities.tactical = values.tactical;
                player.ship.capacities.health = values.health;
            }
        }
        // update player timings
        for (const values of packets.playerTimings || []) {
            const player = game.players[values.playerId];
            if (typeof player !== "undefined") {
                player.timings.spawnTimeout = values.spawnTimeout;
            }
        }
        // update player scores
        for (const values of packets.playerScores || []) {
            const player = game.players[values.playerId];
            if (typeof player !== "undefined") {
                player.score.kills = values.kills;
                player.score.assists = values.assists;
                player.score.deaths = values.deaths;
                player.score.damage = values.damage;
            }
        }
        // show player kill
        for (const kill of packets.playerKill || []) {
            const killer = game.players[kill.killerId];
            const killed = game.players[kill.killedId];
            if (typeof killer !== "undefined" && typeof killed !== "undefined") {
                game.events.emit("playerKill", { killer, killed });
            }
        }
        // render player damage
        for (const damage of packets.playerDamage || []) {
            const dealer = game.players[damage.dealerId];
            const target = game.players[damage.targetId];
            if (typeof dealer !== "undefined" && typeof target !== "undefined") {
                game.events.emit("dealDamage", { dealer, target, damage: damage.damage });
            }
        }
        // set player inputs
        for (const inputs of packets.playerInputs || []) {
            if (inputs.playerId === gameContext.client.connectionId)
                continue;
            const player = game.players[inputs.playerId];
            if (typeof player === "undefined")
                continue;
            player.inputs.movementAngle = inputs.movementAngle;
            player.inputs.movementAmount = inputs.movementAmount;
            player.inputs.aimRotation = inputs.aimRotation;
        }
        // despawn player
        for (const { playerId } of packets.despawnPlayer || []) {
            const player = game.players[playerId];
            if (typeof player === "undefined")
                continue;
            player.setSpawned(false);
        }
        // spawn player
        for (const { playerId, x, y } of packets.spawnPlayer || []) {
            const player = game.players[playerId];
            if (typeof player === "undefined")
                continue;
            game.spawnPlayer(player, x, y);
        }
        // Receive chat messages
        for (const { playerId, message } of packets.receiveChat || []) {
            const player = game.players[playerId];
            if (typeof player !== "undefined") {
                const sanitizedMessage = message.trim().substring(0, CHAT_MAX_MESSAGE_LENGTH);
                if (sanitizedMessage.length > 0) {
                    addChatMessage({
                        text: [{
                                style: "player",
                                text: player.name,
                            }, {
                                text: `: ${sanitizedMessage}`,
                            }],
                    });
                }
            }
        }
        const ignorePacket = [
            "playerPositionSync",
            "playerPosition", "playerInputs",
            "gameCountdown",
            "ping", "playerPing"
        ];
        for (const key of Object.keys(packets)) {
            if (ignorePacket.includes(key))
                continue;
            for (const packet of packets[key] || []) {
                console.log(key, packet);
            }
        }
    }
};
export const sendPackets = (gameContext) => {
    const { game, gameEvents, client } = gameContext;
    const messages = [];
    const clientPlayer = getClientPlayer(game);
    if (game.phase === PipPipGamePhase.SETUP) {
        if (typeof clientPlayer !== "undefined") {
            if (gameEvents.filter("playerSetShip").length > 0) {
                messages.push(encode.playerSetShip(clientPlayer));
            }
        }
    }
    // send position
    if (game.phase === PipPipGamePhase.MATCH) {
        if (typeof clientPlayer !== "undefined") {
            messages.push(encode.playerPosition(clientPlayer));
            messages.push(encode.playerInputs(clientPlayer));
        }
    }
    // send chat messages
    const outgoing = useGameStore.getState().consumeOutgoingMessages();
    for (const text of outgoing) {
        messages.push(encode.sendChat(text));
    }
    // name change
    for (const event of gameEvents.filter("playerDetailsChange")) {
        const { player } = event.playerDetailsChange;
        if (player.id === client.connectionId) {
            messages.push(encode.playerName(player));
        }
    }
    if (messages.length) {
        let code = [];
        messages.forEach(mes => code = code.concat(mes));
        const buffer = new Uint8Array(code).buffer;
        gameContext.client.send(buffer);
    }
};
//# sourceMappingURL=client.js.map