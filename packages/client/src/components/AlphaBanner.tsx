import { MouseEventHandler } from "react"
import styles from "./AlphaBanner.module.sass"

interface Props {
    onClick?: MouseEventHandler<HTMLButtonElement>
}

// Small unobtrusive homepage banner reminding players the game is in ALPHA.
// It's a real <button> so it is keyboard-focusable and fires on tap and click;
// activating it re-opens the alpha notice modal. Sized to wrap rather than
// overflow on a 375px phone.
export default function AlphaBanner({ onClick }: Props) {
    return (
        <button type="button" className={styles.banner} onClick={onClick}>
            <span className={styles.warn}>&#9888;</span>
            <span className={styles.text}>ALPHA — frequent interruptions as we ship updates</span>
        </button>
    )
}
