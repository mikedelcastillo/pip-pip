import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useGameStore } from "../game/store";
import GameChat from "./GameChat";
import GamePlayerList from "./GamePlayerList";
import styles from "./GameOverlayMatch.module.sass";
export default function GameOverlayMatch() {
    const showPlayerList = useGameStore((s) => s.showPlayerList);
    const stats = useGameStore((s) => s.clientPlayerStats);
    return (_jsxs("div", { className: "game-overlay", children: [showPlayerList && _jsx(GamePlayerList, {}), _jsx("pre", { children: JSON.stringify(stats, null, 2) }), _jsx("div", { className: styles.gameChat, children: _jsx(GameChat, {}) })] }));
}
//# sourceMappingURL=GameOverlayMatch.js.map