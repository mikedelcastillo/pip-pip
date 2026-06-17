import { useCallback, useEffect, useState } from "react"
import { RouterProvider } from "react-router-dom"
import GameLoading from "./components/GameLoading"
import AssetLoadError from "./components/AssetLoadError"
import AlertModal from "./components/AlertModal"
import { assetLoader, initAssets } from "./game/assets"
import { GAME_CONTEXT } from "./game"
import { shouldPlayClickFor } from "./game/audio"
import { createGamepadNav } from "./game/gamepadNav"
import { useUiStore } from "./store/ui"
import { useGameStore } from "./game/store"
import { router } from "./router"

export default function App() {
    const [loadedAssets, setLoadedAssets] = useState(false)
    const [loadError, setLoadError] = useState(false)
    // Bumped by the retry button to re-run the load effect in-app, so a failed
    // first download never falls back to a native alert/prompt.
    const [retryToken, setRetryToken] = useState(0)
    const setLoading = useUiStore((s) => s.setLoading)

    // App-wide UI click sound. The shared GAME_CONTEXT.audio used to come alive
    // only inside a match (mountGameView); here we drive it from the app root so
    // every button - home menu, lobby, in-match menus - gets the same soft tick.
    //
    // ONE document-level pointerdown listener covers desktop clicks AND mobile
    // taps in a single path (pointer events unify both), so there is no click +
    // touch double-fire. Browsers gate the AudioContext behind a user gesture,
    // and this IS that gesture, so we (re)init + resume right here. init and
    // resume are both idempotent, and play() no-ops on a suspended/closed
    // context, so this stays safe across a GameView mount/dispose cycle (leaving
    // a match disposes the context; the next tap recreates it).
    useEffect(() => {
        const onPointerDown = (event: PointerEvent) => {
            const audio = GAME_CONTEXT.audio
            audio.init()
            audio.resume()
            if (shouldPlayClickFor(event.target as Element | null)) {
                audio.play("uiClick")
            }
        }
        // pointerdown (not click) so the tick lands the instant the control is
        // pressed. Capture phase so a stopPropagation inside a button's own
        // handler cannot swallow it before we see it.
        document.addEventListener("pointerdown", onPointerDown, true)
        return () => document.removeEventListener("pointerdown", onPointerDown, true)
    }, [])

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            setLoadError(false)
            setLoading(true, "Starting download of assets...")
            try {
                await initAssets()
                await assetLoader.loadBundle([
                    "ui",
                    "ships",
                    "misc",
                    "art",
                ], (progress: number) => {
                    setLoading(true, `Downloaded ${Math.floor(progress * 100)}% of assets...`)
                })
                if (!cancelled) setLoadedAssets(true)
            } catch (e) {
                console.warn(e)
                if (!cancelled) setLoadError(true)
            }
            if (!cancelled) setLoading(false, "")
        })()
        return () => { cancelled = true }
    }, [setLoading, retryToken])

    // Gamepad UI navigation. A self-contained service polls the controller on an
    // animation-frame loop and drives UI focus (move/activate/back) whenever the
    // player is NOT in active in-match gameplay (a modal is open, the phase is not
    // MATCH, or there is no live game container). During a live match with no
    // modal open it stays out of the way so the gameplay controls in processInputs
    // own the stick and buttons. Phase is read live from the game store; the
    // service caches nothing across the gate so a phase change is picked up at
    // once. Started on mount, stopped on unmount.
    useEffect(() => {
        const nav = createGamepadNav({
            getPhase: () => useGameStore.getState().phase,
            // The mid-match loadout overlay is not a Modal (no backdrop), so feed
            // its open state in directly: the gate must open for it too, or a
            // controller could not reach its Deploy/Spectate buttons.
            loadoutOpen: () => useUiStore.getState().showLoadout,
        })
        nav.start()
        return () => nav.stop()
    }, [])

    const retry = useCallback(() => setRetryToken((n) => n + 1), [])

    return <>
        {loadedAssets && <RouterProvider router={router} />}
        {loadError && <AssetLoadError onRetry={retry} />}
        <GameLoading />
        <AlertModal />
    </>
}
