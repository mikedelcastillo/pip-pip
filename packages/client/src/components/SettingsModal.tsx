import { useUiStore } from "../store/ui"
import Modal from "./Modal"
import AudioVolumeToggle from "./AudioVolumeToggle"
import styles from "./SettingsModal.module.sass"

interface Props {
    onClose: () => void
}

const CONTROLS: [string, string][] = [
    ["Move", "WASD"],
    ["Aim", "Mouse"],
    ["Primary fire", "Left click / Space"],
    ["Secondary cannon", "Right click / Left Shift"],
    ["Reload", "R"],
    ["Scoreboard", "Tab"],
]

export default function SettingsModal({ onClose }: Props) {
    const audioVolume = useUiStore((s) => s.audioVolume)
    const setAudioVolume = useUiStore((s) => s.setAudioVolume)

    const volumePercent = Math.round(audioVolume * 100)

    return (
        <Modal title="Settings" onClose={onClose}>
            <div className={styles.section}>
                <div className={styles.sectionTitle}>Audio</div>
                <div className={styles.volumeRow}>
                    <input
                        className={styles.slider}
                        type="range"
                        min={0}
                        max={100}
                        value={volumePercent}
                        onChange={(e) => setAudioVolume(Number(e.target.value) / 100)}
                    />
                    <div className={styles.volumeValue}>{volumePercent}%</div>
                </div>
                <AudioVolumeToggle />
            </div>

            <div className={styles.section}>
                <div className={styles.sectionTitle}>Controls</div>
                <div className={styles.controls}>
                    {CONTROLS.map(([action, keys]) => (
                        <div className={styles.controlRow} key={action}>
                            <div className={styles.controlAction}>{action}</div>
                            <div className={styles.controlKeys}>{keys}</div>
                        </div>
                    ))}
                </div>
            </div>
        </Modal>
    )
}
