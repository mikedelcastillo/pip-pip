import { PipPipGameMode } from "@pip-pip/game/src/logic"
import { useGameStore, matchLeader, fraction } from "../game/store"
import { teamColor, teamName, teamScore as sumTeamScore } from "../game/teams"
import styles from "./ObjectiveMeter.module.sass"

// Format a remaining-seconds count as M:SS for the KILL_FRENZY clock. Clamped at
// 0 so a spent timer never shows negative. Pure, so it is trivially testable.
export function formatMatchClock(totalSeconds: number): string {
    const safe = Math.max(0, Math.floor(totalSeconds))
    const minutes = Math.floor(safe / 60)
    const seconds = safe % 60
    return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

// Top-center objective HUD, the always-glanceable "what am I racing toward".
// Two faces, picked by mode, sharing the same slot + treatment:
//   DEATHMATCH .. the "king" (most kills) + a progress bar filling toward the
//                 maxKills target. Before anyone scores it sits in a neutral
//                 "First to N" state so we never crown a 0-kill leader.
//   KILL_FRENZY . the match countdown clock, large and prominent, with a small
//                 "Kill Frenzy" label so the objective reads at a glance.
// Display-only: the whole element is pointer-events:none (set in the stylesheet)
// so touches fall straight through to the floating sticks underneath on mobile.
export default function ObjectiveMeter() {
    const mode = useGameStore((s) => s.mode)
    const maxKills = useGameStore((s) => s.maxKills)
    const matchTimerSeconds = useGameStore((s) => s.matchTimerSeconds)
    const players = useGameStore((s) => s.players)

    if (mode === PipPipGameMode.TEAM_DEATHMATCH) {
        // Two team totals, summed from the per-player kills + teams already on the
        // store. Shown as a compact team-colored "Team 1  X  -  Y  Team 2" readout
        // with a center-split progress bar growing toward maxKills from each side.
        const score0 = sumTeamScore(players, 0)
        const score1 = sumTeamScore(players, 1)
        const progress0 = fraction(score0, maxKills) * 100
        const progress1 = fraction(score1, maxKills) * 100
        return (
            <div className={`${styles.meter} ${styles.teams}`}>
                <div className={styles.teamScores}>
                    <span className={styles.teamName} style={{ color: teamColor(0) }}>{teamName(0)}</span>
                    <span className={styles.teamScore} style={{ color: teamColor(0) }}>{score0}</span>
                    <span className={styles.teamSep}>-</span>
                    <span className={styles.teamScore} style={{ color: teamColor(1) }}>{score1}</span>
                    <span className={styles.teamName} style={{ color: teamColor(1) }}>{teamName(1)}</span>
                </div>
                <div className={styles.teamBars}>
                    <div className={styles.teamBarLeft}>
                        <div
                            className={styles.teamBarFill}
                            style={{ width: `${progress0}%`, backgroundColor: teamColor(0) }}
                        />
                    </div>
                    <div className={styles.teamBarRight}>
                        <div
                            className={styles.teamBarFill}
                            style={{ width: `${progress1}%`, backgroundColor: teamColor(1) }}
                        />
                    </div>
                </div>
            </div>
        )
    }

    if (mode === PipPipGameMode.KILL_FRENZY) {
        // The clock turns urgent (danger color + pulse) in the final 10 seconds.
        const urgent = matchTimerSeconds <= 10
        return (
            <div className={`${styles.meter} ${styles.frenzy}`}>
                <span className={styles.frenzyLabel}>Kill Frenzy</span>
                <span className={`${styles.clock} ${urgent ? styles.urgent : ""}`}>
                    {formatMatchClock(matchTimerSeconds)}
                </span>
            </div>
        )
    }

    // DEATHMATCH. With no kill cap there is no race to show, so render nothing.
    if (maxKills <= 0) return null

    const leader = matchLeader(players)
    // Progress is the leader's kills toward the cap; neutral (empty bar) until
    // someone scores. fraction clamps to [0, 1] and guards the divide-by-zero.
    const progress = fraction(leader?.kills ?? 0, maxKills) * 100

    return (
        <div className={`${styles.meter} ${styles.deathmatch}`}>
            <div className={styles.kingRow}>
                {leader === null ? (
                    // Nobody has scored yet: show the bare target, not a 0-kill king.
                    <span className={styles.target}>First to {maxKills}</span>
                ) : (
                    <>
                        <span className={styles.crown}>&#9819;</span>
                        <span className={styles.kingName}>{leader.name}</span>
                        <span className={styles.kingScore}>
                            {leader.kills}<span className={styles.scoreTarget}> / {maxKills}</span>
                        </span>
                    </>
                )}
            </div>
            {/* Skewed Apex-style progress bar filling toward the kill target. */}
            <div className={styles.bar}>
                <div className={styles.barFill} style={{ width: `${progress}%` }} />
            </div>
        </div>
    )
}
