import { useGameStore } from "../game/store"
import GameChat from "./GameChat"
import GamePlayerList from "./GamePlayerList"
import styles from "./GameOverlayResults.module.sass"

// Headline text for the end-of-match screen, driven purely by the mirrored
// result. winnerCount: 0 = nobody scored / "Time!"; 1 = a clean winner; >1 = a
// tie. Kept tiny and pure so the component is easy to follow.
function resultHeadline(winnerName: string, winnerCount: number): string {
    if (winnerCount > 1) return "It is a tie!"
    if (winnerCount === 1 && winnerName.length > 0) return `${winnerName} wins!`
    return "Time!"
}

// Shown when phase === RESULTS. Mirrors GameOverlayCountdown's dimmed blackout,
// stacking a result headline over the final scoreboard (the same GamePlayerList
// used elsewhere) and the chat. The whole thing is a vertical flex column so it
// stays readable and scrollable on a phone.
export default function GameOverlayResults() {
    const winnerName = useGameStore((s) => s.winnerName)
    const winnerCount = useGameStore((s) => s.winnerCount)

    const headline = resultHeadline(winnerName, winnerCount)
    const isTie = winnerCount > 1

    return (
        <div className="game-overlay">
            <div className={styles.blackout}>
                <div className={styles.panel}>
                    <div className={styles.label}>Match Over</div>
                    <div className={`${styles.headline} ${isTie ? styles.tie : ""}`}>
                        {headline}
                    </div>
                    <div className={styles.board}>
                        <GamePlayerList />
                    </div>
                    <div className={styles.hint}>Returning to the lobby...</div>
                </div>
            </div>
            <div className={styles.gameChat}>
                <GameChat />
            </div>
        </div>
    )
}
