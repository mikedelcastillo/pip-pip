import { useMemo, useState } from "react"
import { PipPipGameMode } from "@pip-pip/game/src/logic"
import { GAME_CONTEXT } from "../game"
import { useGameStore } from "../game/store"
import { readyTally } from "../game/ready"
import GameButton from "./GameButton"
import GamePlayerList from "./GamePlayerList"
import GameChat from "./GameChat"
import ShipSelect from "./ShipSelect"
import MapSelect from "./MapSelect"
import LobbyMenu from "./LobbyMenu"
import BotsControls from "./BotsControls"
import styles from "./GameOverlaySetup.module.sass"

// Mode-target bounds + steps, mirrored from HostSettingsModal so the lobby and
// the host dialog agree (the server re-clamps to the same range).
const MIN_KILLS = 5
const MAX_KILLS = 50
const KILLS_STEP = 5
const MIN_MINUTES = 1
const MAX_MINUTES = 10
const DEFAULT_KILLS = 25
const DEFAULT_MINUTES = 3

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

// Read-only summary of the lobby's mode for the header badge. DEATHMATCH shows
// its kill target; KILL_FRENZY shows its match length.
function modeBadge(mode: PipPipGameMode, maxKills: number, matchMinutes: number): { name: string, detail: string } {
    if (mode === PipPipGameMode.KILL_FRENZY) {
        return { name: "Kill Frenzy", detail: `${matchMinutes || DEFAULT_MINUTES} min` }
    }
    if (mode === PipPipGameMode.TEAM_DEATHMATCH) {
        return { name: "Team Deathmatch", detail: maxKills > 0 ? `First team to ${maxKills}` : "Teams" }
    }
    return { name: "Deathmatch", detail: maxKills > 0 ? `First to ${maxKills}` : "Free for all" }
}

// One-page lobby, laid out like a console party-game menu (Apex / Krunker feel):
//   header ....... LOBBY kicker + mode badge on the left, Settings + Leave on the right
//   body ......... Match (mode), Your Ship, Map, and Players + chat panels
//   action bar ... Spectate toggle + the host's Start Game (sticky at the bottom)
// Everything lives in normal flex/grid flow (no absolutely-pinned corner buttons
// over the content) so nothing overlaps, and the header/footer stay reachable by
// thumb on a phone. SFX moved into Settings (the gear). The Match panel lets the
// host switch mode in the lobby so players never have to re-host to change it.
export default function GameOverlaySetup() {
    const isHost = useGameStore((s) => s.isHost)
    const players = useGameStore((s) => s.players)
    const spectating = useGameStore((s) => s.clientSpectating)
    const mode = useGameStore((s) => s.mode)
    const maxKills = useGameStore((s) => s.maxKills)
    const matchMinutes = useGameStore((s) => s.matchMinutes)

    // The hamburger menu tucks Settings, Leave and (host) Close Lobby away so the
    // header stays uncluttered; Close Lobby confirms via a modal inside it.
    const [menuOpen, setMenuOpen] = useState(false)

    const badge = useMemo(() => modeBadge(mode, maxKills, matchMinutes), [mode, maxKills, matchMinutes])
    const isFrenzy = mode === PipPipGameMode.KILL_FRENZY
    const isTeam = mode === PipPipGameMode.TEAM_DEATHMATCH
    // KILL_FRENZY steps the match clock; DEATHMATCH + TEAM_DEATHMATCH step the
    // (shared) kills-to-win target.
    const usesKills = !isFrenzy

    // Always send a sane pair so neither target is lost on a switch (the store
    // values come from the server, but guard the degenerate 0 just in case).
    const safeKills = maxKills > 0 ? maxKills : DEFAULT_KILLS
    const safeMinutes = matchMinutes > 0 ? matchMinutes : DEFAULT_MINUTES

    const pickMode = (next: PipPipGameMode) => {
        if (!isHost) return
        GAME_CONTEXT.setGameMode(next, safeKills, safeMinutes)
    }
    const stepTarget = (delta: number) => {
        if (!isHost) return
        if (isFrenzy) {
            GAME_CONTEXT.setGameMode(mode, safeKills, clamp(safeMinutes + delta, MIN_MINUTES, MAX_MINUTES))
        } else {
            GAME_CONTEXT.setGameMode(mode, clamp(safeKills + delta * KILLS_STEP, MIN_KILLS, MAX_KILLS), safeMinutes)
        }
    }

    const startGame = () => GAME_CONTEXT.startGame()
    const toggleSpectate = () => GAME_CONTEXT.toggleSpectator()

    // Lobby "ready up" state. The client player's own ready drives the non-host
    // footer toggle; the host id (the player flagged isHost in the store) feeds
    // the ready tally the host sees next to Start Game. readyTally excludes the
    // host + spectators, so it counts only the players the host is waiting on.
    // Ready is purely social: the host still starts with no readiness gate.
    const ready = players.find((p) => p.isClient)?.ready ?? false
    const hostId = players.find((p) => p.isHost)?.id ?? ""
    const tally = useMemo(() => readyTally(players, hostId), [players, hostId])
    const toggleReady = () => GAME_CONTEXT.setReady(!ready)

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
                        {/* Single hamburger: Settings, Leave and (host) Close
                            Lobby all live inside the menu so the header is tidy. */}
                        <button
                            type="button"
                            className={styles.iconButton}
                            aria-label="Menu"
                            onClick={() => setMenuOpen(true)}
                        >
                            &#9776;
                        </button>
                    </div>
                </header>

                <main className={styles.body}>
                    <section className={`${styles.panel} ${styles.matchPanel}`}>
                        <div className={styles.panelHead}>
                            <h2 className={styles.panelTitle}>Match</h2>
                            {!isHost && <span className={styles.panelNote}>Host sets</span>}
                        </div>
                        <div className={styles.panelBody}>
                            {isHost ? (
                                <>
                                    <div className={styles.modeButtons}>
                                        <GameButton
                                            accent={mode === PipPipGameMode.DEATHMATCH}
                                            onClick={() => pickMode(PipPipGameMode.DEATHMATCH)}
                                        >
                                            Deathmatch
                                        </GameButton>
                                        <GameButton
                                            accent={isFrenzy}
                                            onClick={() => pickMode(PipPipGameMode.KILL_FRENZY)}
                                        >
                                            Kill Frenzy
                                        </GameButton>
                                        <GameButton
                                            accent={isTeam}
                                            onClick={() => pickMode(PipPipGameMode.TEAM_DEATHMATCH)}
                                        >
                                            Team Deathmatch
                                        </GameButton>
                                    </div>
                                    <div className={styles.targetRow}>
                                        <span className={styles.targetLabel}>
                                            {usesKills ? "Kills to Win" : "Match Minutes"}
                                        </span>
                                        <div className={styles.stepper}>
                                            <GameButton accent onClick={() => stepTarget(-1)}>-</GameButton>
                                            <div className={styles.stepperValue}>
                                                {usesKills ? safeKills : safeMinutes}
                                            </div>
                                            <GameButton accent onClick={() => stepTarget(1)}>+</GameButton>
                                        </div>
                                    </div>
                                    <div className={styles.botsRow}>
                                        <BotsControls />
                                    </div>
                                </>
                            ) : (
                                <div className={styles.modeReadonly}>
                                    <div className={styles.modeReadonlyName}>{badge.name}</div>
                                    <div className={styles.modeReadonlyDetail}>{badge.detail}</div>
                                </div>
                            )}
                            <div className={styles.modeHint}>
                                {isFrenzy
                                    ? "Most kills when the clock runs out wins."
                                    : isTeam
                                        ? "Two teams, friendly fire off. First team to the kill target wins. Needs at least 2 players."
                                        : "Free-for-all. First to the kill target wins."}
                            </div>
                        </div>
                    </section>

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
                            <span className={styles.startLabel}>Start Game</span>
                            {tally.total > 0 && (
                                <span className={styles.readyCount}>
                                    {tally.ready}/{tally.total} ready
                                </span>
                            )}
                        </GameButton>
                    ) : (
                        <GameButton
                            accent={ready}
                            onClick={toggleReady}
                            className={styles.readyBtn}
                        >
                            {ready ? "Ready ✓" : "Ready"}
                        </GameButton>
                    )}
                </footer>
            </div>

            {menuOpen && <LobbyMenu onClose={() => setMenuOpen(false)} />}
        </div>
    )
}
