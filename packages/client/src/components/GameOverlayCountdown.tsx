import { useGameStore } from "../game/store"
import GameChat from "./GameChat"
import styles from "./GameOverlayCountdown.module.sass"

export default function GameOverlayCountdown() {
    const countdownMs = useGameStore((s) => s.countdownMs)
    const time = (countdownMs / 1000).toFixed(2)

    return (
        <div className="game-overlay">
            <div className={styles.blackout}>
                <div className={styles.center}>
                    <div className={styles.text}>Game starts in</div>
                    <div className={styles.time}>{time}</div>
                </div>
            </div>
            <div className={styles.gameChat}>
                <GameChat />
            </div>
        </div>
    )
}
