import { useState } from "react"
import { useGameStore, fraction } from "../game/store"
import GameChat from "./GameChat"
import GamePlayerList from "./GamePlayerList"
import PauseMenu from "./PauseMenu"
import KillFeed from "./KillFeed"
import PowerupFeed from "./PowerupFeed"
import Minimap from "./Minimap"
import GameBuffBars from "./GameBuffBars"
import styles from "./GameOverlayMatch.module.sass"

// Chat starts collapsed on small (phone-width) screens so its resting state is
// just the "Chat" pill and never sits over the lower-left move-stick zone.
// Checked once at mount - orientation/size changes mid-match are rare and the
// player can always toggle it.
function defaultChatOpen(): boolean {
    if (typeof window === "undefined") return true
    if (typeof window.matchMedia !== "function") return true
    return !window.matchMedia("(max-width: 768px)").matches
}

export default function GameOverlayMatch() {
    const showPlayerList = useGameStore((s) => s.showPlayerList)
    const stats = useGameStore((s) => s.clientPlayerStats)
    const ping = useGameStore((s) => s.ping)
    const spectating = useGameStore((s) => s.clientSpectating)
    const spectateTargetName = useGameStore((s) => s.spectateTargetName)

    const [menuOpen, setMenuOpen] = useState(false)
    const [chatOpen, setChatOpen] = useState(defaultChatOpen)

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

            {/* Single pause/options button in the top-right corner. Replaces the
                old loose SFX + Host + Leave cluster (which overlapped on mobile);
                everything now lives inside the menu, clearing the corner. */}
            <button
                type="button"
                className={styles.menuButton}
                aria-label="Menu"
                onClick={() => setMenuOpen(true)}
            >
                ☰
            </button>

            {/* Transient kill feed, top-right under the menu button. */}
            <KillFeed />

            {/* Transient powerup pickup announcement, top-center. Shared across
                all players (local + remote), so everyone sees who grabbed what. */}
            <PowerupFeed />

            {/* Tab scoreboard - overlaid, centered, unchanged behavior. */}
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
                    <span className={styles.target}>{spectateTargetName || " - "}</span>
                    <span className={styles.hint}>← / → to switch</span>
                </div>
            ) : (
                /* Compact combat HUD pinned to the TOP edge so the bottom corners
                   stay clear for the touch sticks + action buttons. */
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

            {/* Active-buff stack. Moved to the TOP edge (just under the combat HUD)
                so the bottom corners stay free for the sticks. Self-gates to
                nothing when no buff is active; hidden entirely while spectating. */}
            {!spectating && <GameBuffBars />}

            {/* Chat: top-left under the minimap, collapsible. Defaults collapsed
                on phones so its resting "Chat" pill never blocks the lower-left
                move-stick zone. */}
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

            {menuOpen && <PauseMenu onClose={() => setMenuOpen(false)} />}
        </div>
    )
}
