import { useGameStore, activeBuffs, formatBuffTime, fraction } from "../game/store"
import styles from "./GameBuffBars.module.sass"

// Local player's active-buff HUD, styled like Minecraft status effects: a
// vertical LIST of rows, each a colored swatch + the buff NAME + a remaining-time
// countdown, with a thin depleting bar that fades as the buff runs out. Strongest
// (longest window) buff sits on top - see activeBuffs. Only buffs with time left
// are shown; renders nothing when none are active. Display-only over the combat
// HUD, so the whole stack is pointer-events:none (set in the stylesheet). The
// parent gates this so it never renders while spectating.
export default function GameBuffBars() {
    const stats = useGameStore((s) => s.clientPlayerStats)
    const tps = useGameStore((s) => s.tps)

    const buffs = activeBuffs(stats)

    if (buffs.length === 0) return null

    return (
        <div className={styles.buffs}>
            {buffs.map((buff) => {
                const remaining = fraction(buff.ticks, buff.maxTicks)
                return (
                    <div key={buff.type} className={styles.buff}>
                        <span
                            className={styles.swatch}
                            style={{ backgroundColor: buff.color }}
                        />
                        <span className={styles.label}>{buff.label}</span>
                        <span className={styles.time}>{formatBuffTime(buff.ticks, tps)}</span>
                        <div className={styles.bar}>
                            <div
                                className={styles.barFill}
                                style={{
                                    width: `${remaining * 100}%`,
                                    backgroundColor: buff.color,
                                }}
                            />
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
