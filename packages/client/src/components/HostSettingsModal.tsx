import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { CACHE_NAME_KEY } from "@pip-pip/game/src/logic/utils"
import { PipPipGameMode } from "@pip-pip/game/src/logic"
import { GAME_CONTEXT } from "../game"
import { useUiStore } from "../store/ui"
import { showAlert } from "../store/alert"
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

// DEATHMATCH kills-to-win bounds (uint8 on the wire, so the cap stays well under
// 255) and the KILL_FRENZY match-length bounds in whole minutes.
const MIN_KILLS = 5
const MAX_KILLS = 50
const MIN_MINUTES = 1
const MAX_MINUTES = 10

const clampKills = (value: number) =>
    Math.max(MIN_KILLS, Math.min(MAX_KILLS, value))

const clampMinutes = (value: number) =>
    Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, value))

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
    const [mode, setMode] = useState<PipPipGameMode>(PipPipGameMode.DEATHMATCH)
    const [killsToWin, setKillsToWin] = useState(25)
    const [matchMinutes, setMatchMinutes] = useState(3)

    const isFrenzy = mode === PipPipGameMode.KILL_FRENZY
    const isTeam = mode === PipPipGameMode.TEAM_DEATHMATCH
    // TEAM_DEATHMATCH reuses the DEATHMATCH kills-to-win stepper bounds, so both
    // share the kills target (and neither reads matchMinutes).
    const usesKills = !isFrenzy

    const stepPlayers = (delta: number) =>
        setMaxPlayers((current) => clampPlayers(current + delta))
    const stepKills = (delta: number) =>
        setKillsToWin((current) => clampKills(current + delta))
    const stepMinutes = (delta: number) =>
        setMatchMinutes((current) => clampMinutes(current + delta))

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
                // Mode + its relevant target. The server applies these to
                // game.settings; DEATHMATCH only reads maxKills, KILL_FRENZY only
                // reads matchMinutes, so sending both is harmless.
                mode,
                maxKills: killsToWin,
                matchMinutes,
            })
            navigate(`/${lobby.lobbyId}`)
        } catch (e) {
            console.warn(e)
            showAlert("Could not host a game!", "Could not host")
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
                <div className={styles.sectionTitle}>Mode</div>
                <div className={styles.toggleRow}>
                    <GameButton
                        accent={mode === PipPipGameMode.DEATHMATCH}
                        onClick={() => setMode(PipPipGameMode.DEATHMATCH)}
                    >
                        Deathmatch
                    </GameButton>
                    <GameButton
                        accent={isFrenzy}
                        onClick={() => setMode(PipPipGameMode.KILL_FRENZY)}
                    >
                        Kill Frenzy
                    </GameButton>
                    <GameButton
                        accent={isTeam}
                        onClick={() => setMode(PipPipGameMode.TEAM_DEATHMATCH)}
                    >
                        Team Deathmatch
                    </GameButton>
                </div>
                <div className={styles.hint}>
                    {isFrenzy
                        ? "Timed match. Most kills when the clock runs out wins."
                        : isTeam
                            ? "Two teams, friendly fire off. First team to the kill target wins. Needs at least 2 players."
                            : "Free-for-all. First to the kill target wins."}
                </div>
            </div>

            {usesKills ? (
                <div className={styles.section}>
                    <div className={styles.sectionTitle}>Kills to Win</div>
                    <div className={styles.stepperRow}>
                        <GameButton accent onClick={() => stepKills(-5)}>-</GameButton>
                        <div className={styles.stepperValue}>{killsToWin}</div>
                        <GameButton accent onClick={() => stepKills(5)}>+</GameButton>
                    </div>
                </div>
            ) : (
                <div className={styles.section}>
                    <div className={styles.sectionTitle}>Match Length (min)</div>
                    <div className={styles.stepperRow}>
                        <GameButton accent onClick={() => stepMinutes(-1)}>-</GameButton>
                        <div className={styles.stepperValue}>{matchMinutes}</div>
                        <GameButton accent onClick={() => stepMinutes(1)}>+</GameButton>
                    </div>
                </div>
            )}

            <div className={styles.section}>
                <div className={styles.sectionTitle}>Visibility</div>
                <div className={styles.toggleRow}>
                    <GameButton
                        accent={isPublic}
                        onClick={() => setIsPublic(true)}
                    >
                        Public
                    </GameButton>
                    <GameButton
                        accent={!isPublic}
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
