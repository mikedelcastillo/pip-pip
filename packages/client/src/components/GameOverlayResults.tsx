import { useMemo } from "react"
import { useGameStore } from "../game/store"
import type { GameStorePlayer } from "../game/store"
import { shipAssets } from "../game/assets"
import GameChat from "./GameChat"
import GamePlayerList from "./GamePlayerList"
import styles from "./GameOverlayResults.module.sass"

// Headline text for the end-of-match screen, driven purely by the mirrored
// result. winnerCount: 0 = nobody scored / "Time!"; 1 = a clean winner; >1 = a
// tie. Kept tiny and pure so the component is easy to follow.
function resultHeadline(winnerName: string, winnerCount: number): string {
    if (winnerCount > 1) return "It is a tie!"
    if (winnerCount === 1 && winnerName.length > 0) return `${winnerName} wins!`
    return "Time!"
}

// Pure podium selector: the top 3 players to crown on the results screen, most
// kills first. Spectators are dropped (they are not in the running) and so are
// zero-kill players (an empty podium reads cleaner than crowning a 0-kill name).
// Ties are STABLE: equal-kill players keep their incoming order, which is itself
// stable across syncs, so a re-sort never reshuffles the podium. Returns 0..3
// players, so callers must handle a short podium (1 or 2 survivors, or none).
// Kept pure (no store/DOM access) so it is trivially unit-testable.
export function podiumTop(players: GameStorePlayer[]): GameStorePlayer[] {
    return players
        .filter((player) => !player.spectator && player.score.kills > 0)
        // Stable sort by kills desc: Array.prototype.sort is stable in modern
        // engines, so equal-kill players keep their relative input order.
        .sort((a, b) => b.score.kills - a.score.kills)
        .slice(0, 3)
}

// Visual placement for each podium rank: 1st sits centered/tallest, 2nd to its
// left, 3rd to its right. The render order below follows this array so flexbox
// lays the blocks out left-to-right as 2 - 1 - 3.
const PODIUM_ORDER = [2, 1, 3] as const

function getShipImage(player: GameStorePlayer): string | undefined {
    return (shipAssets as Record<string, string>)[player.shipType.texture]
}

// One podium block: rank badge, ship icon, ellipsized name, kills. 1st place is
// tagged MVP and styled taller/amber via the place-specific class.
function PodiumBlock({ player, place }: { player: GameStorePlayer, place: number }) {
    const placeClass = place === 1 ? styles.first : place === 2 ? styles.second : styles.third
    return (
        <div className={`${styles.block} ${placeClass}`}>
            {place === 1 && <div className={styles.mvp}>MVP</div>}
            <div className={styles.rank}>{place}</div>
            <img
                className={styles.shipIcon}
                src={getShipImage(player)}
                alt={player.shipType.name}
                title={player.shipType.name}
            />
            <div className={styles.name}>{player.name}</div>
            <div className={styles.kills}>{player.score.kills}</div>
            <div className={styles.pedestal} />
        </div>
    )
}

// Shown when phase === RESULTS. Mirrors GameOverlayCountdown's dimmed blackout,
// stacking a result headline over a top-3 podium and then the final scoreboard
// (the same GamePlayerList used elsewhere) and the chat. The whole thing is a
// vertical flex column so it stays readable and scrollable on a phone.
export default function GameOverlayResults() {
    const winnerName = useGameStore((s) => s.winnerName)
    const winnerCount = useGameStore((s) => s.winnerCount)
    const playersRaw = useGameStore((s) => s.players)

    const headline = resultHeadline(winnerName, winnerCount)
    const isTie = winnerCount > 1

    // The podium derives from the same roster the scoreboard shows. Memoized so a
    // chat/ping sync that leaves the roster untouched does not re-sort it.
    const podium = useMemo(() => podiumTop(playersRaw), [playersRaw])

    // Map each surviving player to its 1-based rank, then re-order into the
    // visual 2 - 1 - 3 layout, dropping placements that have no player (fewer
    // than 3 scorers) so the podium wraps gracefully with 1 or 2 players.
    const placements = PODIUM_ORDER
        .map((place) => ({ place, player: podium[place - 1] }))
        .filter((entry) => typeof entry.player !== "undefined")

    return (
        <div className="game-overlay">
            <div className={styles.blackout}>
                <div className={styles.panel}>
                    <div className={styles.label}>Match Over</div>
                    <div className={`${styles.headline} ${isTie ? styles.tie : ""}`}>
                        {headline}
                    </div>
                    {placements.length > 0 && (
                        <div className={styles.podium}>
                            {placements.map(({ place, player }) => (
                                <PodiumBlock key={player.id} player={player} place={place} />
                            ))}
                        </div>
                    )}
                    <div className={styles.board}>
                        <GamePlayerList />
                    </div>
                    <div className={styles.hint}>Returning to the lobby...</div>
                </div>
            </div>
            <div className={styles.gameChat}>
                <GameChat />
            </div>
        </div>
    )
}
