import { useGameStore, fraction } from "../game/store"
import styles from "./GameOverlayMatch.module.sass"

// Powerup buff colors, mirrored from PowerupGraphic.COLORS in renderer.ts so the
// HUD chips read the same hue as the pickup that granted them:
//   haste  0x33CCFF, shield 0xAA66FF, invis 0xCCE6FF
const BUFF_COLORS = {
    haste: "#33CCFF",
    shield: "#AA66FF",
    invis: "#CCE6FF",
}

// Describes one active-buff row. `ticks`/`maxTicks` drive the depleting bar
// (remaining fraction = ticks / maxTicks); a row is only rendered while ticks > 0.
interface Buff {
    key: string
    label: string
    color: string
    ticks: number
    maxTicks: number
}

// Bottom-right active-buff stack. Renders one compact labelled chip per active
// timed buff the local player has (haste / shield / invis), each with a colored
// bar that depletes as the buff runs out. Pinned above the combat HUD so the two
// never overlap; renders nothing when no buff is active (and never while
// spectating — the parent gates that branch).
export default function GameBuffBars() {
    const stats = useGameStore((s) => s.clientPlayerStats)

    const buffs: Buff[] = [
        {
            key: "haste",
            label: "Haste",
            color: BUFF_COLORS.haste,
            ticks: stats.hasteTicks,
            maxTicks: stats.hasteMaxTicks,
        },
        {
            key: "shield",
            label: "Shield",
            color: BUFF_COLORS.shield,
            ticks: stats.shieldTicks,
            maxTicks: stats.shieldMaxTicks,
        },
        {
            key: "invis",
            label: "Cloak",
            color: BUFF_COLORS.invis,
            ticks: stats.invisTicks,
            maxTicks: stats.invisMaxTicks,
        },
    ].filter((buff) => buff.ticks > 0)

    if (buffs.length === 0) return null

    return (
        <div className={styles.buffs}>
            {buffs.map((buff) => (
                <div key={buff.key} className={styles.buff}>
                    <span className={styles.buffLabel} style={{ color: buff.color }}>
                        {buff.label}
                    </span>
                    <div className={styles.buffBar}>
                        <div
                            className={styles.buffBarFill}
                            style={{
                                width: `${fraction(buff.ticks, buff.maxTicks) * 100}%`,
                                backgroundColor: buff.color,
                            }}
                        />
                    </div>
                </div>
            ))}
        </div>
    )
}
