import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { CACHE_NAME_KEY } from "@pip-pip/game/src/logic/utils"
import { GAME_CONTEXT } from "../game"
import { useUiStore } from "../store/ui"
import Modal from "./Modal"
import GameButton from "./GameButton"
import GameInput from "./GameInput"
import styles from "./HostSettingsModal.module.sass"

interface Props {
    onClose: () => void
}

const MIN_PLAYERS = 2
const MAX_PLAYERS = 16

const clampPlayers = (value: number) =>
    Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, value))

const defaultLobbyName = () => {
    const name = localStorage.getItem(CACHE_NAME_KEY)
    if (typeof name === "string" && name.trim().length > 0) {
        return `${name.trim()}'s Game`
    }
    return "Pip-Pip Lobby"
}

export default function HostSettingsModal({ onClose }: Props) {
    const navigate = useNavigate()
    const setLoading = useUiStore((s) => s.setLoading)

    const [lobbyName, setLobbyName] = useState(defaultLobbyName)
    const [isPublic, setIsPublic] = useState(true)
    const [maxPlayers, setMaxPlayers] = useState(8)

    const stepPlayers = (delta: number) =>
        setMaxPlayers((current) => clampPlayers(current + delta))

    const startHosting = async () => {
        const name = lobbyName.trim() || defaultLobbyName()
        setLoading(true, "Loading...")
        try {
            setLoading(true, "Requesting connection...")
            await GAME_CONTEXT.client.requestConnectionIfNeeded()
            setLoading(true, "Creating lobby...")
            const lobby = await GAME_CONTEXT.client.createLobby("default", {
                lobbyName: name,
                isPublic,
                maxPlayers,
            })
            navigate(`/${lobby.lobbyId}`)
        } catch (e) {
            console.warn(e)
            alert("Could not host a game!")
        }
        setLoading(false, "")
    }

    return (
        <Modal title="Host Game" onClose={onClose}>
            <div className={styles.section}>
                <div className={styles.sectionTitle}>Lobby Name</div>
                <GameInput
                    value={lobbyName}
                    onChange={setLobbyName}
                    placeholder="Pip-Pip Lobby"
                    onEnter={startHosting}
                />
            </div>

            <div className={styles.section}>
                <div className={styles.sectionTitle}>Visibility</div>
                <div className={styles.toggleRow}>
                    <GameButton
                        accent={!isPublic}
                        onClick={() => setIsPublic(true)}
                    >
                        Public
                    </GameButton>
                    <GameButton
                        accent={isPublic}
                        onClick={() => setIsPublic(false)}
                    >
                        Private
                    </GameButton>
                </div>
                <div className={styles.hint}>
                    {isPublic
                        ? "Anyone can find and join this match."
                        : "Only people with the link can join."}
                </div>
            </div>

            <div className={styles.section}>
                <div className={styles.sectionTitle}>Max Players</div>
                <div className={styles.stepperRow}>
                    <GameButton accent onClick={() => stepPlayers(-1)}>-</GameButton>
                    <div className={styles.stepperValue}>{maxPlayers}</div>
                    <GameButton accent onClick={() => stepPlayers(1)}>+</GameButton>
                </div>
            </div>

            <div className={styles.actions}>
                <GameButton onClick={startHosting}>Start Hosting</GameButton>
                <GameButton accent onClick={onClose}>Cancel</GameButton>
            </div>
        </Modal>
    )
}
