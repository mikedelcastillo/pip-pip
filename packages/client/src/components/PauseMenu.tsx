import { useState } from "react"
import { useGameStore } from "../game/store"
import Modal from "./Modal"
import GameButton from "./GameButton"
import LeaveButton from "./LeaveButton"
import HostControls from "./HostControls"
import SettingsModal from "./SettingsModal"
import styles from "./PauseMenu.module.sass"

interface Props {
    onClose: () => void
}

// In-match pause / options menu. Replaces the loose top-right control cluster
// (which overlapped on mobile) with a single tidy panel: Settings (audio /
// graphics / controls live there, including the SFX toggle), the Leave button,
// and, only for the host, an entry into Host Controls. Built on the shared Modal
// so it matches the lobby dialogs and works on tap + click.
//
// Settings and Host Controls are rendered IN PLACE OF this menu (not stacked on
// top) so two modals never fight for the screen; closing either returns here.
export default function PauseMenu({ onClose }: Props) {
    const isHost = useGameStore((s) => s.isHost)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [hostOpen, setHostOpen] = useState(false)

    if (settingsOpen) {
        return <SettingsModal onClose={() => setSettingsOpen(false)} />
    }
    if (hostOpen) {
        return <HostControls onClose={() => setHostOpen(false)} />
    }

    return (
        <Modal title="Menu" onClose={onClose}>
            <div className={styles.menu}>
                <div className={styles.row}>
                    <span className={styles.label}>Options</span>
                    <GameButton accent onClick={() => setSettingsOpen(true)}>
                        Settings
                    </GameButton>
                </div>

                {isHost && (
                    <div className={styles.row}>
                        <span className={styles.label}>Host</span>
                        <GameButton accent onClick={() => setHostOpen(true)}>
                            Host Controls
                        </GameButton>
                    </div>
                )}

                <div className={styles.row}>
                    <span className={styles.label}>Match</span>
                    <LeaveButton />
                </div>
            </div>
        </Modal>
    )
}
