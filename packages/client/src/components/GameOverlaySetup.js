import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState, useEffect } from "react";
import { GAME_CONTEXT } from "../game";
import { useGameStore } from "../game/store";
import GameButton from "./GameButton";
import GamePlayerList from "./GamePlayerList";
import GameChat from "./GameChat";
import styles from "./GameOverlaySetup.module.sass";
export default function GameOverlaySetup() {
    const isHost = useGameStore((s) => s.isHost);
    const playerCount = useGameStore((s) => s.players.length);
    const [activeIndex, setActiveIndex] = useState(0);
    const displayTabs = useMemo(() => {
        const tabs = [];
        if (isHost)
            tabs.push({ id: "host", name: "Host" });
        tabs.push({ id: "players", name: "Players", notifCount: playerCount.toString() });
        return tabs;
    }, [isHost, playerCount]);
    useEffect(() => {
        if (activeIndex >= displayTabs.length)
            setActiveIndex(0);
    }, [displayTabs.length, activeIndex]);
    const displayTab = displayTabs[activeIndex] ?? displayTabs[0];
    const startGame = () => GAME_CONTEXT.startGame();
    return (_jsx("div", { className: "game-overlay", children: _jsxs("div", { className: styles.overlayContainer, children: [_jsxs("div", { className: styles.setupContainer, children: [_jsx("div", { className: styles.setupTabsNav, children: displayTabs.map((tab, index) => (_jsxs("div", { className: `${styles.setupTabNav} ${activeIndex === index ? styles.active : ""}`, onClick: () => setActiveIndex(index), children: [_jsx("div", { className: styles.text, children: tab.name }), typeof tab.notifCount !== "undefined" && (_jsx("div", { className: styles.notif, children: tab.notifCount }))] }, tab.id))) }), displayTab?.id === "host" && (_jsx("div", { className: styles.setupTab, children: isHost && _jsx(GameButton, { onClick: startGame, children: "Start Game" }) })), displayTab?.id === "players" && (_jsx("div", { className: `${styles.setupTab} ${styles.players}`, children: _jsx(GamePlayerList, {}) }))] }), _jsx(GameChat, {})] }) }));
}
//# sourceMappingURL=GameOverlaySetup.js.map