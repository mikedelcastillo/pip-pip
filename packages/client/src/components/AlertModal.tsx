import { useAlertStore } from "../store/alert"
import Modal from "./Modal"
import GameButton from "./GameButton"
import styles from "./AlertModal.module.sass"

// Renders the global alert (raised via showAlert / useAlertStore) as an on-brand
// modal, replacing native alert(). Mounted once at the app root so it can appear
// over any screen. Built on the shared Modal so it gets backdrop-tap / Escape /
// OK dismissal for free on both desktop and mobile.
export default function AlertModal() {
    const message = useAlertStore((s) => s.message)
    const title = useAlertStore((s) => s.title)
    const clear = useAlertStore((s) => s.clear)

    if (message === null) return null

    return (
        <Modal title={title} onClose={clear}>
            <div className={styles.message}>{message}</div>
            <div className={styles.actions}>
                <GameButton accent onClick={clear}>OK</GameButton>
            </div>
        </Modal>
    )
}
