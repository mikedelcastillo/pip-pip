import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { GAME_CONTEXT } from "../game"
import { useUiStore } from "../store/ui"
import GameView from "../components/GameView"
import LobbyNotFound from "../components/LobbyNotFound"

interface Failure {
    notFound: boolean
}

// Axios rejects with a response when the server answers (e.g. 400 "Lobby not
// found."); a missing response means we never reached/joined the lobby at all.
function isLobbyNotFound(e: unknown): boolean {
    const status = (e as { response?: { status?: number } })?.response?.status
    return status === 404 || status === 400
}

export default function Game() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const setLoading = useUiStore((s) => s.setLoading)
    const [ready, setReady] = useState(false)
    const [failure, setFailure] = useState<Failure | null>(null)
    const [attempt, setAttempt] = useState(0)

    useEffect(() => {
        if (!id) return
        let cancelled = false
        ;(async () => {
            setFailure(null)
            setLoading(true, "Connecting...")
            try {
                await GAME_CONTEXT.client.connect()
                setLoading(true, "Joining lobby...")
                await GAME_CONTEXT.client.joinLobby(id)
                if (!cancelled) setReady(true)
            } catch (e) {
                console.warn(e)
                if (!cancelled) setFailure({ notFound: isLobbyNotFound(e) })
            }
            setLoading(false, "")
        })()
        return () => { cancelled = true }
    }, [id, attempt, setLoading])

    const goHome = useCallback(() => navigate("/"), [navigate])
    const retry = useCallback(() => setAttempt((a) => a + 1), [])

    if (failure) {
        return (
            <LobbyNotFound
                code={id}
                notFound={failure.notFound}
                onHome={goHome}
                onRetry={retry}
            />
        )
    }

    return ready ? <GameView /> : null
}
