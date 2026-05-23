import { createBrowserRouter } from "react-router-dom"
import Index from "./views/Index"
import Game from "./views/Game"

export const router = createBrowserRouter([
    { path: "/", element: <Index /> },
    { path: "/:id", element: <Game /> },
])
