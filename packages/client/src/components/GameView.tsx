import { useEffect, useRef } from "react"
import { PipPipGamePhase } from "@pip-pip/game/src/logic"
import { GAME_CONTEXT } from "../game"
import { useGameStore } from "../game/store"
import GameOverlaySetup from "./GameOverlaySetup"
import GameOverlayCountdown from "./GameOverlayCountdown"
import GameOverlayMatch from "./GameOverlayMatch"
import TouchControls from "./TouchControls"

export default function GameView() {
    const containerRef = useRef<HTMLDivElement>(null)
    const phase = useGameStore((s) => s.phase)

    useEffect(() => {
        if (!containerRef.current) return
        GAME_CONTEXT.mountGameView(containerRef.current)
        return () => {
            GAME_CONTEXT.unmountGameView()
            GAME_CONTEXT.client.disconnect()
        }
    }, [])

    return <>
        {phase === PipPipGamePhase.SETUP && <GameOverlaySetup />}
        {phase === PipPipGamePhase.COUNTDOWN && <GameOverlayCountdown />}
        {phase === PipPipGamePhase.MATCH && <GameOverlayMatch />}
        {/* Twin-stick touch overlay during live play. Self-hides on desktop
            (mouse/keyboard) so it never covers mouse-aim. */}
        {phase === PipPipGamePhase.MATCH && <TouchControls />}
        <div id="game-container" ref={containerRef}></div>
    </>
}
