import Modal from "./Modal"
import styles from "./AlphaNoticeModal.module.sass"

interface Props {
    onClose: () => void
}

// First-launch heads-up that the game is in ALPHA. Built on the shared Modal so
// it inherits the backdrop-tap / Escape / Close dismiss affordances (works on
// tap and click). Auto-shown once to new visitors and re-openable from the
// homepage banner.
export default function AlphaNoticeModal({ onClose }: Props) {
    return (
        <Modal title="ALPHA" onClose={onClose}>
            <div className={styles.lead}>
                Pip-Pip is in early ALPHA — thanks for playing this early!
            </div>
            <div className={styles.body}>
                Expect frequent interruptions: every time we ship an update the
                server restarts, so any match in progress may suddenly drop.
                Just hop back in — it usually only takes a moment.
            </div>
        </Modal>
    )
}
