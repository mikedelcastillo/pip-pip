import { useState } from "react"
import { PipPipGameMode } from "@pip-pip/game/src/logic"
import { useGameStore, fraction } from "../game/store"
import GameChat from "./GameChat"
import GamePlayerList from "./GamePlayerList"
import PauseMenu from "./PauseMenu"
import KillFeed from "./KillFeed"
import PowerupFeed from "./PowerupFeed"
import Minimap from "./Minimap"
import GameBuffBars from "./GameBuffBars"
import RespawnOverlay from "./RespawnOverlay"
import styles from "./GameOverlayMatch.module.sass"

// Chat starts collapsed on small (phone-width) screens so its resting state is
// just the "Chat" pill and never sits over the lower-left move-stick zone.
function defaultChatOpen(): boolean {
    if (typeof window === "undefined") return true
    if (typeof window.matchMedia !== "function") return true
    return !window.matchMedia("(max-width: 768px)").matches
}

// Format a remaining-seconds count as M:SS for the KILL_FRENZY clock. Clamped at
// 0 so a spent timer never shows negative. Pure, so it is trivially testable.
export function formatMatchClock(totalSeconds: number): string {
    const safe = Math.max(0, Math.floor(totalSeconds))
    const minutes = Math.floor(safe / 60)
    const seconds = safe % 60
    return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

// The unobtrusive top-center objective label: the live match clock for
// KILL_FRENZY, or the "First to N" kill target for DEATHMATCH. Empty string when
// there is nothing meaningful to show (e.g. DEATHMATCH with no kill cap), which
// the HUD treats as "render nothing". Pure, so it is trivially testable.
export function matchObjectiveLabel(
    mode: PipPipGameMode,
    matchTimerSeconds: number,
    maxKills: number,
): string {
    if (mode === PipPipGameMode.KILL_FRENZY) {
        return formatMatchClock(matchTimerSeconds)
    }
    if (maxKills > 0) {
        return `First to ${maxKills}`
    }
    return ""
}

// Apex-Legends-style in-match HUD. Layout, by corner:
//   top-left ...... minimap, then the collapsible chat under it
//   top-right ..... the menu button, with the kill feed beneath it
//   top-center .... transient powerup-pickup shouts
//   bottom-left ... health + segmented shield stack, buff chips above it
//   bottom-right .. the weapon card (big ammo number + tactical ability pip + ping)
//   center ........ the respawn countdown while dead
// Every combat element is pointer-events:none so the floating touch sticks
// underneath stay fully usable on mobile.
export default function GameOverlayMatch() {
    const showPlayerList = useGameStore((s) => s.showPlayerList)
    const stats = useGameStore((s) => s.clientPlayerStats)
    const ping = useGameStore((s) => s.ping)
    const spectating = useGameStore((s) => s.clientSpectating)
    const spectateTargetName = useGameStore((s) => s.spectateTargetName)
    const mode = useGameStore((s) => s.mode)
    const matchTimerSeconds = useGameStore((s) => s.matchTimerSeconds)
    const maxKills = useGameStore((s) => s.maxKills)

    const objective = matchObjectiveLabel(mode, matchTimerSeconds, maxKills)
    const isFrenzy = mode === PipPipGameMode.KILL_FRENZY
    // The KILL_FRENZY clock turns urgent in the final 10 seconds.
    const urgent = isFrenzy && matchTimerSeconds <= 10

    const [menuOpen, setMenuOpen] = useState(false)
    const [chatOpen, setChatOpen] = useState(defaultChatOpen)

    const healthPct = fraction(stats.health, stats.healthMax) * 100
    const lowHealth = healthPct <= 30
    const shieldPct = fraction(stats.shieldTicks, stats.shieldMaxTicks) * 100
    const shieldActive = stats.shieldTicks > 0

    // Tactical ability pip: while reloading the fill rises toward ready
    // (1 - remaining reload fraction); when charged it sits full.
    const tacticalReloading = stats.tacticalReloadTicks > 0
    const tacticalReadyPct = tacticalReloading
        ? (1 - fraction(stats.tacticalReloadTicks, stats.tacticalReloadMaxTicks)) * 100
        : 100

    const alive = !spectating && stats.spawned

    return (
        <div className={`game-overlay ${styles.matchOverlay}`}>
            <Minimap />

            {/* Top-center objective: the KILL_FRENZY match clock, or the
                DEATHMATCH "First to N" kill target. Hidden when there is nothing
                to show. pointer-events:none so it never blocks the touch sticks. */}
            {objective.length > 0 && (
                <div className={`${styles.objective} ${isFrenzy ? styles.clock : ""} ${urgent ? styles.urgent : ""}`}>
                    {objective}
                </div>
            )}

            {/* Single pause/options button, top-right corner. */}
            <button
                type="button"
                className={styles.menuButton}
                aria-label="Menu"
                onClick={() => setMenuOpen(true)}
            >
                &#9776;
            </button>

            <KillFeed />
            <PowerupFeed />

            {showPlayerList && (
                <div className={styles.scoreboard}>
                    <GamePlayerList />
                </div>
            )}

            {/* Spectating: no ship, so a banner replaces the combat HUD. */}
            {spectating && (
                <div className={styles.spectateBanner}>
                    <span className={styles.label}>Spectating</span>
                    <span className={styles.target}>{spectateTargetName || " - "}</span>
                    <span className={styles.hint}>&larr; / &rarr; to switch</span>
                </div>
            )}

            {/* Dead (not spectating): the centered respawn countdown stands in for
                the combat HUD until the player is back in. */}
            {!spectating && !stats.spawned && <RespawnOverlay />}

            {alive && (
                <>
                    {/* Buff chips float just above the health stack, like Apex's
                        ability row sitting over the health bars. */}
                    <GameBuffBars />

                    {/* Bottom-left: segmented shield over a health bar + big number. */}
                    <div className={styles.healthStack}>
                        {shieldActive && (
                            <div className={styles.shield}>
                                <div
                                    className={styles.shieldFill}
                                    style={{ width: `${shieldPct}%` }}
                                />
                                <div className={styles.shieldSegments} />
                            </div>
                        )}
                        <div className={styles.healthRow}>
                            <div className={`${styles.healthBar} ${lowHealth ? styles.low : ""}`}>
                                <div
                                    className={styles.healthFill}
                                    style={{ width: `${healthPct}%` }}
                                />
                            </div>
                            <div className={styles.healthNum}>{Math.ceil(stats.health)}</div>
                        </div>
                    </div>

                    {/* Bottom-right: the weapon card. Big ammo number, a tactical
                        ability pip with a rising cooldown fill, and ping. */}
                    <div className={styles.weaponCard}>
                        <div className={styles.ammo}>
                            <span className={styles.ammoNum}>
                                {stats.reloading ? "--" : stats.ammo}
                            </span>
                            <span className={styles.ammoMax}>/ {stats.ammoMax}</span>
                        </div>
                        <div className={styles.cardRow}>
                            <div className={`${styles.tac} ${tacticalReloading ? styles.charging : styles.ready}`}>
                                <div
                                    className={styles.tacFill}
                                    style={{ height: `${tacticalReadyPct}%` }}
                                />
                                <span className={styles.tacLabel}>
                                    {tacticalReloading ? "TAC" : stats.tacticalAmmo}
                                </span>
                            </div>
                            <div className={styles.ping}>{ping}<span>ms</span></div>
                        </div>
                    </div>
                </>
            )}

            {/* Chat: top-left under the minimap, collapsible (collapsed on phones). */}
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
