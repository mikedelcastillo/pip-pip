import { useEffect, useState } from "react"
import { RouterProvider } from "react-router-dom"
import GameLoading from "./components/GameLoading"
import { assetLoader } from "./game/assets"
import { useUiStore } from "./store/ui"
import { router } from "./router"

export default function App() {
    const [loadedAssets, setLoadedAssets] = useState(false)
    const setLoading = useUiStore((s) => s.setLoading)

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            setLoading(true, "Staring download of assets...")
            try {
                await assetLoader.loadBundle([
                    "ui",
                    "ships",
                    "misc",
                ], (progress: number) => {
                    setLoading(true, `Downloaded ${Math.floor(progress * 100)}% of assets...`)
                })
                if (!cancelled) setLoadedAssets(true)
            } catch (e) {
                alert("Could not load assets :(")
                if (prompt("Try again?")) window.location.reload()
                console.warn(e)
            }
            setLoading(false, "")
        })()
        return () => { cancelled = true }
    }, [setLoading])

    return <>
        {loadedAssets && <RouterProvider router={router} future={{ v7_startTransition: true }} />}
        <GameLoading />
    </>
}
