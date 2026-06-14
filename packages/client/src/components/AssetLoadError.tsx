import GameButton from "./GameButton"
import styles from "./AssetLoadError.module.sass"

interface Props {
    // Re-run the asset bundle load. The parent (App) owns the loader and bumps a
    // retry token so the load effect fires again; this stays in-app so the player
    // never sees a native alert/prompt (those are jarring, and especially bad on
    // mobile where they steal focus and look broken).
    onRetry: () => void
}

// Shown when the initial asset download fails. Replaces the old native
// alert("Could not load assets") + prompt("Try again?") flow with an on-brand,
// mobile-friendly retry screen built on the shared GameButton.
export default function AssetLoadError({ onRetry }: Props) {
    return (
        <div className={`${styles.root} center-container`}>
            <div className={`${styles.card} content-container`}>
                <div className={styles.title}>Could not load the game</div>
                <div className={styles.body}>
                    Some assets failed to download. Check your connection and try again.
                </div>
                <GameButton accent onClick={onRetry}>Retry</GameButton>
            </div>
        </div>
    )
}
