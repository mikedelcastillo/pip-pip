import {
    useGameStore,
    visibleTacticalBuffs,
    buffLabel,
    buffColor,
    formatBuffTime,
    isTimedBuff,
    BUFF_FEED_DURATION_MS,
} from "../game/store"
import styles from "./BuffFeed.module.sass"

// The fade-out begins this many ms before an INSTANT entry expires; before that
// it sits at full opacity. Timed-buff entries do not fade on a timer - they
// persist while the picker still holds the buff (then drop instantly), so the
// countdown itself communicates the remaining window.
const FADE_MS = 1200

// Tactical buff feed: a kill-feed-styled column where a TIMED buff pickup
// (haste/shield/invis/ricochet) shows a LIVE remaining-time countdown read from
// that player's networked ship.timings, persisting for as long as they actually
// hold the buff so you can gauge an enemy's buff window. Instant pickups
// (health/ammo) keep the brief fixed transient. Click-through, like the kill feed.
export default function BuffFeed() {
    const buffFeed = useGameStore((s) => s.buffFeed)
    const buffRemaining = useGameStore((s) => s.buffRemaining)
    const tps = useGameStore((s) => s.tps)

    // The store re-syncs every tick, so re-rendering from buffFeed +
    // buffRemaining is enough to count down and drop stale entries live. No timer.
    const now = Date.now()
    const buffs = visibleTacticalBuffs(buffFeed, buffRemaining, now)

    if (buffs.length === 0) return null

    return (
        <div className={styles.buffFeed}>
            {buffs.map((buff) => {
                const timed = isTimedBuff(buff.type)
                // Instant pickups fade on the fixed window; timed buffs stay at
                // full opacity (their countdown carries the urgency instead).
                const remaining = BUFF_FEED_DURATION_MS - (now - buff.time)
                const opacity = timed ? 1 : Math.max(0, Math.min(1, remaining / FADE_MS))
                return (
                    <div key={buff.id} className={styles.entry} style={{ opacity }}>
                        <span className={styles.player}>{buff.playerName}</span>
                        {/* The "+" icon mirrors the kill feed's skull glyph: one
                            symbol that reads the row at a glance, tinted per type
                            so the buff feed reads as the same feed system. */}
                        <span
                            className={styles.icon}
                            style={{ color: buffColor(buff.type) }}
                        >
                            +
                        </span>
                        <span
                            className={styles.buff}
                            style={{ color: buffColor(buff.type) }}
                        >
                            {buffLabel(buff.type)}
                        </span>
                        {/* Live countdown for a timed buff: how long the picker
                            still has it. Omitted for instant pickups. */}
                        {timed && (
                            <span className={styles.timer}>
                                {formatBuffTime(buff.remainingTicks, tps)}
                            </span>
                        )}
                    </div>
                )
            })}
        </div>
    )
}
