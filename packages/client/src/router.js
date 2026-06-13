import { jsx as _jsx } from "react/jsx-runtime";
import { createBrowserRouter } from "react-router-dom";
import Index from "./views/Index";
import Game from "./views/Game";
export const router = createBrowserRouter([
    { path: "/", element: _jsx(Index, {}) },
    { path: "/:id", element: _jsx(Game, {}) },
]);
//# sourceMappingURL=router.js.map