import { useUiStore } from "../store/ui"
import styles from "./AudioVolumeToggle.module.sass"

interface Props {
    className?: string
}

export default function AudioVolumeToggle({ className }: Props) {
    const muted = useUiStore((s) => s.audioMuted)
    const toggleAudioMuted = useUiStore((s) => s.toggleAudioMuted)

    const classes = [styles.toggle]
    if (muted) classes.push(styles.muted)
    if (className) classes.push(className)

    return (
        <div className={classes.join(" ")} onClick={toggleAudioMuted}>
            {muted ? "SFX OFF" : "SFX ON"}
        </div>
    )
}
