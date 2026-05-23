import { useUiStore } from "../store/ui"
import styles from "./GameLoading.module.sass"

export default function GameLoading() {
    const loading = useUiStore((s) => s.loading)
    const body = useUiStore((s) => s.body)

    if (!loading) return null

    return (
        <div className={`${styles.gameLoading} center-container`}>
            <div className={`${styles.contentContainer} content-container`}>
                <div className={styles.text}>{body}</div>
            </div>
        </div>
    )
}
