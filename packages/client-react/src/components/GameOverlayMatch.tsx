import { useGameStore } from "../game/store"
import GameChat from "./GameChat"
import GamePlayerList from "./GamePlayerList"
import styles from "./GameOverlayMatch.module.sass"

export default function GameOverlayMatch() {
    const showPlayerList = useGameStore((s) => s.showPlayerList)
    const stats = useGameStore((s) => s.clientPlayerStats)

    return (
        <div className="game-overlay">
            {showPlayerList && <GamePlayerList />}
            <pre>{JSON.stringify(stats, null, 2)}</pre>
            <div className={styles.gameChat}>
                <GameChat />
            </div>
        </div>
    )
}
