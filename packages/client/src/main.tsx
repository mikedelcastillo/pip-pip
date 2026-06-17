import { TextureSource } from "pixi.js"

// Pixel-art ships/tiles: default every texture to nearest-neighbour scaling.
// Pixi 8 dropped the global PIXI.settings in favour of per-source defaults.
TextureSource.defaultOptions.scaleMode = "nearest"

import ReactDOM from "react-dom/client"
import App from "./App"
import { GAME_CONTEXT } from "./game"
import { initAnalytics } from "./analytics"

import "./styles/global.sass"

// Optional GA4. No-op unless VITE_GA_MEASUREMENT_ID was set at build time.
initAnalytics()

GAME_CONTEXT.initialize()

ReactDOM.createRoot(document.getElementById("app")!).render(<App />)
