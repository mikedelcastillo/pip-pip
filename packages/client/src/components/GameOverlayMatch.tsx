import { useState } from "react"
import { useGameStore, fraction } from "../game/store"
import GameChat from "./GameChat"
import GamePlayerList from "./GamePlayerList"
import GameButton from "./GameButton"
import AudioVolumeToggle from "./AudioVolumeToggle"
import LeaveButton from "./LeaveButton"
import HostControls from "./HostControls"
import KillFeed from "./KillFeed"
import Minimap from "./Minimap"
import GameBuffBars from "./GameBuffBars"
import styles from "./GameOverlayMatch.module.sass"

export default function GameOverlayMatch() {
    const showPlayerList = useGameStore((s) => s.showPlayerList)
    const stats = useGameStore((s) => s.clientPlayerStats)
    const ping = useGameStore((s) => s.ping)
    const isHost = useGameStore((s) => s.isHost)
    const spectating = useGameStore((s) => s.clientSpectating)
    const spectateTargetName = useGameStore((s) => s.spectateTargetName)

    const [hostOpen, setHostOpen] = useState(false)
    const [chatOpen, setChatOpen] = useState(true)

    const healthPct = stats.healthMax > 0
        ? Math.max(0, Math.min(1, stats.health / stats.healthMax)) * 100
        : 0
    const ammoPct = stats.ammoMax > 0
        ? Math.max(0, Math.min(1, stats.ammo / stats.ammoMax)) * 100
        : 0
    const lowHealth = healthPct <= 30

    // Apex-style shield bar: the timed "shield" buff shown as its own bar above
    // health. Fill = remaining duration; the row only appears while it is active.
    const shieldPct = fraction(stats.shieldTicks, stats.shieldMaxTicks) * 100
    const shieldActive = stats.shieldTicks > 0

    // Tactical cooldown: while reloading, fill counts UP toward ready (1 - the
    // remaining reload fraction); when not reloading it sits full and shows ammo.
    const tacticalReloading = stats.tacticalReloadTicks > 0
    const tacticalReadyPct = tacticalReloading
        ? (1 - fraction(stats.tacticalReloadTicks, stats.tacticalReloadMaxTicks)) * 100
        : 100

    return (
        <div className="game-overlay">
            {/* Minimap / radar in the free top-left corner. */}
            <Minimap />

            {/* Top-right control cluster: SFX, and host menu when host. */}
            <div className={styles.controls}>
                <AudioVolumeToggle className={styles.controlButton} />
                {isHost && (
                    <GameButton
                        accent
                        className={styles.controlButton}
                        onClick={() => setHostOpen(true)}
                    >
                        Host
                    </GameButton>
                )}
                <LeaveButton className={styles.controlButton} />
            </div>

            {/* Transient kill feed, top-right under the control cluster. */}
            <KillFeed />

            {/* Tab scoreboard — overlaid, centered, unchanged behavior. */}
            {showPlayerList && (
                <div className={styles.scoreboard}>
                    <GamePlayerList />
                </div>
            )}

            {/* Spectating: a spectator has no ship, so the combat HUD is hidden
                and replaced with a banner naming the watched player + the keys
                to switch targets. */}
            {spectating ? (
                <div className={styles.spectateBanner}>
                    <span className={styles.label}>Spectating</span>
                    <span className={styles.target}>{spectateTargetName || "—"}</span>
                    <span className={styles.hint}>← / → to switch</span>
                </div>
            ) : (
                /* Compact combat HUD: shield, health, ammo/reload, tactical, ping. */
                <div className={styles.hud}>
                    {/* Apex-style shield bar: a thin bar sitting just above health,
                        only present while the shield buff is up. */}
                    {shieldActive && (
                        <div className={styles.shieldBar}>
                            <div
                                className={styles.shieldBarFill}
                                style={{ width: `${shieldPct}%` }}
                            />
                        </div>
                    )}

                    <div className={styles.stat}>
                        <div className={styles.statLabel}>
                            <span>HP</span>
                            <span className={styles.statValue}>
                                {Math.ceil(stats.health)} / {stats.healthMax}
                            </span>
                        </div>
                        <div className={styles.bar}>
                            <div
                                className={`${styles.barFill} ${styles.health} ${lowHealth ? styles.low : ""}`}
                                style={{ width: `${healthPct}%` }}
                            />
                        </div>
                    </div>

                    <div className={styles.stat}>
                        <div className={styles.statLabel}>
                            <span>AMMO</span>
                            <span className={styles.statValue}>
                                {stats.reloading
                                    ? "RELOADING"
                                    : `${stats.ammo} / ${stats.ammoMax}`}
                            </span>
                        </div>
                        <div className={styles.bar}>
                            <div
                                className={`${styles.barFill} ${styles.ammo} ${stats.reloading ? styles.reloading : ""}`}
                                style={{ width: `${stats.reloading ? 100 : ammoPct}%` }}
                            />
                        </div>
                    </div>

                    {/* Tactical cooldown/reload: counts up to ready while reloading,
                        otherwise shows it is charged with remaining tactical ammo. */}
                    <div className={styles.stat}>
                        <div className={styles.statLabel}>
                            <span>TAC</span>
                            <span className={styles.statValue}>
                                {tacticalReloading
                                    ? "CHARGING"
                                    : stats.tacticalAmmoMax > 0
                                        ? `${stats.tacticalAmmo} / ${stats.tacticalAmmoMax}`
                                        : "READY"}
                            </span>
                        </div>
                        <div className={styles.bar}>
                            <div
                                className={`${styles.barFill} ${styles.tactical} ${tacticalReloading ? styles.charging : ""}`}
                                style={{ width: `${tacticalReadyPct}%` }}
                            />
                        </div>
                    </div>

                    <div className={styles.ping}>{ping}ms</div>
                </div>
            )}

            {/* Bottom-right active-buff stack. Self-gates to nothing when no buff
                is active; hidden entirely while spectating (no ship → no buffs). */}
            {!spectating && <GameBuffBars />}

            {/* Chat: collapsible so it stays out of the way on small screens. */}
            <div className={`${styles.chat} ${chatOpen ? "" : styles.collapsed}`}>
                <div
                    className={styles.chatToggle}
                    onClick={() => setChatOpen((open) => !open)}
                >
                    {chatOpen ? "Hide Chat" : "Chat"}
                </div>
                {chatOpen && (
                    <div className={styles.chatBody}>
                        <GameChat />
                    </div>
                )}
            </div>

            {hostOpen && <HostControls onClose={() => setHostOpen(false)} />}
        </div>
    )
}
