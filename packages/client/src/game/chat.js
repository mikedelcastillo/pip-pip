import { PipPipGamePhase } from "@pip-pip/game/src/logic";
import { CACHE_NAME_KEY, sanitize } from "@pip-pip/game/src/logic/utils";
import { PIP_MAPS } from "@pip-pip/game/src/maps";
import { PIP_SHIPS } from "@pip-pip/game/src/ships";
import { GAME_CONTEXT } from ".";
import { useGameStore } from "./store";
export const CHAT_SPACE = { style: "space", text: "" };
export const CHAT_LINE_BREAK = { style: "break", text: "" };
export const GAME_COMMANDS = [];
export function createErrorChatMessage(code, text) {
    return {
        text: [{
                style: "bad",
                text: code,
            }, {
                text: `: ${text}`,
            }],
    };
}
export const MESSAGE_ERROR_NOT_HOST = createErrorChatMessage("FORBIDDEN", "Only host can run this command.");
export const MESSAGE_ERROR_COMMAND_404 = createErrorChatMessage("UNKNOWN", "Command not found.");
GAME_COMMANDS.push({
    command: "start",
    name: "Start Game",
    inputs: [],
    description: "Starts the game",
    callback() {
        if (useGameStore.getState().isHost) {
            GAME_CONTEXT.startGame();
        }
        else {
            return MESSAGE_ERROR_NOT_HOST;
        }
    },
});
GAME_COMMANDS.push({
    command: "stop",
    name: "Stop Game",
    inputs: [],
    description: "Stops the game",
    callback() {
        if (useGameStore.getState().isHost) {
            GAME_CONTEXT.sendGamePhase(PipPipGamePhase.SETUP);
        }
        else {
            return MESSAGE_ERROR_NOT_HOST;
        }
    },
});
GAME_COMMANDS.push({
    command: "name",
    name: "Set name",
    inputs: ["name"],
    description: "Set name",
    callback(message) {
        const safeName = sanitize(message.substring(5));
        if (safeName.length !== 0) {
            GAME_CONTEXT.getClientPlayer()?.setName(safeName);
            localStorage.setItem(CACHE_NAME_KEY, safeName);
        }
    },
});
GAME_COMMANDS.push({
    command: "ship",
    name: "Set ship",
    inputs: ["name|index"],
    description: "Set ship",
    callback(message, [nameIndex]) {
        let index = 0;
        if (typeof nameIndex === "string" && isNaN(Number(nameIndex))) {
            const name = nameIndex.trim().toLowerCase();
            index = PIP_SHIPS.findIndex(ship => ship.name === name || ship.id === name);
            if (index === -1) {
                return createErrorChatMessage("UNKNOWN", `Cannot find ship "${name}".`);
            }
        }
        else if (typeof nameIndex === "number" || (typeof nameIndex === "string" && !isNaN(Number(nameIndex)))) {
            const seekIndex = Number(nameIndex);
            if (seekIndex <= 0 || seekIndex > PIP_SHIPS.length) {
                return createErrorChatMessage("OUT_OF_BOUNDS", `Ship index ${seekIndex} not within range (1..=${PIP_SHIPS.length}).`);
            }
            index = seekIndex - 1;
        }
        const ship = PIP_SHIPS[index];
        GAME_CONTEXT.getClientPlayer()?.setShip(index);
        return {
            text: [{
                    style: "info",
                    text: "Ship chosen:",
                }, CHAT_SPACE, {
                    text: ship.name,
                }],
        };
    },
});
GAME_COMMANDS.push({
    command: "ships",
    name: "List ships",
    inputs: [],
    description: "List ships",
    callback() {
        const add = useGameStore.getState().addChatMessage;
        for (const [index, ship] of PIP_SHIPS.entries()) {
            add({
                text: [{
                        style: "info",
                        text: (index + 1).toString(),
                    }, CHAT_SPACE, {
                        style: "info",
                        text: ship.name,
                    }, CHAT_SPACE, {
                        text: `${ship.description}`,
                    }],
            });
        }
    },
});
GAME_COMMANDS.push({
    command: "map",
    name: "Select a map",
    inputs: ["name|index"],
    description: "Select a map",
    callback(message, [nameIndex]) {
        if (!useGameStore.getState().isHost)
            return MESSAGE_ERROR_NOT_HOST;
        let index = -1;
        const forcedNumber = Number(nameIndex);
        if (typeof forcedNumber === "number" && !Number.isNaN(forcedNumber)) {
            index = forcedNumber;
        }
        else if (typeof nameIndex === "string") {
            index = PIP_MAPS.findIndex(mapType => mapType.id === nameIndex ||
                mapType.name === nameIndex);
        }
        if (index in PIP_MAPS) {
            const mapType = PIP_MAPS[index];
            GAME_CONTEXT.setMap(index);
            return {
                text: [{
                        style: "info",
                        text: "Map chosen:",
                    }, CHAT_SPACE, {
                        text: mapType.name,
                    }],
            };
        }
        else {
            return createErrorChatMessage("UNKNOWN", "Map not found.");
        }
    },
});
GAME_COMMANDS.push({
    command: "clear",
    name: "Clear Chat",
    inputs: [],
    description: "Clears the whole chat only for you.",
    callback() {
        useGameStore.getState().clearChatMessages();
    },
});
GAME_COMMANDS.push({
    command: "help",
    name: "Help",
    inputs: [],
    description: "Show all commands",
    callback() {
        const add = useGameStore.getState().addChatMessage;
        for (const command of GAME_COMMANDS) {
            const inputs = command.inputs.length === 0 ? "" : " " +
                command.inputs.map(input => `[${input}]`);
            add({
                text: [{
                        style: "info",
                        text: `/${command.command}${inputs}`,
                    }, CHAT_SPACE, {
                        text: `${command.name}`,
                    }],
            });
        }
    },
});
export function processChat(gameContext) {
    const { addChatMessage, clearChatMessages } = useGameStore.getState();
    let clearChat = false;
    // player join
    for (const event of gameContext.gameEvents.filter("addPlayer")) {
        const { player } = event.addPlayer;
        addChatMessage({
            text: [{
                    style: "player",
                    text: player.name,
                }, CHAT_SPACE, {
                    style: "good",
                    text: "joined",
                }],
        });
        if (player.id === gameContext.client.connectionId) {
            clearChat = true;
        }
    }
    // player leave
    for (const event of gameContext.gameEvents.filter("removePlayer")) {
        const { player } = event.removePlayer;
        addChatMessage({
            text: [{
                    style: "player",
                    text: player.name,
                }, CHAT_SPACE, {
                    style: "bad",
                    text: "left",
                }],
        });
    }
    // player disconnected or reconnected
    for (const event of gameContext.gameEvents.filter("playerIdleChange")) {
        const { player } = event.playerIdleChange;
        if (player.idle) {
            addChatMessage({
                text: [{
                        style: "player",
                        text: player.name,
                    }, CHAT_SPACE, {
                        style: "bad",
                        text: "disconnected",
                    }],
            });
        }
        else {
            addChatMessage({
                text: [{
                        style: "player",
                        text: player.name,
                    }, CHAT_SPACE, {
                        style: "good",
                        text: "reconnected",
                    }],
            });
        }
    }
    // player kill
    for (const event of gameContext.gameEvents.filter("playerKill")) {
        const { killed, killer } = event.playerKill;
        addChatMessage({
            text: [{
                    style: "player",
                    text: killer.name,
                }, CHAT_SPACE, {
                    style: "bad",
                    text: "killed",
                }, CHAT_SPACE, {
                    style: "player",
                    text: killed.name,
                }],
        });
    }
    // send phase change
    if (gameContext.gameEvents.filter("phaseChange").length > 0) {
        if (gameContext.game.phase === PipPipGamePhase.SETUP) {
            addChatMessage({
                text: [{
                        style: "good",
                        text: "Game is now in lobby mode.",
                    }],
            });
        }
        if (gameContext.game.phase === PipPipGamePhase.COUNTDOWN) {
            addChatMessage({
                text: [{
                        style: "good",
                        text: "Get ready...",
                    }],
            });
        }
        if (gameContext.game.phase === PipPipGamePhase.MATCH) {
            addChatMessage({
                text: [{
                        style: "good",
                        text: "The match has started.",
                    }],
            });
        }
    }
    if (clearChat) {
        clearChatMessages();
    }
}
//# sourceMappingURL=chat.js.map