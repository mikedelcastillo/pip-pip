import { ReactNode, useEffect } from "react"
import GameButton from "./GameButton"
import styles from "./Modal.module.sass"

interface Props {
    title: string
    onClose: () => void
    children?: ReactNode
    // Hide the built-in footer Close button. For modals that supply their own
    // explicit actions (e.g. ConfirmModal's Cancel / Confirm) so there is no
    // redundant or ambiguous second dismiss control. Backdrop-tap + Escape still
    // close. Defaults to false so every existing modal keeps its Close button.
    hideClose?: boolean
}

export default function Modal({ title, onClose, children, hideClose }: Props) {
    useEffect(() => {
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.code === "Escape") onClose()
        }
        document.body.addEventListener("keyup", handleKeyUp)
        return () => document.body.removeEventListener("keyup", handleKeyUp)
    }, [onClose])

    return (
        <div className={`${styles.backdrop} center-container`} onClick={onClose}>
            <div
                className={`${styles.card} content-container`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className={styles.title}>{title}</div>
                <div className={styles.body}>{children}</div>
                {!hideClose && (
                    <div className={styles.footer}>
                        <GameButton accent onClick={onClose}>Close</GameButton>
                    </div>
                )}
            </div>
        </div>
    )
}
