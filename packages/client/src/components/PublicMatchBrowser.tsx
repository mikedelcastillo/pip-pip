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

// The "3 / 8" players label. Pulled out as a pure helper so the formatting (the
// spaced slash that reads well in the dense list) is unit-testable without
// rendering the whole browser.
export function formatPlayerCount(playerCount: number, maxPlayers: number) {
    return `${playerCount} / ${maxPlayers}`
}

// How full a lobby is, 0..1, used to colour the players badge as it nears
// capacity (cool when empty, amber as it fills, red when full). Clamped and
// guarded against a zero/negative max so a malformed lobby never divides by zero
// or pushes the badge past full.
export function fillFraction(playerCount: number, maxPlayers: number) {
    if (maxPlayers <= 0) return 1
    const fraction = playerCount / maxPlayers
    if (fraction < 0) return 0
    if (fraction > 1) return 1
    return fraction
}

// Map the fill fraction to one of three badge states. Plain strings (not the
// styles map) so the mapping is testable in the plain-node suite without the
// sass stub, and the .sass colours each [data-state] independently.
export function fillState(fraction: number): "open" | "busy" | "full" {
    if (fraction >= 1) return "full"
    if (fraction >= 0.7) return "busy"
    return "open"
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

    // The existing join flow: navigating to /:lobbyId is what joins a match, so
    // the row tap and the desktop Join hint both route through here unchanged.
    const join = (lobbyId: string) => navigate(`/${lobbyId}`)

    let body
    if (loading) {
        body = (
            <div className={styles.state}>
                {/* Three pulsing dots reuse the game's amber accent for a tasteful,
                    on-brand loading beat rather than pulling in a spinner asset. */}
                <div className={styles.loader}>
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
                <div className={styles.stateText}>Searching for matches...</div>
            </div>
        )
    } else if (error) {
        body = (
            <div className={styles.state}>
                <div className={styles.stateTitle}>Connection lost</div>
                <div className={styles.stateText}>
                    Could not load public matches. Try refreshing.
                </div>
            </div>
        )
    } else if (lobbies.length === 0) {
        body = (
            <div className={styles.state}>
                <div className={styles.stateTitle}>No public matches</div>
                <div className={styles.stateText}>
                    Nobody is hosting right now. Host one!
                </div>
            </div>
        )
    } else {
        body = (
            <div className={styles.list}>
                {lobbies.map((lobby) => {
                    const fraction = fillFraction(lobby.playerCount, lobby.maxPlayers)
                    const state = fillState(fraction)
                    const full = state === "full"
                    return (
                        // The whole row is the tap target (ideal for touch); the
                        // desktop Join hint on the right is a secondary affordance
                        // that routes through the same handler.
                        <button
                            type="button"
                            className={styles.row}
                            key={lobby.lobbyId}
                            onClick={() => join(lobby.lobbyId)}
                        >
                            <div className={styles.info}>
                                <div className={styles.name}>{lobby.lobbyName}</div>
                                <div className={styles.meta}>
                                    <span className={styles.host}>{lobby.hostName}</span>
                                    <span className={styles.dot}>•</span>
                                    <span className={styles.map}>{lobby.mapLabel}</span>
                                </div>
                            </div>
                            <div className={styles.right}>
                                <div className={styles.badge} data-state={state}>
                                    <span className={styles.badgeCount}>
                                        {formatPlayerCount(
                                            lobby.playerCount,
                                            lobby.maxPlayers,
                                        )}
                                    </span>
                                    {/* Thin fill bar under the count: an at-a-glance
                                        read of how full the match is. */}
                                    <span className={styles.badgeBar}>
                                        <span
                                            className={styles.badgeBarFill}
                                            style={{ width: `${fraction * 100}%` }}
                                        ></span>
                                    </span>
                                </div>
                                <span className={styles.joinHint}>
                                    {full ? "Full" : "Join"}
                                </span>
                            </div>
                        </button>
                    )
                })}
            </div>
        )
    }

    // The live count of open (not-yet-full) matches, mirroring a real server
    // browser's "N servers" readout. Only meaningful on a clean, loaded list.
    const openCount = lobbies.filter(
        (lobby) => fillFraction(lobby.playerCount, lobby.maxPlayers) < 1,
    ).length

    return (
        <Modal title="Public Matches" onClose={onClose}>
            <div className={styles.browser}>
                <div className={styles.toolbar}>
                    <div className={styles.tally}>
                        {loading || error ? (
                            <span className={styles.tallyDim}>
                                {error ? "Offline" : "Scanning..."}
                            </span>
                        ) : (
                            <>
                                <span className={styles.tallyNum}>{openCount}</span>
                                <span className={styles.tallyLabel}>
                                    {openCount === 1 ? "open match" : "open matches"}
                                </span>
                            </>
                        )}
                    </div>
                    <GameButton accent onClick={refresh}>Refresh</GameButton>
                </div>
                {body}
            </div>
        </Modal>
    )
}
