import { GAME_CONTEXT } from "../game"
import { useUiStore } from "../store/ui"
import GameButton from "./GameButton"
import ShipSelect from "./ShipSelect"
import styles from "./LoadoutOverlay.module.sass"

// Mid-game loadout screen. Shown over the live match (phase === MATCH) when a
// real player joins a match already in progress, or when a dead player taps
// "Change Loadout" on the respawn overlay. The joining player is parked as a
// spectator server-side (see addPlayerMidGame), so this screen lets them pick a
// ship and choose to Deploy (spawn in) or Spectate (keep watching).
//
// Unlike RespawnOverlay this overlay IS interactive, so it captures pointer
// events (no pointer-events:none) - the touch sticks stay safely behind it.
export default function LoadoutOverlay() {
    const setShowLoadout = useUiStore((s) => s.setShowLoadout)

    // Deploy: clear the spectator flag (the server's respawn loop then spawns
    // the player, since spawnTimeout is 0 and they are no longer a spectator) and
    // dismiss the overlay so the normal combat HUD takes over.
    const deploy = () => {
        GAME_CONTEXT.setSpectator(false)
        setShowLoadout(false)
    }

    // Spectate: just dismiss the overlay. The player stays a spectator (the
    // server parked them as one) and falls through to the normal spectator HUD.
    const spectate = () => {
        setShowLoadout(false)
    }

    return (
        <div className={`game-overlay ${styles.loadout}`}>
            <div className={styles.panel}>
                <header className={styles.head}>
                    <div className={styles.kicker}>Match in progress</div>
                    <h2 className={styles.title}>Choose your loadout</h2>
                </header>

                <div className={styles.body}>
                    {/* Ship selection is ENABLED here even though the phase is
                        MATCH - the loadout context explicitly allows it. */}
                    <ShipSelect allowInMatch />
                </div>

                <footer className={styles.actions}>
                    {/* Spectate is the small secondary on the LEFT; Deploy is the
                        prominent primary on the RIGHT. */}
                    <GameButton accent onClick={spectate} className={styles.spectateBtn}>
                        Spectate
                    </GameButton>
                    <GameButton onClick={deploy} className={styles.deployBtn}>
                        Deploy
                    </GameButton>
                </footer>
            </div>
        </div>
    )
}
