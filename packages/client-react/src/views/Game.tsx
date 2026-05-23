import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { GAME_CONTEXT } from "../game"
import { useUiStore } from "../store/ui"
import GameView from "../components/GameView"

export default function Game() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const setLoading = useUiStore((s) => s.setLoading)
    const [ready, setReady] = useState(false)

    useEffect(() => {
        if (!id) return
        let cancelled = false
        ;(async () => {
            setLoading(true, "Connecting...")
            try {
                await GAME_CONTEXT.client.connect()
                setLoading(true, "Joining lobby...")
                await GAME_CONTEXT.client.joinLobby(id)
                if (!cancelled) setReady(true)
            } catch (e) {
                console.warn(e)
                alert("Could not join lobby.")
                navigate("/")
            }
            setLoading(false, "")
        })()
        return () => { cancelled = true }
    }, [id, navigate, setLoading])

    return ready ? <GameView /> : null
}
