import Modal from "./Modal"
import GameButton from "./GameButton"
import styles from "./ConfirmModal.module.sass"

interface Props {
    title: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
    onConfirm: () => void
    onClose: () => void
}

// Reusable yes/no confirmation built on the shared Modal so it matches the rest
// of the UI and gets backdrop-tap / Escape dismissal for free on desktop + mobile.
// Cancel is the accented (safe) default; Confirm carries the action.
export default function ConfirmModal({
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    onConfirm,
    onClose,
}: Props) {
    return (
        <Modal title={title} onClose={onClose} hideClose>
            <div className={styles.message}>{message}</div>
            <div className={styles.actions}>
                <GameButton accent onClick={onClose}>{cancelLabel}</GameButton>
                <GameButton onClick={onConfirm}>{confirmLabel}</GameButton>
            </div>
        </Modal>
    )
}
