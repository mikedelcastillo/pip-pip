import { PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import { CACHE_NAME_KEY, sanitize } from "@pip-pip/game/src/logic/utils"
import { PIP_MAPS } from "@pip-pip/game/src/maps"
import { PIP_SHIPS } from "@pip-pip/game/src/ships"
import { GameContext, GAME_CONTEXT } from "."

export type ChatCommand = {
    command: string,
    name: string,
    inputs: string[],
    description: string,
    callback: (message: string, inputs: string[]) => void | ChatMessage,
}


export type ChatMessagePartPlayer = {
    type: "player",
    player: PipPlayer,
}

export type ChatMessagePartError = {
    type: "error",
    code: string,
    text: string,
}

export type ChatMessageText = {
    style?: string,
    text: string,
}

export type ChatMessage = {
    text: ChatMessageText[],
}

export const CHAT_SPACE: ChatMessageText = { style: "space", text: "" }
export const CHAT_LINE_BREAK: ChatMessageText = { style: "break", text: "" }
  
export const GAME_COMMANDS: ChatCommand[] = []

export function createErrorChatMessage(code: string, text: string): ChatMessage{
    return {
        text: [{
            style: "bad",
            text: code
        }, {
            text: `: ${text}`,
        }],
    }
}

export const MESSAGE_ERROR_NOT_HOST = createErrorChatMessage("FORBIDDEN", "Only host can run this command.")
export const MESSAGE_ERROR_COMMAND_404 = createErrorChatMessage("UNKNOWN", "Command not found.")

GAME_COMMANDS.push({
    command: "start",
    name: "Start Game",
    inputs: [],
    description: "Starts the game",
    callback(){
        if(GAME_CONTEXT.store.isHost){
            GAME_CONTEXT.startGame()
        } else{
            return MESSAGE_ERROR_NOT_HOST
        }
    }
})

GAME_COMMANDS.push({
    command: "stop",
    name: "Stop Game",
    inputs: [],
    description: "Stops the game",
    callback(){
        if(GAME_CONTEXT.store.isHost){
            GAME_CONTEXT.sendGamePhase(PipPipGamePhase.SETUP)
        } else{
            return MESSAGE_ERROR_NOT_HOST
        }
    }
})

GAME_COMMANDS.push({
    command: "name",
    name: "Set name",
    inputs: ["name"],
    description: "Set name",
    callback(message){
        const safeName = sanitize(message.substring(5))
        if(safeName.length !== 0){
            GAME_CONTEXT.getClientPlayer()?.setName(safeName)
            localStorage.setItem(CACHE_NAME_KEY, safeName)
        }
    }
})

GAME_COMMANDS.push({
    command: "ship",
    name: "Set ship",
    inputs: ["name|index"],
    description: "Set ship",
    callback(message, [nameIndex]){
        let index = 0
        if(typeof nameIndex === "string" && isNaN(Number(nameIndex))){
            const name = nameIndex.trim().toLowerCase()
            index = PIP_SHIPS.findIndex(ship => ship.name === name || ship.id === name)
            if(index === -1){
                return createErrorChatMessage("UNKNOWN", `Cannot find ship "${name}".`)
            }
        } else if(typeof nameIndex === "number" || (typeof nameIndex === "string" && !isNaN(Number(nameIndex)))){
            // check bounds
            const seekIndex = Number(nameIndex)
            if(seekIndex <= 0 || seekIndex > PIP_SHIPS.length){
                return createErrorChatMessage("OUT_OF_BOUNDS", `Ship index ${seekIndex} not within range (1..=${PIP_SHIPS.length}).`)
            }
            index = seekIndex - 1
        }

        const ship = PIP_SHIPS[index]
        GAME_CONTEXT.getClientPlayer()?.setShip(index)
        return {
            text: [{
                style: "info",
                text: "Ship chosen:"
            }, CHAT_SPACE, {
                text: ship.name,
            }],
        }
    }
})

GAME_COMMANDS.push({
    command: "ships",
    name: "List ships",
    inputs: [],
    description: "List ships",
    callback(){
        for(const [index, ship] of PIP_SHIPS.entries()){
            GAME_CONTEXT.store.chatMessages.push({
                text: [{
                    style: "info",
                    text: (index + 1).toString(),
                }, CHAT_SPACE,{
                    style: "info",
                    text: ship.name,
                }, CHAT_SPACE, {
                    text: `${ship.description}`
                }],
            })
        }
    },
})

GAME_COMMANDS.push({
    command: "map",
    name: "Select a map",
    inputs: ["name|index"],
    description: "Select a map",
    callback(message, [nameIndex]){
        if(!GAME_CONTEXT.store.isHost) return MESSAGE_ERROR_NOT_HOST
        let index = -1
        const forcedNumber = Number(nameIndex)
        if(typeof forcedNumber === "number" && !Number.isNaN(forcedNumber)){
            index = forcedNumber
        } else if(typeof nameIndex === "string"){
            index = PIP_MAPS.findIndex(mapType => 
                mapType.id === nameIndex ||
                mapType.name === nameIndex)
        }

        if(index in PIP_MAPS){
            const mapType = PIP_MAPS[index]
            GAME_CONTEXT.setMap(index)
            return {
                text: [{
                    style: "info",
                    text: "Map chosen:"
                }, CHAT_SPACE, {
                    text: mapType.name,
                }],
            }
        } else{
            return createErrorChatMessage("UNKNOWN", "Map not found.")
        }
    }
})

GAME_COMMANDS.push({
    command: "clear",
    name: "Clear Chat",
    inputs: [],
    description: "Clears the whole chat only for you.",
    callback(){
        GAME_CONTEXT.store.chatMessages = []
    }
})

GAME_COMMANDS.push({
    command: "help",
    name: "Help",
    inputs: [],
    description: "Show all commands",
    callback(){
        for(const command of GAME_COMMANDS){
            const inputs = command.inputs.length === 0 ? "" : " " +
                command.inputs.map(input => `[${input}]`)
            GAME_CONTEXT.store.chatMessages.push({
                text: [{
                    style: "info",
                    text: `/${command.command}${inputs}`
                }, CHAT_SPACE, {
                    text: `${command.name}`
                }],
            })
        }

    }
})

export function processChat(gameContext: GameContext){
    let clearChat = false
    // player join
    for(const event of gameContext.gameEvents.filter("addPlayer")){
        const { player } = event.addPlayer
        gameContext.store.chatMessages.push({
            text: [{
                style: "player",
                text: player.name,
            }, CHAT_SPACE, {
                style: "good",
                text: "joined",
            }],
        })

        if(player.id === gameContext.client.connectionId){
            clearChat = true
        }
    }

    // player leave
    for(const event of gameContext.gameEvents.filter("removePlayer")){
        const { player } = event.removePlayer
        gameContext.store.chatMessages.push({
            text: [{
                style: "player",
                text: player.name,
            }, CHAT_SPACE, {
                style: "bad",
                text: "left",
            }],
        })
    }

    // player disconnected or disconnected
    for(const event of gameContext.gameEvents.filter("playerIdleChange")){
        const { player } = event.playerIdleChange
        if(player.idle){
            gameContext.store.chatMessages.push({
                text: [{
                    style: "player",
                    text: player.name,
                }, CHAT_SPACE, {
                    style: "bad",
                    text: "disconnected",
                }],
            })
        } else{
            gameContext.store.chatMessages.push({
                text: [{
                    style: "player",
                    text: player.name,
                }, CHAT_SPACE, {
                    style: "good",
                    text: "reconnected",
                }],
            })
        }
    }

    // player kill
    for(const event of gameContext.gameEvents.filter("playerKill")){
        const { killed, killer } = event.playerKill
        gameContext.store.chatMessages.push({
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
        })
    }

    // send phase change
    if(gameContext.gameEvents.filter("phaseChange").length > 0){
        if(gameContext.game.phase === PipPipGamePhase.SETUP){
            gameContext.store.chatMessages.push({
                text: [{
                    style: "good",
                    text: "Game is now in lobby mode.",
                }],
            })
        }
        if(gameContext.game.phase === PipPipGamePhase.COUNTDOWN){
            gameContext.store.chatMessages.push({
                text: [{
                    style: "good",
                    text: "Get ready...",
                }],
            })
        }
        if(gameContext.game.phase === PipPipGamePhase.MATCH){
            gameContext.store.chatMessages.push({
                text: [{
                    style: "good",
                    text: "The match has started.",
                }],
            })
        }
    }

    // send countdown
    // if(gameContext.game.phase === PipPipGamePhase.COUNTDOWN){
    //     if(gameContext.game.countdown % gameContext.game.tps === 0){
    //         const seconds = gameContext.game.countdown / gameContext.game.tps
    //         gameContext.store.chatMessages.push({
    //             text: [{
    //                 style: "info",
    //                 text: `Match begins in ${seconds}...`,
    //             }],
    //         })
    //     }
    // }

    if(clearChat){
        gameContext.store.chatMessages = []
    }
}