import { PipPipGamePhase } from "@pip-pip/game/src/logic"
import { GAME_CONTEXT } from "../game"
import Modal from "./Modal"
import GameButton from "./GameButton"
import styles from "./HostControls.module.sass"

interface Props {
    onClose: () => void
}

// In-match host panel. Reuses the shared Modal so it matches the lobby's
// Host/Ship/Map dialogs. The only authoritative action exposed mid-match is
// stopping the game; detailed settings (ship, map, lobby visibility) live in
// the SETUP-phase lobby tabs, which this returns everyone to.
export default function HostControls({ onClose }: Props) {
    const stopGame = () => {
        // Same call the "/stop" chat command uses — host-only, server-gated.
        GAME_CONTEXT.sendGamePhase(PipPipGamePhase.SETUP)
        onClose()
    }

    return (
        <Modal title="Host" onClose={onClose}>
            <div className={styles.section}>
                <GameButton onClick={stopGame}>Stop Game</GameButton>
                <div className={styles.hint}>
                    Returns everyone to the lobby. Ship, map and match
                    settings are on the lobby tabs.
                </div>
            </div>
        </Modal>
    )
}
