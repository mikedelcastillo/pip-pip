import { MouseEventHandler, ReactNode } from "react"
import styles from "./GameButton.module.sass"

interface Props {
    children?: ReactNode
    onClick?: MouseEventHandler<HTMLDivElement>
    accent?: boolean
    className?: string
}

export default function GameButton({ children, onClick, accent, className }: Props) {
    const classes = [styles.button]
    if (accent) classes.push(styles.accent)
    if (className) classes.push(className)
    return (
        <div className={classes.join(" ")} onClick={onClick}>
            <div className={styles.top}>
                <div className={styles.text}>{children}</div>
            </div>
            <div className={styles.bottom}></div>
        </div>
    )
}
