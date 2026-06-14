import { useState } from "react"
import { PipPipGameMode, BotDifficultyChoice } from "@pip-pip/game/src/logic"
import { BotDifficulty } from "@pip-pip/game/src/logic/ai"
import { GAME_CONTEXT } from "../game"
import { useGameStore } from "../game/store"
import GameButton from "./GameButton"
import styles from "./BotsControls.module.sass"

// The host-only "Bots" section, shared by the lobby Match panel (GameOverlaySetup)
// and the pre-host dialog (HostSettingsModal). It shows the live bot count, a
// difficulty selector (Easy / Medium / Hard / Mixed), and Add (+1) / Remove (-1) /
// Fill / Clear buttons. Every button just calls a GAME_CONTEXT method, which sends
// the hostBots packet; the server is authoritative, so the count shown here comes
// straight from the store (mirrored from the networked players).
//
// The difficulty is the host's CHOICE for newly-added bots ("mixed" rolls one per
// bot); it is local UI state, not networked, since it only decides what the next
// add/fill requests.

// The selectable difficulty choices, in display order. "Mixed" is a config-only
// choice (each added bot rolls its own concrete difficulty server-side).
const DIFFICULTY_OPTIONS: { label: string, value: BotDifficultyChoice }[] = [
    { label: "Easy", value: BotDifficulty.EASY },
    { label: "Medium", value: BotDifficulty.MEDIUM },
    { label: "Hard", value: BotDifficulty.HARD },
    { label: "Mixed", value: "mixed" },
]

export default function BotsControls() {
    const botCount = useGameStore((s) => s.botCount)
    const mode = useGameStore((s) => s.mode)
    const isTeam = mode === PipPipGameMode.TEAM_DEATHMATCH

    const [difficulty, setDifficulty] = useState<BotDifficultyChoice>("mixed")

    const addOne = () => GAME_CONTEXT.addBots(1, difficulty)
    const removeOne = () => GAME_CONTEXT.removeBots(1)
    const fill = () => GAME_CONTEXT.fillBots(difficulty)
    const clear = () => GAME_CONTEXT.clearBots()

    return (
        <div className={styles.bots}>
            <div className={styles.countRow}>
                <span className={styles.countLabel}>Bots</span>
                <span className={styles.countValue}>{botCount}</span>
            </div>

            <div className={styles.difficultyRow}>
                {DIFFICULTY_OPTIONS.map((option) => (
                    <GameButton
                        key={String(option.value)}
                        accent={difficulty === option.value}
                        onClick={() => setDifficulty(option.value)}
                    >
                        {option.label}
                    </GameButton>
                ))}
            </div>

            <div className={styles.actionRow}>
                <GameButton accent onClick={addOne}>Add</GameButton>
                <GameButton accent onClick={removeOne}>Remove</GameButton>
                <GameButton accent onClick={fill}>Fill</GameButton>
                <GameButton accent onClick={clear}>Clear</GameButton>
            </div>

            <div className={styles.hint}>
                {isTeam
                    ? "Bots fill team spots and balance the two sides."
                    : "Bots fill out the lobby for a livelier match."}
            </div>
        </div>
    )
}
