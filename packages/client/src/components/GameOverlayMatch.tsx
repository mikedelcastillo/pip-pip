import { useState } from "react"
import { useGameStore } from "../game/store"
import GameChat from "./GameChat"
import GamePlayerList from "./GamePlayerList"
import GameButton from "./GameButton"
import AudioVolumeToggle from "./AudioVolumeToggle"
import HostControls from "./HostControls"
import styles from "./GameOverlayMatch.module.sass"

export default function GameOverlayMatch() {
    const showPlayerList = useGameStore((s) => s.showPlayerList)
    const stats = useGameStore((s) => s.clientPlayerStats)
    const ping = useGameStore((s) => s.ping)
    const isHost = useGameStore((s) => s.isHost)

    const [hostOpen, setHostOpen] = useState(false)
    const [chatOpen, setChatOpen] = useState(true)

    const healthPct = stats.healthMax > 0
        ? Math.max(0, Math.min(1, stats.health / stats.healthMax)) * 100
        : 0
    const ammoPct = stats.ammoMax > 0
        ? Math.max(0, Math.min(1, stats.ammo / stats.ammoMax)) * 100
        : 0
    const lowHealth = healthPct <= 30

    return (
        <div className="game-overlay">
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
            </div>

            {/* Tab scoreboard — overlaid, centered, unchanged behavior. */}
            {showPlayerList && (
                <div className={styles.scoreboard}>
                    <GamePlayerList />
                </div>
            )}

            {/* Compact combat HUD: health, ammo/reload, ping. */}
            <div className={styles.hud}>
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

                <div className={styles.ping}>{ping}ms</div>
            </div>

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
