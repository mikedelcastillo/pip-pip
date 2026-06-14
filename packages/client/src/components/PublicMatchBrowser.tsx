import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import type { PublicLobbyJSON } from "@pip-pip/core/src/networking/api/types"
import { GAME_CONTEXT } from "../game"
import Modal from "./Modal"
import GameButton from "./GameButton"
import styles from "./PublicMatchBrowser.module.sass"

interface Props {
    onClose: () => void
}

export default function PublicMatchBrowser({ onClose }: Props) {
    const navigate = useNavigate()

    const [lobbies, setLobbies] = useState<PublicLobbyJSON[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)

    const refresh = useCallback(async () => {
        setLoading(true)
        setError(false)
        try {
            const result = await GAME_CONTEXT.client.listPublicLobbies()
            // Newest matches first so freshly hosted lobbies surface at the top.
            const sorted = [...result].sort((a, b) => b.createdAt - a.createdAt)
            setLobbies(sorted)
        } catch (e) {
            console.warn(e)
            setError(true)
        }
        setLoading(false)
    }, [])

    useEffect(() => {
        refresh()
    }, [refresh])

    const join = (lobbyId: string) => navigate(`/${lobbyId}`)

    let body
    if (loading) {
        body = <div className={styles.message}>Searching for matches...</div>
    } else if (error) {
        body = (
            <div className={styles.message}>
                Could not load public matches. Try refreshing.
            </div>
        )
    } else if (lobbies.length === 0) {
        body = (
            <div className={styles.message}>No public matches. Host one!</div>
        )
    } else {
        body = (
            <div className={styles.list}>
                {lobbies.map((lobby) => {
                    const full = lobby.playerCount >= lobby.maxPlayers
                    return (
                        <div
                            className={styles.row}
                            key={lobby.lobbyId}
                            onClick={() => join(lobby.lobbyId)}
                        >
                            <div className={styles.info}>
                                <div className={styles.name}>{lobby.lobbyName}</div>
                                <div className={styles.meta}>
                                    <span>{lobby.hostName}</span>
                                    <span className={styles.dot}>•</span>
                                    <span>{lobby.mapLabel}</span>
                                </div>
                            </div>
                            <div className={styles.right}>
                                <div className={styles.count}>
                                    {lobby.playerCount}/{lobby.maxPlayers}
                                </div>
                                <GameButton onClick={() => join(lobby.lobbyId)}>
                                    {full ? "Full" : "Join"}
                                </GameButton>
                            </div>
                        </div>
                    )
                })}
            </div>
        )
    }

    return (
        <Modal title="Public Matches" onClose={onClose}>
            <div className={styles.toolbar}>
                <GameButton accent onClick={refresh}>Refresh</GameButton>
            </div>
            {body}
        </Modal>
    )
}
