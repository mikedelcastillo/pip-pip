import { useState } from "react"
import { useUiStore } from "../store/ui"
import { ACTION_LABELS, GAME_ACTIONS, keyCodeLabel } from "../store/keybindings"
import Modal from "./Modal"
import AudioVolumeToggle from "./AudioVolumeToggle"
import GameButton from "./GameButton"
import KeyBindingsModal from "./KeyBindingsModal"
import styles from "./SettingsModal.module.sass"

interface Props {
    onClose: () => void
}

export default function SettingsModal({ onClose }: Props) {
    const audioVolume = useUiStore((s) => s.audioVolume)
    const setAudioVolume = useUiStore((s) => s.setAudioVolume)
    const crtEnabled = useUiStore((s) => s.crtEnabled)
    const toggleCrtEnabled = useUiStore((s) => s.toggleCrtEnabled)
    const keyBindings = useUiStore((s) => s.keyBindings)

    const [editingBindings, setEditingBindings] = useState(false)

    const volumePercent = Math.round(audioVolume * 100)

    // When the bindings editor is open, render it on top of (instead of) the
    // settings modal so there is a single dialog in focus at a time.
    if (editingBindings) {
        return <KeyBindingsModal onClose={() => setEditingBindings(false)} />
    }

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
                <div className={styles.sectionTitle}>Graphics</div>
                <GameButton onClick={toggleCrtEnabled} accent={crtEnabled}>
                    {crtEnabled ? "CRT ON" : "CRT OFF"}
                </GameButton>
            </div>

            <div className={styles.section}>
                <div className={styles.sectionTitle}>Controls</div>
                <div className={styles.controls}>
                    <div className={styles.controlRow}>
                        <div className={styles.controlAction}>Aim</div>
                        <div className={styles.controlKeys}>Mouse / right stick</div>
                    </div>
                    {GAME_ACTIONS.map((action) => (
                        <div className={styles.controlRow} key={action}>
                            <div className={styles.controlAction}>{ACTION_LABELS[action]}</div>
                            <div className={styles.controlKeys}>{keyCodeLabel(keyBindings[action])}</div>
                        </div>
                    ))}
                </div>
                <div className={styles.controlsAction}>
                    <GameButton accent onClick={() => setEditingBindings(true)}>
                        Edit bindings
                    </GameButton>
                </div>
            </div>
        </Modal>
    )
}
