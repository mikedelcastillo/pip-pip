import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useGameStore } from "../game/store"
import { GAME_CONTEXT } from "../game"
import Modal from "./Modal"
import GameButton from "./GameButton"
import SettingsModal from "./SettingsModal"
import ConfirmModal from "./ConfirmModal"
import styles from "./LobbyMenu.module.sass"

interface Props {
    onClose: () => void
}

// The lobby's hamburger menu. Tucks Settings, Leave and (host only) Close Lobby
// into one tidy panel so the lobby header stays uncluttered. Built on the shared
// Modal so it works on tap + click. Settings and the Close-Lobby confirmation are
// rendered IN PLACE OF this menu (not stacked) so two modals never fight for the
// screen; cancelling either returns here.
export default function LobbyMenu({ onClose }: Props) {
    const isHost = useGameStore((s) => s.isHost)
    const navigate = useNavigate()
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [confirmClose, setConfirmClose] = useState(false)

    if (settingsOpen) {
        return <SettingsModal onClose={() => setSettingsOpen(false)} />
    }
    if (confirmClose) {
        return (
            <ConfirmModal
                title="Close lobby?"
                message="This ends the lobby and sends every player back home."
                confirmLabel="Close Lobby"
                onConfirm={() => {
                    GAME_CONTEXT.closeLobby()
                    onClose()
                }}
                onClose={() => setConfirmClose(false)}
            />
        )
    }

    // Leaving routes home; GameView's unmount tears the game down and disconnects.
    const leave = () => {
        onClose()
        navigate("/")
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
                        <GameButton accent onClick={() => setConfirmClose(true)}>
                            Close Lobby
                        </GameButton>
                    </div>
                )}

                <div className={styles.row}>
                    <span className={styles.label}>Lobby</span>
                    <GameButton onClick={leave}>Leave</GameButton>
                </div>
            </div>
        </Modal>
    )
}
