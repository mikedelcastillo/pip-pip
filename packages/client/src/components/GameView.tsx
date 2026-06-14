import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { PipPipGamePhase } from "@pip-pip/game/src/logic"
import { CACHE_NAME_KEY } from "@pip-pip/game/src/logic/utils"
import { GAME_CONTEXT } from "../game"
import { useGameStore } from "../game/store"
import { useUiStore } from "../store/ui"
import GameOverlaySetup from "./GameOverlaySetup"
import GameOverlayCountdown from "./GameOverlayCountdown"
import GameOverlayMatch from "./GameOverlayMatch"
import GameOverlayResults from "./GameOverlayResults"
import LoadoutOverlay from "./LoadoutOverlay"
import TouchControls from "./TouchControls"
import DebugOverlay from "./DebugOverlay"
import DisconnectModal from "./DisconnectModal"
import NameModal from "./NameModal"

// True when the player has no usable saved name yet, so we should prompt for one.
function needsNamePrompt(): boolean {
    const name = localStorage.getItem(CACHE_NAME_KEY)
    return typeof name !== "string" || name.trim().length === 0
}

export default function GameView() {
    const containerRef = useRef<HTMLDivElement>(null)
    const phase = useGameStore((s) => s.phase)
    const showLoadout = useUiStore((s) => s.showLoadout)
    const setShowLoadout = useUiStore((s) => s.setShowLoadout)
    const navigate = useNavigate()
    const { id } = useParams<{ id: string }>()

    const [disconnected, setDisconnected] = useState(false)
    const [reconnecting, setReconnecting] = useState(false)
    // Prompt for a name on entering a lobby/match if none is saved yet. Checked
    // once on mount; saving (or dismissing) hides it for this session.
    const [askName, setAskName] = useState(needsNamePrompt)

    // Track the previous phase across renders so we can tell a true mid-game
    // joiner apart from a lobby player. The client always starts in SETUP; a
    // normal lobby start goes SETUP -> COUNTDOWN -> MATCH, but a player who joins
    // a running match receives the server's MATCH phase directly (SETUP -> MATCH,
    // no COUNTDOWN). That direct jump is what flags them onto the loadout screen.
    const prevPhaseRef = useRef(phase)

    useEffect(() => {
        if (!containerRef.current) return
        // Fresh mount: clear any stale loadout flag so it never lingers from a
        // previous game into this one.
        setShowLoadout(false)
        prevPhaseRef.current = PipPipGamePhase.SETUP
        GAME_CONTEXT.mountGameView(containerRef.current)
        return () => {
            setShowLoadout(false)
            GAME_CONTEXT.unmountGameView()
            GAME_CONTEXT.client.disconnect()
        }
    }, [setShowLoadout])

    // Show the loadout screen for a real mid-game joiner: the client's phase
    // jumped straight from SETUP to MATCH (a lobby start always passes through
    // COUNTDOWN first, so it never triggers this). Also make sure the flag never
    // lingers once the player is no longer in MATCH (back to the lobby / results).
    useEffect(() => {
        const prev = prevPhaseRef.current
        if (phase === PipPipGamePhase.MATCH && prev === PipPipGamePhase.SETUP) {
            setShowLoadout(true)
        } else if (phase !== PipPipGamePhase.MATCH) {
            setShowLoadout(false)
        }
        prevPhaseRef.current = phase
    }, [phase, setShowLoadout])

    // Surface an UNEXPECTED websocket drop. The core Client emits `socketClose`
    // only after a verified connection closes. This effect is declared AFTER the
    // mount effect, so on an intentional leave React runs this cleanup (the
    // unsubscribe) BEFORE the mount cleanup's client.disconnect() - the
    // deliberate close therefore never flips `disconnected`.
    useEffect(() => {
        const unsubscribe = GAME_CONTEXT.onDisconnect(() => setDisconnected(true))
        return unsubscribe
    }, [])

    // The host closed the lobby: client.ts already raised the on-brand notice
    // (showAlert) when the lobbyClosed packet arrived; here we just navigate home.
    // Leaving via the router unmounts GameView, whose cleanup disconnects the
    // client and tears the renderer down - the same path as a normal Leave.
    useEffect(() => {
        const unsubscribe = GAME_CONTEXT.onLobbyClosed(() => navigate("/"))
        return unsubscribe
    }, [navigate])

    const goHome = useCallback(() => navigate("/"), [navigate])

    const reconnect = useCallback(async () => {
        if (!id || reconnecting) return
        setReconnecting(true)
        try {
            await GAME_CONTEXT.reconnect(id)
            setDisconnected(false)
        } catch (e) {
            console.warn(e)
        }
        setReconnecting(false)
    }, [id, reconnecting])

    return <>
        {phase === PipPipGamePhase.SETUP && <GameOverlaySetup />}
        {phase === PipPipGamePhase.COUNTDOWN && <GameOverlayCountdown />}
        {phase === PipPipGamePhase.MATCH && <GameOverlayMatch />}
        {phase === PipPipGamePhase.RESULTS && <GameOverlayResults />}
        {/* Mid-game loadout screen: a ship picker + Deploy / Spectate, shown over
            the live match for a fresh joiner or after "Change Loadout" on the
            respawn screen. Interactive, so it sits above the touch controls. */}
        {phase === PipPipGamePhase.MATCH && showLoadout && <LoadoutOverlay />}
        {/* Twin-stick touch overlay during live play. Self-hides on desktop
            (mouse/keyboard) so it never covers mouse-aim. */}
        {phase === PipPipGamePhase.MATCH && <TouchControls />}
        {/* Netcode/entity debug panel - hidden by default, toggled with the
            backquote (`) key. Always mounted so it is reachable in any phase. */}
        <DebugOverlay />
        <div id="game-container" ref={containerRef}></div>
        {/* Shown only on an unexpected drop after a successful join. */}
        {disconnected && (
            <DisconnectModal
                onHome={goHome}
                onReconnect={reconnect}
                reconnecting={reconnecting}
            />
        )}
        {/* First time in a lobby/match with no saved name: ask for one. */}
        {askName && <NameModal onClose={() => setAskName(false)} />}
    </>
}
