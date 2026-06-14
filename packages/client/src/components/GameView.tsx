import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { PipPipGamePhase } from "@pip-pip/game/src/logic"
import { GAME_CONTEXT } from "../game"
import { useGameStore } from "../game/store"
import GameOverlaySetup from "./GameOverlaySetup"
import GameOverlayCountdown from "./GameOverlayCountdown"
import GameOverlayMatch from "./GameOverlayMatch"
import TouchControls from "./TouchControls"
import DebugOverlay from "./DebugOverlay"
import DisconnectModal from "./DisconnectModal"

export default function GameView() {
    const containerRef = useRef<HTMLDivElement>(null)
    const phase = useGameStore((s) => s.phase)
    const navigate = useNavigate()
    const { id } = useParams<{ id: string }>()

    const [disconnected, setDisconnected] = useState(false)
    const [reconnecting, setReconnecting] = useState(false)

    useEffect(() => {
        if (!containerRef.current) return
        GAME_CONTEXT.mountGameView(containerRef.current)
        return () => {
            GAME_CONTEXT.unmountGameView()
            GAME_CONTEXT.client.disconnect()
        }
    }, [])

    // Surface an UNEXPECTED websocket drop. The core Client emits `socketClose`
    // only after a verified connection closes. This effect is declared AFTER the
    // mount effect, so on an intentional leave React runs this cleanup (the
    // unsubscribe) BEFORE the mount cleanup's client.disconnect() — the
    // deliberate close therefore never flips `disconnected`.
    useEffect(() => {
        const unsubscribe = GAME_CONTEXT.onDisconnect(() => setDisconnected(true))
        return unsubscribe
    }, [])

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
        {/* Twin-stick touch overlay during live play. Self-hides on desktop
            (mouse/keyboard) so it never covers mouse-aim. */}
        {phase === PipPipGamePhase.MATCH && <TouchControls />}
        {/* Netcode/entity debug panel — hidden by default, toggled with the
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
    </>
}
