import Modal from "./Modal"
import GameButton from "./GameButton"
import styles from "./LobbyNotFound.module.sass"

interface Props {
    code?: string
    notFound?: boolean
    onHome: () => void
    onRetry?: () => void
}

export default function LobbyNotFound({ code, notFound, onHome, onRetry }: Props) {
    const title = notFound ? "Lobby Not Found" : "Couldn't Join"
    const message = notFound
        ? "We couldn't find that lobby. It may have closed or the code might be wrong."
        : "We couldn't connect to that lobby. The server may be unreachable right now."

    return (
        <Modal title={title} onClose={onHome}>
            <div className={styles.message}>{message}</div>
            {code && (
                <div className={styles.codeRow}>
                    <span className={styles.codeLabel}>Lobby code</span>
                    <span className={styles.code}>{code}</span>
                </div>
            )}
            <div className={styles.actions}>
                {onRetry && (
                    <GameButton accent onClick={onRetry}>Try Again</GameButton>
                )}
                <GameButton onClick={onHome}>Back to Home</GameButton>
            </div>
        </Modal>
    )
}
