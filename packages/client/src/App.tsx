import { useCallback, useEffect, useState } from "react"
import { RouterProvider } from "react-router-dom"
import GameLoading from "./components/GameLoading"
import AssetLoadError from "./components/AssetLoadError"
import AlertModal from "./components/AlertModal"
import { assetLoader } from "./game/assets"
import { useUiStore } from "./store/ui"
import { router } from "./router"

export default function App() {
    const [loadedAssets, setLoadedAssets] = useState(false)
    const [loadError, setLoadError] = useState(false)
    // Bumped by the retry button to re-run the load effect in-app, so a failed
    // first download never falls back to a native alert/prompt.
    const [retryToken, setRetryToken] = useState(0)
    const setLoading = useUiStore((s) => s.setLoading)

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            setLoadError(false)
            setLoading(true, "Starting download of assets...")
            try {
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

    const retry = useCallback(() => setRetryToken((n) => n + 1), [])

    return <>
        {loadedAssets && <RouterProvider router={router} future={{ v7_startTransition: true }} />}
        {loadError && <AssetLoadError onRetry={retry} />}
        <GameLoading />
        <AlertModal />
    </>
}
