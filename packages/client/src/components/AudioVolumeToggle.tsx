import GameButton from "./GameButton"
import { useUiStore } from "../store/ui"

interface Props {
    className?: string
}

// Uses the shared GameButton so the mute control matches the game's branding
// (the 3D layered button), instead of being a one-off flat pill. Accent =
// sound on; plain = muted.
export default function AudioVolumeToggle({ className }: Props) {
    const muted = useUiStore((s) => s.audioMuted)
    const toggleAudioMuted = useUiStore((s) => s.toggleAudioMuted)

    return (
        <GameButton onClick={toggleAudioMuted} accent={!muted} className={className}>
            {muted ? "SFX OFF" : "SFX ON"}
        </GameButton>
    )
}
