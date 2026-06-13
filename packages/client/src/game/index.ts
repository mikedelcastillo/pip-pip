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
import { AudioManager } from "./audio"

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

    audio = new AudioManager()
    // The document-level audio-resume handler. Stored so unmountGameView can
    // remove the exact same reference it registered (a fresh arrow each mount
    // would otherwise leak a click+keydown listener per navigation).
    private audioResumeHandler?: () => void

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

        // Procedural SFX driven by game events. The AudioManager stays silent
        // until its context is resumed by a user gesture.
        this.audio.init()

        // Browsers require a user gesture before an AudioContext can produce
        // sound — resume it on the first click or keypress. Registered here (and
        // removed in unmountGameView) so the listener pair is symmetric across
        // mount/unmount cycles instead of accumulating one per navigation.
        if (typeof this.audioResumeHandler === "undefined") {
            const resume = () => this.audio.resume()
            this.audioResumeHandler = resume
            document.addEventListener("click", resume)
            document.addEventListener("keydown", resume)
        }

        const isLocalPlayer = (id: string) => id === this.game.clientPlayerId

        this.game.events.on("addBullet", ({ bullet }) => {
            this.audio.play(bullet.type === "tactical" ? "shootTactical" : "shoot", {
                pitchSeed: this.game.tickNumber,
                pitchSemitones: 0.5,
            })
        })
        this.game.events.on("dealDamage", ({ target }) => {
            // Non-fatal hits get the "hit" blip; fatal hits are handled by playerKill.
            if (target.ship.capacities.health > 0) {
                this.audio.play("hit", {
                    pitchSeed: this.game.tickNumber,
                    pitchSemitones: 1,
                })
            }
        })
        this.game.events.on("playerKill", () => {
            this.audio.play("explosion")
        })
        this.game.events.on("playerSpawned", ({ player }) => {
            // The local player's spawn earns the signature "pip" chirp.
            this.audio.play(isLocalPlayer(player.id) ? "pip" : "spawn")
        })
        this.game.events.on("playerReloadStart", ({ player }) => {
            if (isLocalPlayer(player.id)) this.audio.play("reloadStart")
        })
        this.game.events.on("playerReloadEnd", ({ player }) => {
            if (isLocalPlayer(player.id)) this.audio.play("reloadEnd")
        })
        this.game.events.on("phaseChange", () => {
            this.audio.play("phaseChange")
        })

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
        // Stop the loops first so nothing touches the renderer/game while we
        // tear them down.
        this.renderTick?.destroy()
        this.updateTick?.destroy()

        // Release the WebGL context, Pixi app, pooled graphics and game-event
        // subscriptions. Without this each remount leaks a WebGL context and the
        // browser blanks the canvas after a handful of navigations.
        this.renderer?.destroy()

        // Detach the document-bound input listeners (their bound handlers are
        // now removed correctly — see core keyboard/mouse).
        this.keyboard?.destroy()
        this.mouse?.destroy()

        // Tear down the game world and its event collector.
        this.game?.destroy()
        this.gameEvents?.destroy()

        // Audio: close the context and remove the document-level resume listeners.
        this.audio.dispose()
        if (typeof this.audioResumeHandler !== "undefined") {
            document.removeEventListener("click", this.audioResumeHandler)
            document.removeEventListener("keydown", this.audioResumeHandler)
            this.audioResumeHandler = undefined
        }
    }

    destroy() {
        this.unmountGameView()
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

    // Apply a ship selection for the local player. Mirrors the `/ship` chat
    // command: setShip emits `playerSetShip`, which sendPackets picks up during
    // SETUP and broadcasts to the other players — so the choice is networked
    // automatically. Centralised here so the UI and chat share one path.
    setShip(index: number) {
        this.getClientPlayer()?.setShip(index)
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
