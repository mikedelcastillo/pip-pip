import { useState } from "react"
import { MAX_PLAYER_NAME_LENGTH } from "@pip-pip/game/src/logic/player"
import { GAME_CONTEXT } from "../game"
import Modal from "./Modal"
import GameButton from "./GameButton"
import GameInput from "./GameInput"
import styles from "./NameModal.module.sass"

interface Props {
    onClose: () => void
}

// Shown when a player enters a lobby/match without a saved name yet (see
// GameView). Asks for a name once; on save it sets the player name (so others
// see it) and persists to localStorage so we never ask again. Dismissing keeps
// the default "Pilot" name.
export default function NameModal({ onClose }: Props) {
    const [name, setName] = useState("")

    const save = () => {
        if (name.trim().length === 0) return
        GAME_CONTEXT.setPlayerName(name)
        onClose()
    }

    return (
        <Modal title="Pick a name" onClose={onClose}>
            <div className={styles.prompt}>What should other pilots call you?</div>
            <GameInput
                value={name}
                onChange={setName}
                name="player-name"
                placeholder="Your name"
                maxLength={MAX_PLAYER_NAME_LENGTH}
                onEnter={save}
            />
            <div className={styles.actions}>
                <GameButton onClick={save}>Save</GameButton>
            </div>
        </Modal>
    )
}
