import type { NavigateFunction } from "react-router-dom"
import { useGameStore } from "./store"
import { useUiStore } from "../store/ui"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { KeyboardListener } from "@pip-pip/core/src/client/keyboard"
import { MouseListener } from "@pip-pip/core/src/client/mouse"
import { PipPipRenderer } from "./renderer"
import { EventCollector, EventMapOf } from "@pip-pip/core/src/common/events"
import { Client } from "@pip-pip/core/src/networking/client"

import { encode, packetManager, PipPacketSerializerMap } from "@pip-pip/game/src/networking/packets"
import { Ticker } from "@pip-pip/core/src/common/ticker"
import { processPackets, sendPackets } from "./client"
import { processInputs } from "./ui"
import { processChat } from "./chat"
import { CACHE_NAME_KEY } from "@pip-pip/game/src/logic/utils"

export class GameContext {
    game!: PipPipGame
    renderer!: PipPipRenderer
    gameEvents!: EventCollector<EventMapOf<PipPipGame["events"]>>

    renderTick!: Ticker
    updateTick!: Ticker

    client!: Client<PipPacketSerializerMap>
    clientEvents!: EventCollector<EventMapOf<Client<PipPacketSerializerMap>["events"]>>

    keyboard!: KeyboardListener
    mouse!: MouseListener

    container!: HTMLDivElement

    initialized = false

    // The store hook itself — call .getState() / .setState() from non-React contexts.
    store = useGameStore

    initialize() {
        this.initializeClient()
    }

    initializeClient() {
        this.client?.disconnect()
        const loc = window.location
        const useSecure = loc.protocol === "https:"
        const port = import.meta.env.DEV ? 8443 : (loc.port ? Number(loc.port) : undefined)
        this.client = new Client(packetManager, {
            host: loc.hostname,
            port,
            https: useSecure,
            wss: useSecure,
        })

        this.clientEvents?.destroy()
        this.clientEvents = new EventCollector(this.client.events)
    }

    mountGameView(container: HTMLDivElement) {
        this.unmountGameView()
        this.game = new PipPipGame()
        if (typeof this.client.connectionId === "string") {
            this.game.clientPlayerId = this.client.connectionId
        }

        // this.renderer?.destroy()
        this.renderer = new PipPipRenderer(this.game)
        this.gameEvents = new EventCollector(this.game.events)

        this.renderTick = new Ticker(60, true, "Render")
        this.updateTick = new Ticker(this.game.tps, false, "Update")

        this.keyboard = new KeyboardListener()
        this.mouse = new MouseListener()
        this.keyboard.setTarget(document.body)
        this.mouse.setTarget(document.body)

        this.renderer.mount(container)

        this.renderTick.on("tick", ({ deltaMs }) => {
            this.renderer.render(this, deltaMs)
        })

        let setNameFirstTime = false

        this.updateTick.on("tick", () => {
            // set name the first time
            if (setNameFirstTime === false) {
                const name = localStorage.getItem(CACHE_NAME_KEY)
                if (typeof name === "string") {
                    const player = this.getClientPlayer()
                    if (typeof player === "undefined") {
                        setNameFirstTime = false
                    } else {
                        player.setName(name)
                        setNameFirstTime = true
                    }
                } else {
                    setNameFirstTime = true
                }
            }

            // Apply messages
            processPackets(this)
            processChat(this)

            // Apply inputs
            processInputs(this)

            // Update local simulation
            this.game.update()

            // Send packets
            sendPackets(this)

            // Send updates
            this.gameEvents.flush()
            this.clientEvents.flush()

            // Update UI
            this.store.getState().sync()

            // Update document title
            const updatePerf = this.updateTick.getPerformance()
            const renderPerf = this.renderTick.getPerformance()
            const title = [
                updatePerf.averageDeltaTime.toFixed(2),
                renderPerf.averageDeltaTime.toFixed(2),
            ]
            window.document.title = title.join(" ")
        })

        this.renderTick.startTick()
        this.updateTick.startTick()
    }

    unmountGameView() {
        this.game?.destroy()
        this.gameEvents?.destroy()
        this.renderTick?.destroy()
        this.updateTick?.destroy()
    }

    destory() {
        // this.renderer?.destroy()
        this.client?.disconnect()
        this.clientEvents?.destroy()
    }

    reset() {
        this.initialized = true
    }

    getClientPlayer() {
        if (typeof this.client.connectionId !== "undefined") {
            if (this.client.connectionId in this.game.players) {
                return this.game.players[this.client.connectionId]
            }
        }
    }

    sendCode(code: number[]) {
        const buffer = new Uint8Array(code).buffer
        this.client.send(buffer)
    }

    sendGamePhase(phase: PipPipGamePhase) {
        const code = encode.gamePhase(phase)
        this.sendCode(code)
    }

    startGame() {
        this.sendGamePhase(PipPipGamePhase.MATCH)
    }

    setMap(index: number) {
        const code = encode.gameMap(index)
        this.sendCode(code)
    }
}

export const GAME_CONTEXT = new GameContext()

export const getClientPlayer = (game: PipPipGame) => {
    if (typeof GAME_CONTEXT.client.connectionId !== "undefined") {
        if (GAME_CONTEXT.client.connectionId in game.players) {
            return game.players[GAME_CONTEXT.client.connectionId]
        }
    }
}

export async function hostGame(navigate: NavigateFunction) {
    const setLoading = useUiStore.getState().setLoading
    setLoading(true, "Loading...")
    try {
        setLoading(true, "Requesting connection...")
        await GAME_CONTEXT.client.requestConnectionIfNeeded()
        setLoading(true, "Creating lobby...")
        const lobby = await GAME_CONTEXT.client.createLobby("default")
        navigate(`/${lobby.lobbyId}`)
    } catch (e) {
        console.warn(e)
        alert("Could not host a game!")
    }
    setLoading(false, "")
}
