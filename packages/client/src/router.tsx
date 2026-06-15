import { createBrowserRouter } from "react-router-dom"
import Index from "./views/Index"
import Game from "./views/Game"
import MapEditor from "./views/MapEditor"
import MapLibrary from "./views/MapLibrary"

export const router = createBrowserRouter([
    { path: "/", element: <Index /> },
    // The Map Maker LIBRARY HOME (the Procreate/Docs-style card grid). The home
    // menu's Map Maker button lands here; a card opens the editor on a specific map.
    { path: "/maps", element: <MapLibrary /> },
    // The map editor lives at static paths so they are matched before the catch-all
    // "/:id" lobby route (more specific routes win in react-router). "/editor" opens
    // a fresh / autosaved draft (the original behaviour); "/editor/:mapName" opens a
    // SPECIFIC library map and autosaves back to that entry.
    { path: "/editor", element: <MapEditor /> },
    { path: "/editor/:mapName", element: <MapEditor /> },
    { path: "/:id", element: <Game /> },
])
