import * as PIXI from "pixi.js"
PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST

import ReactDOM from "react-dom/client"
import App from "./App"
import { GAME_CONTEXT } from "./game"

import "./styles/global.sass"

GAME_CONTEXT.initialize()

ReactDOM.createRoot(document.getElementById("app")!).render(<App />)
