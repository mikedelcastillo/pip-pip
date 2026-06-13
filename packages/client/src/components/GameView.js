import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
import { PipPipGamePhase } from "@pip-pip/game/src/logic";
import { GAME_CONTEXT } from "../game";
import { useGameStore } from "../game/store";
import GameOverlaySetup from "./GameOverlaySetup";
import GameOverlayCountdown from "./GameOverlayCountdown";
import GameOverlayMatch from "./GameOverlayMatch";
export default function GameView() {
    const containerRef = useRef(null);
    const phase = useGameStore((s) => s.phase);
    useEffect(() => {
        if (!containerRef.current)
            return;
        GAME_CONTEXT.mountGameView(containerRef.current);
        return () => {
            GAME_CONTEXT.unmountGameView();
            GAME_CONTEXT.client.disconnect();
        };
    }, []);
    return _jsxs(_Fragment, { children: [phase === PipPipGamePhase.SETUP && _jsx(GameOverlaySetup, {}), phase === PipPipGamePhase.COUNTDOWN && _jsx(GameOverlayCountdown, {}), phase === PipPipGamePhase.MATCH && _jsx(GameOverlayMatch, {}), _jsx("div", { id: "game-container", ref: containerRef })] });
}
//# sourceMappingURL=GameView.js.map