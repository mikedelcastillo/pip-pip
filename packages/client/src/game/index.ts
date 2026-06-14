import type { NavigateFunction } from "react-router-dom"
import { useGameStore } from "./store"
import { useUiStore } from "../store/ui"
import { showAlert } from "../store/alert"
import { PipPipGame, PipPipGamePhase, PipPipGameMode, BotDifficultyChoice } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import { KeyboardListener } from "@pip-pip/core/src/client/keyboard"
import { MouseListener } from "@pip-pip/core/src/client/mouse"
import { PipPipRenderer } from "./renderer"
import { EventCollector, EventMapOf } from "@pip-pip/core/src/common/events"
import { Client } from "@pip-pip/core/src/networking/client"

import {
    encode,
    packetManager,
    PipPacketSerializerMap,
    HOST_BOTS_ACTION_ADD,
    HOST_BOTS_ACTION_REMOVE,
    HOST_BOTS_ACTION_CLEAR,
    HOST_BOTS_ACTION_FILL,
    HOST_BOTS_DIFFICULTY_MIXED,
} from "@pip-pip/game/src/networking/packets"
import { Ticker } from "@pip-pip/core/src/common/ticker"
import { processPackets, sendPackets } from "./client"
import { processInputs } from "./ui"
import { processChat } from "./chat"
import { CACHE_NAME_KEY, sanitize } from "@pip-pip/game/src/logic/utils"
import { AudioManager } from "./audio"
import { nextSpectateTargetId, resolveSpectateTarget } from "./spectate"

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

    // When the local player is spectating, the renderer follows this player id
    // (the chosen spectate target). Empty string means "no target chosen yet";
    // the renderer falls back to the first spawned non-spectator player.
    spectateTargetId = ""

    // Free-roam camera: while spectating, pressing a move key (WASD) detaches the
    // camera from the spectated player so it can be panned freely. `spectateFreeRoam`
    // flips true on the first pan and back to false when the player re-locks onto a
    // target by cycling (space / left / right). `spectateCamera` holds the free
    // camera's world position; it is seeded from the renderer's current camera the
    // moment free-roam begins so the pan starts exactly where the view already is.
    spectateFreeRoam = false
    spectateCamera = { x: 0, y: 0 }

    audio = new AudioManager()
    // The document-level audio-resume handler. Stored so unmountGameView can
    // remove the exact same reference it registered (a fresh arrow each mount
    // would otherwise leak a click+keydown listener per navigation).
    private audioResumeHandler?: () => void

    // React handler for "the host closed this lobby". Set by GameView via
    // onLobbyClosed and fired by notifyLobbyClosed (called from client.ts when the
    // lobbyClosed packet arrives). Mirrors onDisconnect: the deep client loop only
    // flips a flag in React, which then navigates home - it never hard-redirects
    // from inside the update tick, so the normal GameView teardown still runs.
    private lobbyClosedHandler?: () => void

    // Consecutive update ticks the local player has been stranded on the respawn
    // screen (see checkStuckRespawn). Reset whenever the player is fine.
    private stuckRespawnTicks = 0

    initialized = false

    // The store hook itself - call .getState() / .setState() from non-React contexts.
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

        // Apply the persisted opt-in CRT graphics setting to the freshly-created
        // renderer (the ui store seeds it from localStorage). Default is OFF.
        this.renderer.setCrtEnabled(useUiStore.getState().crtEnabled)

        // Procedural SFX driven by game events. The AudioManager stays silent
        // until its context is resumed by a user gesture.
        this.audio.init()

        // Browsers require a user gesture before an AudioContext can produce
        // sound - resume it on the first click or keypress. Registered here (and
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

            // Recover from a stuck "Respawning" state (a server/client spectator
            // desync that otherwise strands the player on the respawn screen).
            this.checkStuckRespawn()

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
        // now removed correctly - see core keyboard/mouse).
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

    // Surface the core Client's "connection dropped" signal to React. The core
    // websocket emits `socketClose` only after a verified connection closes
    // (see packages/core/src/networking/client/websockets.ts), so this fires on
    // an unexpected mid-session drop. An intentional leave unsubscribes via the
    // returned cleanup BEFORE GameView's own teardown calls client.disconnect(),
    // so the deliberate close never reaches `handler`. Returns an unsubscribe fn.
    onDisconnect(handler: () => void): () => void {
        this.client.events.on("socketClose", handler)
        return () => this.client.events.off("socketClose", handler)
    }

    // Register React's reaction to the host closing this lobby. Returns an
    // unsubscribe so the GameView effect cleans up on unmount. Stored as a single
    // slot (only GameView listens); notifyLobbyClosed below fires it.
    onLobbyClosed(handler: () => void): () => void {
        this.lobbyClosedHandler = handler
        return () => {
            if (this.lobbyClosedHandler === handler) this.lobbyClosedHandler = undefined
        }
    }

    // Called from the client packet loop (client.ts) when a lobbyClosed packet
    // arrives. Surfaces the close to React so it can navigate home and raise the
    // notice; like onDisconnect, we do NOT tear anything down here - GameView's
    // own unmount handles the connection/renderer teardown when it leaves.
    notifyLobbyClosed() {
        this.lobbyClosedHandler?.()
    }

    // Re-establish the connection and rejoin the given lobby after a drop.
    // Mirrors the connect → joinLobby sequence used when first entering a game
    // (see views/Game.tsx). Throws if either step fails so the caller can keep
    // the disconnect modal up.
    async reconnect(lobbyId: string) {
        await this.client.connect()
        await this.client.joinLobby(lobbyId)
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

    // Host-only: ask the server to disband the lobby and send everyone home. The
    // server validates the host and ignores this from anyone else; it then
    // broadcasts lobbyClosed to every client (which navigates home + shows the
    // notice) and removes the lobby. Centralised here so the lobby UI just calls
    // this without knowing the wire format.
    closeLobby() {
        const code = encode.closeLobby()
        this.sendCode(code)
    }

    // Host-only: change the match mode + its target from inside the lobby (so
    // players never have to leave and re-host just to switch modes). The server
    // validates the host and ignores this outside SETUP; the new settings come
    // back to every client on the normal gameState broadcast, which the store
    // mirrors - so the UI here just drives off the store and stays authoritative.
    setGameMode(mode: PipPipGameMode, maxKills: number, matchMinutes: number) {
        const code = encode.gameMode(mode, maxKills, matchMinutes)
        this.sendCode(code)
    }

    // Host-only bot config. These mirror setGameMode: each just sends the hostBots
    // packet and lets the authoritative server validate the host and apply the
    // change; the resulting bots come back through the normal add/remove/name
    // broadcasts, which the store already mirrors (so the UI stays authoritative).
    // A BotDifficultyChoice ("mixed" or a concrete BotDifficulty) maps to its wire
    // value here so the rest of the UI can speak in game-logic terms.
    private encodeBotDifficulty(difficulty: BotDifficultyChoice): number {
        return difficulty === "mixed" ? HOST_BOTS_DIFFICULTY_MIXED : difficulty
    }

    addBots(count: number, difficulty: BotDifficultyChoice) {
        this.sendCode(encode.hostBots(HOST_BOTS_ACTION_ADD, count, this.encodeBotDifficulty(difficulty)))
    }

    removeBots(count: number) {
        // difficulty is irrelevant to a remove, so send "mixed" as a harmless filler.
        this.sendCode(encode.hostBots(HOST_BOTS_ACTION_REMOVE, count, HOST_BOTS_DIFFICULTY_MIXED))
    }

    clearBots() {
        this.sendCode(encode.hostBots(HOST_BOTS_ACTION_CLEAR, 0, HOST_BOTS_DIFFICULTY_MIXED))
    }

    fillBots(difficulty: BotDifficultyChoice) {
        this.sendCode(encode.hostBots(HOST_BOTS_ACTION_FILL, 0, this.encodeBotDifficulty(difficulty)))
    }

    // Set the local player's display name and remember it. Sanitized the same
    // way as the `/name` chat command (alphanumerics + underscore, <=16 chars).
    // setName emits playerDetailsChange, which sendPackets broadcasts, so other
    // players see it; persisting to localStorage means we never prompt again.
    setPlayerName(name: string) {
        const safeName = sanitize(name)
        if (safeName.length === 0) return
        this.getClientPlayer()?.setName(safeName)
        localStorage.setItem(CACHE_NAME_KEY, safeName)
    }

    // Apply a ship selection for the local player. Mirrors the `/ship` chat
    // command: setShip emits `playerSetShip`, which sendPackets picks up during
    // SETUP and broadcasts to the other players - so the choice is networked
    // automatically. Centralised here so the UI and chat share one path.
    setShip(index: number) {
        this.getClientPlayer()?.setShip(index)
    }

    // Toggle the local player's spectator state and tell the server. The local
    // setSpectator gives instant feedback (camera/HUD react at once); the
    // server is authoritative - it sets the flag, despawns the player if needed,
    // and re-broadcasts playerSpectate to everyone. Centralised so the UI toggle
    // and the /spectate chat command share one path.
    setSpectator(spectator: boolean) {
        const player = this.getClientPlayer()
        if (typeof player === "undefined") return
        player.setSpectator(spectator)
        // Deploying back into the game ends any free-roam pan, so the next time
        // the player spectates the camera starts locked onto a target again.
        if (spectator === false) this.spectateFreeRoam = false
        this.sendCode(encode.playerSpectate(player))
    }

    toggleSpectator() {
        const player = this.getClientPlayer()
        if (typeof player === "undefined") return
        this.setSpectator(!player.spectator)
    }

    // Toggle the local player's lobby "ready up" state and tell the server. The
    // local setReady gives instant feedback (the footer button reacts at once);
    // the server is authoritative - it sets the flag and re-broadcasts
    // playerReady to everyone so every lobby agrees on the ready tally. Ready is
    // purely social and never gates the host's start.
    setReady(ready: boolean) {
        const player = this.getClientPlayer()
        if (typeof player === "undefined") return
        player.setReady(ready)
        this.sendCode(encode.playerReady(player))
    }

    // Auto-recover from a stuck "Respawning" state (the infinite-respawn bug):
    // if the local player intends to PLAY (client-side NOT a spectator) but is
    // dead with no respawn timer for a sustained window, the server most likely
    // still has them flagged as a spectator - a desync (e.g. left over from the
    // mid-game-join / loadout flow across a match restart) that strands them on
    // the respawn screen forever. Re-assert "not a spectator" so the server
    // un-spectates and its respawn loop spawns them. This only fires while the
    // client is NOT spectating, so a deliberate spectator is never force-spawned.
    private checkStuckRespawn() {
        const player = this.getClientPlayer()
        const stuck =
            this.game.phase === PipPipGamePhase.MATCH &&
            typeof player !== "undefined" &&
            player.spectator === false &&
            player.spawned === false &&
            player.timings.spawnTimeout === 0
        if (stuck === false || typeof player === "undefined") {
            this.stuckRespawnTicks = 0
            return
        }
        this.stuckRespawnTicks += 1
        // ~1.5s at the 20Hz update tick - far longer than the single-tick gap a
        // normal respawn spends at spawnTimeout 0, so this never fires in normal play.
        if (this.stuckRespawnTicks >= 30) {
            this.stuckRespawnTicks = 0
            this.sendCode(encode.playerSpectate(player))
        }
    }

    // Cycle the camera's spectate target among spawned non-spectator players,
    // in id order. `dir` is +1 (next) or -1 (previous). No-op if nobody is
    // spawned to watch. Cycling always re-locks the camera onto a player, so it
    // also exits free-roam (the only way back from a free-panned camera).
    cycleSpectateTarget(dir: number) {
        this.spectateFreeRoam = false
        this.spectateTargetId = nextSpectateTargetId(
            Object.values(this.game.players),
            this.spectateTargetId,
            dir,
        )
    }

    // The player the spectate camera should follow: the chosen target if it is
    // still spawned & not spectating, otherwise the first spawned non-spectator.
    getSpectateTarget(): PipPlayer | undefined {
        const target = resolveSpectateTarget(Object.values(this.game.players), this.spectateTargetId)
        if (typeof target !== "undefined") this.spectateTargetId = target.id
        return target
    }

    // Begin free-roam at a given world position (the renderer seeds this with its
    // current camera position so the pan starts where the view already is). A
    // no-op if free-roam is already active, so the seed only happens once per
    // detach and an ongoing pan is never yanked back to the followed player.
    beginSpectateFreeRoam(x: number, y: number) {
        if (this.spectateFreeRoam === true) return
        this.spectateFreeRoam = true
        this.spectateCamera.x = x
        this.spectateCamera.y = y
    }

    // Pan the free-roam camera by a world-space delta. No-op unless free-roam is
    // active, so a stray call while locked onto a target cannot move the camera.
    panSpectateCamera(dx: number, dy: number) {
        if (this.spectateFreeRoam === false) return
        this.spectateCamera.x += dx
        this.spectateCamera.y += dy
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
        showAlert("Could not host a game!", "Could not host")
    }
    setLoading(false, "")
}
