import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useGameStore } from "../game/store";
import GameChat from "./GameChat";
import styles from "./GameOverlayCountdown.module.sass";
export default function GameOverlayCountdown() {
    const countdownMs = useGameStore((s) => s.countdownMs);
    const time = (countdownMs / 1000).toFixed(2);
    return (_jsxs("div", { className: "game-overlay", children: [_jsx("div", { className: styles.blackout, children: _jsxs("div", { className: styles.center, children: [_jsx("div", { className: styles.text, children: "Game starts in" }), _jsx("div", { className: styles.time, children: time })] }) }), _jsx("div", { className: styles.gameChat, children: _jsx(GameChat, {}) })] }));
}
//# sourceMappingURL=GameOverlayCountdown.js.map