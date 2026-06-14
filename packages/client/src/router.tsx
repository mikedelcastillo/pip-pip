import { createBrowserRouter } from "react-router-dom"
import Index from "./views/Index"
import Game from "./views/Game"
import MapEditor from "./views/MapEditor"

export const router = createBrowserRouter([
    { path: "/", element: <Index /> },
    // The homepage map editor lives at a static path so it is matched before the
    // catch-all "/:id" lobby route (more specific routes win in react-router).
    { path: "/editor", element: <MapEditor /> },
    { path: "/:id", element: <Game /> },
])
