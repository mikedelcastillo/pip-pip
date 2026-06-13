import { useGameStore, visibleKills, KILL_FEED_DURATION_MS } from "../game/store"
import styles from "./KillFeed.module.sass"

// The fade-out begins this many ms before an entry expires; before that it sits
// at full opacity. Kept in sync with the CSS transition feel.
const FADE_MS = 1200

export default function KillFeed() {
    const killFeed = useGameStore((s) => s.killFeed)

    // The store re-syncs every tick, so re-rendering from killFeed is enough to
    // drop stale entries off the feed during a live match. No timer needed.
    const now = Date.now()
    const kills = visibleKills(killFeed, now)

    if (kills.length === 0) return null

    return (
        <div className={styles.killFeed}>
            {kills.map((kill) => {
                const remaining = KILL_FEED_DURATION_MS - (now - kill.time)
                const opacity = Math.max(0, Math.min(1, remaining / FADE_MS))
                return (
                    <div key={kill.id} className={styles.entry} style={{ opacity }}>
                        <span className={styles.player}>{kill.killerName}</span>
                        <span className={styles.skull}>☠</span>
                        <span className={styles.player}>{kill.killedName}</span>
                    </div>
                )
            })}
        </div>
    )
}
