import { ReactNode, useEffect } from "react"
import GameButton from "./GameButton"
import styles from "./Modal.module.sass"

interface Props {
    title: string
    onClose: () => void
    children?: ReactNode
}

export default function Modal({ title, onClose, children }: Props) {
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
                <div className={styles.footer}>
                    <GameButton accent onClick={onClose}>Close</GameButton>
                </div>
            </div>
        </div>
    )
}
