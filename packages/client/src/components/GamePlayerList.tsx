import { useMemo } from "react"
import { useGameStore } from "../game/store"
import type { GameStorePlayer } from "../game/store"
import styles from "./GamePlayerList.module.sass"

function getPlayerListPriority(player: GameStorePlayer) {
    let score = 0
    if (player.isClient) score = 10000
    if (player.isHost) score = 1000
    score += player.score.kills
    if (player.idle) score -= 100
    return score
}

function getRowClass(player: GameStorePlayer): string {
    const classes = [styles.rowPlayer]
    if (player.isHost) classes.push(styles.host)
    if (player.isClient) classes.push(styles.client)
    if (player.idle) classes.push(styles.idle)
    return classes.join(" ")
}

function getRowTags(player: GameStorePlayer): string[] {
    const tags: string[] = []
    if (player.isClient) tags.push("You")
    if (player.isHost) tags.push("Host")
    return tags
}

export default function GamePlayerList() {
    const playersRaw = useGameStore((s) => s.players)
    const players = useMemo(
        () => [...playersRaw].sort((a, b) => getPlayerListPriority(b) - getPlayerListPriority(a)),
        [playersRaw],
    )

    return (
        <div className={styles.playerList}>
            <table>
                <tbody>
                    <tr className={styles.rowHeader}>
                        <th className={styles.ping}>Ping</th>
                        <th className={styles.name}>Name</th>
                        <th className={styles.ship}>Ship</th>
                        <th className={styles.damage}>Damage</th>
                        <th className={styles.kills}>Kills</th>
                        <th className={styles.deaths}>Deaths</th>
                        <th className={styles.wins}>Wins</th>
                    </tr>
                    {players.map((player) => (
                        <tr key={player.id} className={getRowClass(player)}>
                            <td className={styles.ping}>{player.idle ? "DC" : `${player.ping}ms`}</td>
                            <td className={styles.name}>
                                <span className={styles.text}>{player.name}</span>
                                {getRowTags(player).map((tag) => (
                                    <span key={tag} className={`${styles.tag} ${styles[tag.toLowerCase()] ?? ""}`}>{tag}</span>
                                ))}
                            </td>
                            <td className={`${styles.ship} ${styles[player.shipType.id] ?? ""}`}>{player.shipType.name}</td>
                            <th className={styles.damage}>{player.score.damage}</th>
                            <th className={styles.kills}>{player.score.kills}</th>
                            <th className={styles.deaths}>{player.score.deaths}</th>
                            <th className={styles.wins}>{0}</th>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
