import { useCallback, useEffect, useState } from "react"
import { useGameStore, fraction } from "../game/store"
import { useUiStore } from "../store/ui"
import { Binding, keyMatchesBindings } from "../store/keybindings"
import GameChat from "./GameChat"
import GamePlayerList from "./GamePlayerList"
import PauseMenu from "./PauseMenu"
import KillFeed from "./KillFeed"
import PowerupFeed from "./PowerupFeed"
import ObjectiveMeter from "./ObjectiveMeter"
import Minimap from "./Minimap"
import GameBuffBars from "./GameBuffBars"
import RespawnOverlay from "./RespawnOverlay"
import styles from "./GameOverlayMatch.module.sass"

// The chat opens with a leading "/" only when summoned by the Slash key, so a
// command starts the instant the box appears. Every other open key (T, or the
// touch button) starts empty. Pure, so it is unit-testable.
export function chatPrefillForKey(code: string): string {
    return code === "Slash" ? "/" : ""
}

// Is some editable field already focused? If so we must NOT hijack the keypress
// to open chat (the player is already typing somewhere - the lobby code field,
// the chat itself, an open modal input). Treats <input>, <textarea> and any
// contenteditable host as "editable". Defensive about a null/again-undefined
// activeElement (jsdom/SSR). Pure given the element, so it is unit-testable.
export function isEditableTarget(el: Element | null): boolean {
    if (el === null) return false
    const tag = el.tagName
    if (tag === "INPUT" || tag === "TEXTAREA") return true
    return (el as HTMLElement).isContentEditable === true
}

// Should this keydown open the in-match chat? Only when the key is bound to
// openChat, the chat is not already open, and nothing editable is focused (so we
// never steal a keystroke the player meant for another field). Pure, so the open
// decision is unit-testable without a DOM. The caller still preventDefaults the
// event so the opening key never leaks a stray char into the freshly-opened box.
export function shouldOpenChatOnKey(
    code: string,
    bindings: Binding[],
    chatOpen: boolean,
    editableFocused: boolean,
): boolean {
    if (chatOpen) return false
    if (editableFocused) return false
    return keyMatchesBindings(code, bindings)
}

// Apex-Legends-style in-match HUD. Layout, by corner:
//   top-left ...... minimap, then the collapsible chat under it
//   top-center .... objective meter (DEATHMATCH king + progress, or frenzy clock)
//   top-right ..... the menu button, with the kill + powerup feeds beneath it
//   bottom-left ... health + segmented shield stack, buff chips above it
//   bottom-right .. the weapon card (big ammo number + tactical ability pip + ping)
//   center ........ the respawn countdown while dead
// Every combat element is pointer-events:none so the floating touch sticks
// underneath stay fully usable on mobile.
export default function GameOverlayMatch() {
    const showPlayerList = useGameStore((s) => s.showPlayerList)
    const stats = useGameStore((s) => s.clientPlayerStats)
    const ping = useGameStore((s) => s.ping)
    const spectating = useGameStore((s) => s.clientSpectating)
    const spectateTargetName = useGameStore((s) => s.spectateTargetName)

    const [menuOpen, setMenuOpen] = useState(false)

    // In-match chat is hidden by default and only summoned by the openChat key
    // ("/" or "T") or the touch button. chatPrefill carries the seed text so a
    // "/" open lands the player straight into a command. The openChat bindings
    // are user-editable, so we read them from the store rather than hard-coding.
    const [chatOpen, setChatOpen] = useState(false)
    const [chatPrefill, setChatPrefill] = useState("")
    const openChatBindings = useUiStore((s) => s.keyBindings.openChat)

    // Hide the chat again and hand focus back to the canvas (document.body) so
    // movement/fire keys register immediately after closing. Stable identity so
    // GameChat's effects do not re-run each render.
    const closeChat = useCallback(() => {
        setChatOpen(false)
        setChatPrefill("")
        if (typeof document !== "undefined") {
            // Blur whatever the chat left focused, then focus the body so the
            // core KeyboardListener (which ignores keys while an input is the
            // event target) starts seeing game keys again.
            const active = document.activeElement as HTMLElement | null
            active?.blur?.()
            document.body.focus?.()
        }
    }, [])

    // Open chat from a touch tap (or any non-keyboard affordance): empty input,
    // no key to swallow. Guarded so a second tap while open is a no-op.
    const openChatFromTouch = useCallback(() => {
        setChatOpen((open) => (open ? open : true))
        setChatPrefill("")
    }, [])

    // Watch for the openChat key while the chat is closed. We bind at the window
    // in the capture phase so we see the keydown before the canvas KeyboardListener
    // and can preventDefault it: that stops the opening key from both firing a
    // weapon AND leaking a stray "/" or "t" into the box we are about to focus.
    // While the chat IS open, input gating is automatic - the core listener only
    // records keys whose event target is the canvas, so a focused <input> already
    // starves the ship of movement/fire (see KeyboardListener.downHandler). The
    // bindings are read fresh from the store, so a player's remap takes effect at
    // once.
    useEffect(() => {
        if (typeof window === "undefined") return
        const onKeyDown = (e: KeyboardEvent) => {
            const editable = isEditableTarget(document.activeElement)
            if (!shouldOpenChatOnKey(e.code, openChatBindings, chatOpen, editable)) return
            // Swallow the opening key so it neither fires a weapon nor types a
            // character into the freshly-focused input.
            e.preventDefault()
            setChatPrefill(chatPrefillForKey(e.code))
            setChatOpen(true)
        }
        window.addEventListener("keydown", onKeyDown, true)
        return () => window.removeEventListener("keydown", onKeyDown, true)
    }, [openChatBindings, chatOpen])

    const healthPct = fraction(stats.health, stats.healthMax) * 100
    const lowHealth = healthPct <= 30
    const shieldPct = fraction(stats.shieldTicks, stats.shieldMaxTicks) * 100
    const shieldActive = stats.shieldTicks > 0

    // Tactical ability pip: while reloading the fill rises toward ready
    // (1 - remaining reload fraction); when charged it sits full.
    const tacticalReloading = stats.tacticalReloadTicks > 0
    const tacticalReadyPct = tacticalReloading
        ? (1 - fraction(stats.tacticalReloadTicks, stats.tacticalReloadMaxTicks)) * 100
        : 100

    const alive = !spectating && stats.spawned

    return (
        <div className={`game-overlay ${styles.matchOverlay}`}>
            <Minimap />

            {/* Top-center objective meter: the DEATHMATCH "king" + progress bar
                toward the kill target, or the KILL_FRENZY countdown clock. Picks
                its face by mode and is pointer-events:none (set in its own
                stylesheet) so it never blocks the touch sticks. */}
            <ObjectiveMeter />

            {/* Single pause/options button, top-right corner. */}
            <button
                type="button"
                className={styles.menuButton}
                aria-label="Menu"
                onClick={() => setMenuOpen(true)}
            >
                &#9776;
            </button>

            <KillFeed />
            <PowerupFeed />

            {showPlayerList && (
                <div className={styles.scoreboard}>
                    <GamePlayerList />
                </div>
            )}

            {/* Spectating: no ship, so a banner replaces the combat HUD. */}
            {spectating && (
                <div className={styles.spectateBanner}>
                    <span className={styles.label}>Spectating</span>
                    <span className={styles.target}>{spectateTargetName || " - "}</span>
                    <span className={styles.hint}>&larr; / &rarr; to switch</span>
                </div>
            )}

            {/* Dead (not spectating): the centered respawn countdown stands in for
                the combat HUD until the player is back in. */}
            {!spectating && !stats.spawned && <RespawnOverlay />}

            {alive && (
                <>
                    {/* Buff chips float just above the health stack, like Apex's
                        ability row sitting over the health bars. */}
                    <GameBuffBars />

                    {/* Bottom-left: segmented shield over a health bar + big number. */}
                    <div className={styles.healthStack}>
                        {shieldActive && (
                            <div className={styles.shield}>
                                <div
                                    className={styles.shieldFill}
                                    style={{ width: `${shieldPct}%` }}
                                />
                                <div className={styles.shieldSegments} />
                            </div>
                        )}
                        <div className={styles.healthRow}>
                            <div className={`${styles.healthBar} ${lowHealth ? styles.low : ""}`}>
                                <div
                                    className={styles.healthFill}
                                    style={{ width: `${healthPct}%` }}
                                />
                            </div>
                            <div className={styles.healthNum}>{Math.ceil(stats.health)}</div>
                        </div>
                    </div>

                    {/* Bottom-right: the weapon card. Big ammo number, a tactical
                        ability pip with a rising cooldown fill, and ping. */}
                    <div className={styles.weaponCard}>
                        <div className={styles.ammo}>
                            <span className={styles.ammoNum}>
                                {stats.reloading ? "--" : stats.ammo}
                            </span>
                            <span className={styles.ammoMax}>/ {stats.ammoMax}</span>
                        </div>
                        <div className={styles.cardRow}>
                            <div className={`${styles.tac} ${tacticalReloading ? styles.charging : styles.ready}`}>
                                <div
                                    className={styles.tacFill}
                                    style={{ height: `${tacticalReadyPct}%` }}
                                />
                                <span className={styles.tacLabel}>
                                    {tacticalReloading ? "TAC" : stats.tacticalAmmo}
                                </span>
                            </div>
                            <div className={styles.ping}>{ping}<span>ms</span></div>
                        </div>
                    </div>
                </>
            )}

            {/* Chat: hidden in-match until summoned. The openChat key ("/" or "T")
                opens + focuses it; Escape or sending closes it. Mounted only while
                open so it never sits over the lower-left move-stick zone or steals
                focus. The "/" open seeds the input so a command starts at once. */}
            {chatOpen && (
                <div className={styles.chat}>
                    <div className={styles.chatBody}>
                        <GameChat
                            autoFocus
                            initialValue={chatPrefill}
                            onClose={closeChat}
                        />
                    </div>
                </div>
            )}

            {/* Touch-only chat opener. Phones have no physical keyboard, so this
                tiny button stands in for the openChat key. Hidden on desktop
                (where the keybind is used) via a coarse-pointer media query in the
                stylesheet. pointer-events:auto so the click lands through the
                otherwise click-through HUD. Hidden while the chat is already open. */}
            {!chatOpen && (
                <button
                    type="button"
                    className={styles.chatButton}
                    aria-label="Open chat"
                    onClick={openChatFromTouch}
                >
                    &#128172;
                </button>
            )}

            {menuOpen && <PauseMenu onClose={() => setMenuOpen(false)} />}
        </div>
    )
}
