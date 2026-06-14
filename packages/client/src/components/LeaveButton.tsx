import { useNavigate } from "react-router-dom"
import GameButton from "./GameButton"

interface Props {
    className?: string
}

// Leaves the current lobby/match and returns to the home screen. Navigating to
// "/" unmounts GameView, whose cleanup tears down the renderer and disconnects
// the client (see GameView.tsx / Game.tsx), so no extra teardown is needed here.
// Reachable on both desktop (click) and mobile (tap) since it is a GameButton.
export default function LeaveButton({ className }: Props) {
    const navigate = useNavigate()
    return (
        <GameButton className={className} onClick={() => navigate("/")}>
            Leave
        </GameButton>
    )
}
