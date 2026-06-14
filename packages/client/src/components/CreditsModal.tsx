import Modal from "./Modal"
import styles from "./CreditsModal.module.sass"

interface Props {
    onClose: () => void
}

export default function CreditsModal({ onClose }: Props) {
    return (
        <Modal title="Credits" onClose={onClose}>
            <div className={styles.creditRow}>
                <div className={styles.role}>Game Developer</div>
                <div className={styles.name}>Mike Del Castillo</div>
            </div>
            <div className={styles.creditRow}>
                <div className={styles.role}>Art</div>
                <div className={styles.name}>Meg Del Castillo</div>
            </div>
            <div className={styles.lore}>
                The game is named "Pip-Pip" after a lovebird that mimicked an
                infrared thermometer's "pip pip" beep.
            </div>
        </Modal>
    )
}
