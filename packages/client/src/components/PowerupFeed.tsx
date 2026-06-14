import { useGameStore, visiblePowerups, powerupLabel, powerupColor, POWERUP_FEED_DURATION_MS } from "../game/store"
import styles from "./PowerupFeed.module.sass"

// The fade-out begins this many ms before an entry expires; before that it sits
// at full opacity. Mirrors the kill feed's fade feel.
const FADE_MS = 1200

export default function PowerupFeed() {
    const powerupFeed = useGameStore((s) => s.powerupFeed)

    // The store re-syncs every tick, so re-rendering from powerupFeed is enough
    // to drop stale entries off the feed during a live match. No timer needed.
    const now = Date.now()
    const powerups = visiblePowerups(powerupFeed, now)

    if (powerups.length === 0) return null

    return (
        <div className={styles.powerupFeed}>
            {powerups.map((powerup) => {
                const remaining = POWERUP_FEED_DURATION_MS - (now - powerup.time)
                const opacity = Math.max(0, Math.min(1, remaining / FADE_MS))
                return (
                    <div key={powerup.id} className={styles.entry} style={{ opacity }}>
                        <span className={styles.player}>{powerup.playerName}</span>
                        <span className={styles.verb}>grabbed</span>
                        <span
                            className={styles.powerup}
                            style={{ color: powerupColor(powerup.type) }}
                        >
                            {powerupLabel(powerup.type)}!
                        </span>
                    </div>
                )
            })}
        </div>
    )
}
