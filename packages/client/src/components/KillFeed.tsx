import { PIP_SHIPS } from "@pip-pip/game/src/ships"
import { useGameStore, visibleKills, KILL_FEED_DURATION_MS } from "../game/store"
import { shipAssets } from "../game/assets"
import styles from "./KillFeed.module.sass"

// The fade-out begins this many ms before an entry expires; before that it sits
// at full opacity. Kept in sync with the CSS transition feel.
const FADE_MS = 1200

// Resolve the killer's ship glyph from the shipIndex recorded on the kill entry.
// Returns undefined when the index is missing (killer's ship unknown, e.g. they
// left) or out of range, so the feed renders the line without an icon - no crash.
function killerShipImage(shipIndex?: number): string | undefined {
    if (typeof shipIndex !== "number") return undefined
    const ship = PIP_SHIPS[shipIndex]
    if (typeof ship === "undefined") return undefined
    return (shipAssets as Record<string, string>)[ship.texture]
}

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
                // A suicide arrives with killer === killed; show it as the player
                // killing themselves rather than a confusing "X killed X".
                const suicide = kill.killerName === kill.killedName
                const shipImage = killerShipImage(kill.killerShipIndex)
                return (
                    <div key={kill.id} className={styles.entry} style={{ opacity }}>
                        {typeof shipImage !== "undefined" && (
                            <img className={styles.shipIcon} src={shipImage} alt="" aria-hidden="true" />
                        )}
                        <span className={styles.player}>{kill.killerName}</span>
                        <span className={styles.skull}>☠</span>
                        <span className={styles.player}>{suicide ? "themselves" : kill.killedName}</span>
                    </div>
                )
            })}
        </div>
    )
}
