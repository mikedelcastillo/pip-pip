import { useMemo } from "react"
import { useGameStore } from "../game/store"
import type { GameStorePlayer } from "../game/store"
import { shipAssets } from "../game/assets"
import styles from "./GamePlayerList.module.sass"

const PING_GOOD_MS = 80
const PING_OKAY_MS = 160

// Scoreboard ordering: most kills first, break ties by damage dealt,
// then fewest deaths. Idle (disconnected) players always sink to the bottom.
function comparePlayers(a: GameStorePlayer, b: GameStorePlayer): number {
    if (a.idle !== b.idle) return a.idle ? 1 : -1
    if (b.score.kills !== a.score.kills) return b.score.kills - a.score.kills
    if (b.score.damage !== a.score.damage) return b.score.damage - a.score.damage
    return a.score.deaths - b.score.deaths
}

function getShipImage(player: GameStorePlayer): string | undefined {
    return (shipAssets as Record<string, string>)[player.shipType.texture]
}

function getPingClass(ping: number): string {
    if (ping <= PING_GOOD_MS) return styles.pingGood
    if (ping <= PING_OKAY_MS) return styles.pingOkay
    return styles.pingBad
}

function getKD(score: GameStorePlayer["score"]): string {
    if (score.deaths === 0) return score.kills.toFixed(1)
    return (score.kills / score.deaths).toFixed(1)
}

function getRowClass(player: GameStorePlayer): string {
    const classes = [styles.rowPlayer]
    if (player.isClient) classes.push(styles.client)
    if (player.idle) classes.push(styles.idle)
    return classes.join(" ")
}

export default function GamePlayerList() {
    const playersRaw = useGameStore((s) => s.players)
    const players = useMemo(
        () => [...playersRaw].sort(comparePlayers),
        [playersRaw],
    )

    return (
        <div className={styles.playerList}>
            <table>
                <thead>
                    <tr className={styles.rowHeader}>
                        <th className={styles.ship}></th>
                        <th className={styles.name}>Name</th>
                        <th className={styles.ping}>Ping</th>
                        <th className={styles.kills}>K</th>
                        <th className={styles.deaths}>D</th>
                        <th className={styles.kd}>K/D</th>
                        <th className={styles.damage}>DMG</th>
                    </tr>
                </thead>
                <tbody>
                    {players.map((player) => (
                        <tr key={player.id} className={getRowClass(player)}>
                            <td className={styles.ship}>
                                <img
                                    className={styles.shipIcon}
                                    src={getShipImage(player)}
                                    alt={player.shipType.name}
                                    title={player.shipType.name}
                                />
                            </td>
                            <td className={styles.name}>
                                <span className={styles.text}>{player.name}</span>
                                {player.isClient && (
                                    <span className={`${styles.tag} ${styles.you}`}>You</span>
                                )}
                                {player.isHost && (
                                    <span className={`${styles.tag} ${styles.host}`}>Host</span>
                                )}
                            </td>
                            <td className={`${styles.ping} ${player.idle ? "" : getPingClass(player.ping)}`}>
                                {player.idle ? "DC" : `${player.ping}ms`}
                            </td>
                            <td className={styles.kills}>{player.score.kills}</td>
                            <td className={styles.deaths}>{player.score.deaths}</td>
                            <td className={styles.kd}>{getKD(player.score)}</td>
                            <td className={styles.damage}>{Math.round(player.score.damage)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
