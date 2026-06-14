import { GAME_CONTEXT } from "../game"
import { useGameStore, ticksToSeconds } from "../game/store"
import { useUiStore } from "../store/ui"
import styles from "./RespawnOverlay.module.sass"

// Centered "Respawning in N" shown over the canvas while the LOCAL player is
// dead during a match. Mirrors the COUNTDOWN overlay's centered styling, but
// stays click-through (pointer-events: none) so it never permanently blocks the
// touch sticks - it is only up while dead, and the sticks stay usable beneath
// it. GameOverlayMatch already gates rendering to !spectating && !spawned.
export default function RespawnOverlay() {
    const stats = useGameStore((s) => s.clientPlayerStats)
    const setShowLoadout = useUiStore((s) => s.setShowLoadout)
    const seconds = ticksToSeconds(stats.spawnTimeout, GAME_CONTEXT.game.tps)

    // Cancel the pending respawn and jump to the loadout screen. Becoming a
    // spectator stops the respawn loop from spawning the player (it skips
    // spectators), so the countdown stops here; the loadout overlay then lets
    // them pick a ship and Deploy (un-spectate) or stay spectating.
    const changeLoadout = () => {
        GAME_CONTEXT.setSpectator(true)
        setShowLoadout(true)
    }

    return (
        <div className={styles.respawn}>
            <div className={styles.center}>
                <div className={styles.text}>Respawning</div>
                {seconds > 0
                    ? <div className={styles.time}>{seconds}</div>
                    : <div className={styles.waiting}>...</div>}
                {/* The overlay root is pointer-events:none so the touch sticks stay
                    usable; re-enable pointer events on just this button so the tap
                    lands. */}
                <button
                    type="button"
                    className={styles.loadoutButton}
                    onClick={changeLoadout}
                >
                    Change Loadout
                </button>
            </div>
        </div>
    )
}
