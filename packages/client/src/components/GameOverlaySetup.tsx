import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { PipPipGameMode } from "@pip-pip/game/src/logic"
import { GAME_CONTEXT } from "../game"
import { useGameStore } from "../game/store"
import GameButton from "./GameButton"
import GamePlayerList from "./GamePlayerList"
import GameChat from "./GameChat"
import ShipSelect from "./ShipSelect"
import MapSelect from "./MapSelect"
import SettingsModal from "./SettingsModal"
import styles from "./GameOverlaySetup.module.sass"

// Read-only summary of the lobby's mode (set at host time). DEATHMATCH shows its
// kill target; KILL_FRENZY is timed so it has no in-lobby number to show.
function modeBadge(mode: PipPipGameMode, maxKills: number): { name: string, detail: string } {
    if (mode === PipPipGameMode.KILL_FRENZY) {
        return { name: "Kill Frenzy", detail: "Most kills wins" }
    }
    return { name: "Deathmatch", detail: maxKills > 0 ? `First to ${maxKills}` : "Free for all" }
}

// One-page lobby, laid out like a console party-game menu (Apex / Krunker feel):
//   header ....... LOBBY kicker + mode badge on the left, Settings + Leave on the right
//   body ......... three panels - your Ship, the Map, and Players + chat
//   action bar ... Spectate toggle + the host's Start Game (sticky at the bottom)
// Everything lives in normal flex/grid flow (no absolutely-pinned corner buttons
// over the content) so nothing overlaps, and the header/footer stay reachable by
// thumb on a phone. SFX moved into Settings (the gear), so it is no longer a
// loose floating toggle.
export default function GameOverlaySetup() {
    const isHost = useGameStore((s) => s.isHost)
    const players = useGameStore((s) => s.players)
    const spectating = useGameStore((s) => s.clientSpectating)
    const mode = useGameStore((s) => s.mode)
    const maxKills = useGameStore((s) => s.maxKills)

    const [settingsOpen, setSettingsOpen] = useState(false)
    const navigate = useNavigate()

    const badge = useMemo(() => modeBadge(mode, maxKills), [mode, maxKills])

    const startGame = () => GAME_CONTEXT.startGame()
    const toggleSpectate = () => GAME_CONTEXT.toggleSpectator()
    const leave = () => navigate("/")

    return (
        <div className="game-overlay">
            <div className={styles.lobby}>
                <header className={styles.topBar}>
                    <div className={styles.brand}>
                        <div className={styles.kicker}>Lobby</div>
                        <div className={styles.modeBadge}>
                            <span className={styles.modeName}>{badge.name}</span>
                            <span className={styles.modeDetail}>{badge.detail}</span>
                        </div>
                    </div>
                    <div className={styles.topActions}>
                        <button
                            type="button"
                            className={styles.iconButton}
                            aria-label="Settings"
                            onClick={() => setSettingsOpen(true)}
                        >
                            &#9881;
                        </button>
                        <button
                            type="button"
                            className={styles.leaveButton}
                            aria-label="Leave lobby"
                            onClick={leave}
                        >
                            Leave
                        </button>
                    </div>
                </header>

                <main className={styles.body}>
                    <section className={`${styles.panel} ${styles.shipPanel}`}>
                        <div className={styles.panelHead}>
                            <h2 className={styles.panelTitle}>Your Ship</h2>
                        </div>
                        <div className={styles.panelBody}>
                            <ShipSelect />
                        </div>
                    </section>

                    <section className={`${styles.panel} ${styles.mapPanel}`}>
                        <div className={styles.panelHead}>
                            <h2 className={styles.panelTitle}>Map</h2>
                            {!isHost && <span className={styles.panelNote}>Host picks</span>}
                        </div>
                        <div className={styles.panelBody}>
                            <MapSelect />
                        </div>
                    </section>

                    <section className={`${styles.panel} ${styles.playersPanel}`}>
                        <div className={styles.panelHead}>
                            <h2 className={styles.panelTitle}>Players</h2>
                            <span className={styles.count}>{players.length}</span>
                        </div>
                        <div className={styles.panelBody}>
                            <GamePlayerList />
                            <div className={styles.chatDock}>
                                <GameChat />
                            </div>
                        </div>
                    </section>
                </main>

                <footer className={styles.actionBar}>
                    <GameButton
                        accent={spectating}
                        onClick={toggleSpectate}
                        className={styles.spectateBtn}
                    >
                        {spectating ? "Spectating ✓" : "Spectate"}
                    </GameButton>
                    {isHost ? (
                        <GameButton onClick={startGame} className={styles.startBtn}>
                            Start Game
                        </GameButton>
                    ) : (
                        <div className={styles.waiting}>Waiting for host...</div>
                    )}
                </footer>
            </div>

            {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
        </div>
    )
}
