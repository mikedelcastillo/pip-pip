import * as PIXI from "pixi.js"
PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST

import ReactDOM from "react-dom/client"
import App from "./App"
import { GAME_CONTEXT } from "./game"
import { initAnalytics } from "./analytics"

import "./styles/global.sass"

// Optional GA4. No-op unless VITE_GA_MEASUREMENT_ID was set at build time.
initAnalytics()

GAME_CONTEXT.initialize()

ReactDOM.createRoot(document.getElementById("app")!).render(<App />)
