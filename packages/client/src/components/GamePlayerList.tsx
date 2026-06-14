import { useMemo } from "react"
import { PipPipGamePhase } from "@pip-pip/game/src/logic"
import { useGameStore, ticksToSeconds } from "../game/store"
import type { GameStorePlayer } from "../game/store"
import { shipAssets } from "../game/assets"
import { isTeamMode, teamColor } from "../game/teams"
import { GAME_CONTEXT } from "../game"
import styles from "./GamePlayerList.module.sass"

const PING_GOOD_MS = 80
const PING_OKAY_MS = 160

// A player counts as awaiting respawn when they are in play (not a spectator)
// yet currently dead (not spawned). Only meaningful during a live match - in
// setup/lobby nobody is spawned, so the caller gates this on the MATCH phase.
function isAwaitingRespawn(player: GameStorePlayer): boolean {
    return !player.spectator && !player.spawned
}

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
    const phase = useGameStore((s) => s.phase)
    const mode = useGameStore((s) => s.mode)
    // In a team mode, group the scoreboard by team first (team 0, then team 1,
    // then any unassigned), keeping the normal score ordering inside each team.
    const teamMode = isTeamMode(mode)
    const players = useMemo(
        () => [...playersRaw].sort((a, b) => {
            if (teamMode && a.team !== b.team) {
                // Sort real teams (0, 1) ahead of unassigned (-1).
                const aKey = a.team < 0 ? Number.MAX_SAFE_INTEGER : a.team
                const bKey = b.team < 0 ? Number.MAX_SAFE_INTEGER : b.team
                return aKey - bKey
            }
            return comparePlayers(a, b)
        }),
        [playersRaw, teamMode],
    )

    // The respawn indicator is only meaningful mid-match; in setup/lobby no one
    // is spawned, so we would otherwise tag every player.
    const inMatch = phase === PipPipGamePhase.MATCH
    // The "ready up" badge is only meaningful in the lobby (SETUP); during a live
    // match the ready flag is irrelevant, so it is shown only here.
    const inLobby = phase === PipPipGamePhase.SETUP

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
                                <span
                                    className={styles.text}
                                    style={teamMode && player.team >= 0 ? { color: teamColor(player.team) } : undefined}
                                >
                                    {player.name}
                                </span>
                                {player.isClient && (
                                    <span className={`${styles.tag} ${styles.you}`}>You</span>
                                )}
                                {player.isHost && (
                                    <span className={`${styles.tag} ${styles.host}`}>Host</span>
                                )}
                                {player.spectator && (
                                    <span className={styles.tag}>Spec</span>
                                )}
                                {inLobby && player.ready && !player.spectator && (
                                    <span className={`${styles.tag} ${styles.ready}`} title="Ready">&#10003;</span>
                                )}
                                {inMatch && isAwaitingRespawn(player) && (
                                    <span className={`${styles.tag} ${styles.respawning}`}>
                                        Respawning {ticksToSeconds(player.spawnTimeout, GAME_CONTEXT.game.tps)}s
                                    </span>
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
