import {
    useGameStore,
    visibleTacticalPowerups,
    powerupLabel,
    powerupColor,
    formatBuffTime,
    isTimedBuff,
    POWERUP_FEED_DURATION_MS,
} from "../game/store"
import styles from "./PowerupFeed.module.sass"

// The fade-out begins this many ms before an INSTANT entry expires; before that
// it sits at full opacity. Timed-buff entries do not fade on a timer - they
// persist while the picker still holds the buff (then drop instantly), so the
// countdown itself communicates the remaining window.
const FADE_MS = 1200

// Tactical powerup feed: a kill-feed-styled column where a TIMED buff pickup
// (haste/shield/invis/ricochet) shows a LIVE remaining-time countdown read from
// that player's networked ship.timings, persisting for as long as they actually
// hold the buff so you can gauge an enemy's buff window. Instant pickups
// (health/ammo) keep the brief fixed transient. Click-through, like the kill feed.
export default function PowerupFeed() {
    const powerupFeed = useGameStore((s) => s.powerupFeed)
    const buffRemaining = useGameStore((s) => s.buffRemaining)
    const tps = useGameStore((s) => s.tps)

    // The store re-syncs every tick, so re-rendering from powerupFeed +
    // buffRemaining is enough to count down and drop stale entries live. No timer.
    const now = Date.now()
    const powerups = visibleTacticalPowerups(powerupFeed, buffRemaining, now)

    if (powerups.length === 0) return null

    return (
        <div className={styles.powerupFeed}>
            {powerups.map((powerup) => {
                const timed = isTimedBuff(powerup.type)
                // Instant pickups fade on the fixed window; timed buffs stay at
                // full opacity (their countdown carries the urgency instead).
                const remaining = POWERUP_FEED_DURATION_MS - (now - powerup.time)
                const opacity = timed ? 1 : Math.max(0, Math.min(1, remaining / FADE_MS))
                return (
                    <div key={powerup.id} className={styles.entry} style={{ opacity }}>
                        <span className={styles.player}>{powerup.playerName}</span>
                        {/* The "+" icon mirrors the kill feed's skull glyph: one
                            symbol that reads the row at a glance, tinted per type
                            so the powerup feed reads as the same feed system. */}
                        <span
                            className={styles.icon}
                            style={{ color: powerupColor(powerup.type) }}
                        >
                            +
                        </span>
                        <span
                            className={styles.powerup}
                            style={{ color: powerupColor(powerup.type) }}
                        >
                            {powerupLabel(powerup.type)}
                        </span>
                        {/* Live countdown for a timed buff: how long the picker
                            still has it. Omitted for instant pickups. */}
                        {timed && (
                            <span className={styles.timer}>
                                {formatBuffTime(powerup.remainingTicks, tps)}
                            </span>
                        )}
                    </div>
                )
            })}
        </div>
    )
}
