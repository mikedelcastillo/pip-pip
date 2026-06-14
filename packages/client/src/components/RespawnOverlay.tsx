import { GAME_CONTEXT } from "../game"
import { useGameStore, ticksToSeconds } from "../game/store"
import styles from "./RespawnOverlay.module.sass"

// Centered "Respawning in N" shown over the canvas while the LOCAL player is
// dead during a match. Mirrors the COUNTDOWN overlay's centered styling, but
// stays click-through (pointer-events: none) so it never permanently blocks the
// touch sticks - it is only up while dead, and the sticks stay usable beneath
// it. GameOverlayMatch already gates rendering to !spectating && !spawned.
export default function RespawnOverlay() {
    const stats = useGameStore((s) => s.clientPlayerStats)
    const seconds = ticksToSeconds(stats.spawnTimeout, GAME_CONTEXT.game.tps)

    return (
        <div className={styles.respawn}>
            <div className={styles.center}>
                <div className={styles.text}>Respawning</div>
                {seconds > 0
                    ? <div className={styles.time}>{seconds}</div>
                    : <div className={styles.waiting}>...</div>}
            </div>
        </div>
    )
}
