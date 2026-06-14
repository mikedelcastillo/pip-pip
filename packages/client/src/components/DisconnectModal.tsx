import Modal from "./Modal"
import GameButton from "./GameButton"
import styles from "./DisconnectModal.module.sass"

interface Props {
    // Fired by both the "Back to Home" button and the modal's built-in
    // dismiss affordances (backdrop tap/click, Escape). Returning the player
    // to "/" unmounts GameView, which tears the game down cleanly.
    onHome: () => void
    // Fired by "Reconnect": attempt to re-establish the connection and rejoin
    // the same lobby. Disabled visually-by-absence while a retry is in flight.
    onReconnect: () => void
    // True while a reconnect attempt is in progress so the button can show
    // feedback and the caller can ignore repeat taps.
    reconnecting?: boolean
}

// Shown OVER the live game when the websocket drops unexpectedly mid-session
// (the core Client emits `socketClose` after a verified connection closes).
// Built on the shared Modal + GameButton so it is on-brand and works on both
// desktop (click) and mobile (tap). Closing the modal returns the player home.
export default function DisconnectModal({ onHome, onReconnect, reconnecting }: Props) {
    return (
        <Modal title="Disconnected" onClose={onHome}>
            <div className={styles.message}>
                Lost connection to the server. The match may have ended or your
                network dropped.
            </div>
            <div className={styles.actions}>
                <GameButton accent onClick={onReconnect}>
                    {reconnecting ? "Reconnecting..." : "Reconnect"}
                </GameButton>
                <GameButton onClick={onHome}>Back to Home</GameButton>
            </div>
        </Modal>
    )
}
