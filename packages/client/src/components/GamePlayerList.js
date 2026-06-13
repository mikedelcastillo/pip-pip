import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from "react";
import { useGameStore } from "../game/store";
import styles from "./GamePlayerList.module.sass";
function getPlayerListPriority(player) {
    let score = 0;
    if (player.isClient)
        score = 10000;
    if (player.isHost)
        score = 1000;
    score += player.score.kills;
    if (player.idle)
        score -= 100;
    return score;
}
function getRowClass(player) {
    const classes = [styles.rowPlayer];
    if (player.isHost)
        classes.push(styles.host);
    if (player.isClient)
        classes.push(styles.client);
    if (player.idle)
        classes.push(styles.idle);
    return classes.join(" ");
}
function getRowTags(player) {
    const tags = [];
    if (player.isClient)
        tags.push("You");
    if (player.isHost)
        tags.push("Host");
    return tags;
}
export default function GamePlayerList() {
    const playersRaw = useGameStore((s) => s.players);
    const players = useMemo(() => [...playersRaw].sort((a, b) => getPlayerListPriority(b) - getPlayerListPriority(a)), [playersRaw]);
    return (_jsx("div", { className: styles.playerList, children: _jsx("table", { children: _jsxs("tbody", { children: [_jsxs("tr", { className: styles.rowHeader, children: [_jsx("th", { className: styles.ping, children: "Ping" }), _jsx("th", { className: styles.name, children: "Name" }), _jsx("th", { className: styles.ship, children: "Ship" }), _jsx("th", { className: styles.damage, children: "Damage" }), _jsx("th", { className: styles.kills, children: "Kills" }), _jsx("th", { className: styles.deaths, children: "Deaths" }), _jsx("th", { className: styles.wins, children: "Wins" })] }), players.map((player) => (_jsxs("tr", { className: getRowClass(player), children: [_jsx("td", { className: styles.ping, children: player.idle ? "DC" : `${player.ping}ms` }), _jsxs("td", { className: styles.name, children: [_jsx("span", { className: styles.text, children: player.name }), getRowTags(player).map((tag) => (_jsx("span", { className: `${styles.tag} ${styles[tag.toLowerCase()] ?? ""}`, children: tag }, tag)))] }), _jsx("td", { className: `${styles.ship} ${styles[player.shipType.id] ?? ""}`, children: player.shipType.name }), _jsx("th", { className: styles.damage, children: player.score.damage }), _jsx("th", { className: styles.kills, children: player.score.kills }), _jsx("th", { className: styles.deaths, children: player.score.deaths }), _jsx("th", { className: styles.wins, children: 0 })] }, player.id)))] }) }) }));
}
//# sourceMappingURL=GamePlayerList.js.map