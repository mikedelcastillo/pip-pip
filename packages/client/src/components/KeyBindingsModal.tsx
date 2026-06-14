import { useEffect, useRef, useState } from "react"
import { useUiStore } from "../store/ui"
import {
    ACTION_LABELS,
    GAME_ACTIONS,
    GameAction,
    findDuplicateKeys,
    gamepadButtonLabel,
    keyCodeLabel,
} from "../store/keybindings"
import { readFirstGamepad } from "../game/gamepad"
import Modal from "./Modal"
import GameButton from "./GameButton"
import styles from "./KeyBindingsModal.module.sass"

interface Props {
    onClose: () => void
}

// The "capture mode" target: which action (keyboard or gamepad) is waiting for
// the next input. `kind` distinguishes the two listening paths.
type Capturing =
    | { kind: "key", action: GameAction }
    | { kind: "gamepad", action: GameAction }
    | null

export default function KeyBindingsModal({ onClose }: Props) {
    const keyBindings = useUiStore((s) => s.keyBindings)
    const gamepadBindings = useUiStore((s) => s.gamepadBindings)
    const setKeyBinding = useUiStore((s) => s.setKeyBinding)
    const setGamepadBinding = useUiStore((s) => s.setGamepadBinding)
    const resetBindings = useUiStore((s) => s.resetBindings)

    const [capturing, setCapturing] = useState<Capturing>(null)
    const duplicates = findDuplicateKeys(keyBindings)

    // Keyboard capture: while a "key" row is armed, the NEXT keydown becomes that
    // action's binding. Escape cancels (and is swallowed so the Modal's own
    // Escape-to-close does not also fire). Registered in the capture phase with
    // stopImmediatePropagation so the keypress never reaches the game listeners.
    useEffect(() => {
        if (capturing === null || capturing.kind !== "key") return
        const action = capturing.action

        const onKeyDown = (e: KeyboardEvent) => {
            e.preventDefault()
            e.stopImmediatePropagation()
            if (e.code === "Escape") {
                setCapturing(null)
                return
            }
            setKeyBinding(action, e.code)
            setCapturing(null)
        }
        // Swallow the matching keyup too, so neither the captured key nor a
        // cancelling Escape leaks to the Modal's keyup-to-close handler.
        const onKeyUp = (e: KeyboardEvent) => {
            e.preventDefault()
            e.stopImmediatePropagation()
        }

        window.addEventListener("keydown", onKeyDown, true)
        window.addEventListener("keyup", onKeyUp, true)
        return () => {
            window.removeEventListener("keydown", onKeyDown, true)
            window.removeEventListener("keyup", onKeyUp, true)
        }
    }, [capturing, setKeyBinding])

    // Gamepad capture: while a "gamepad" row is armed, poll the first pad each
    // animation frame and bind the first pressed button. There is no DOM event
    // for a button press, so polling is the standard approach. A ref tracks the
    // armed action so the rAF closure always sees the latest value.
    const capturingRef = useRef<Capturing>(null)
    capturingRef.current = capturing
    useEffect(() => {
        if (capturing === null || capturing.kind !== "gamepad") return
        let raf = 0
        const poll = () => {
            const current = capturingRef.current
            if (current === null || current.kind !== "gamepad") return
            const pad = readFirstGamepad()
            if (pad !== null) {
                for (let i = 0; i < pad.buttons.length; i++) {
                    if (pad.buttons[i].pressed === true) {
                        setGamepadBinding(current.action, i)
                        setCapturing(null)
                        return
                    }
                }
            }
            raf = requestAnimationFrame(poll)
        }
        raf = requestAnimationFrame(poll)
        return () => cancelAnimationFrame(raf)
    }, [capturing, setGamepadBinding])

    const keyCell = (action: GameAction) => {
        if (capturing?.kind === "key" && capturing.action === action) {
            return <span className={styles.capturing}>press a key…</span>
        }
        const code = keyBindings[action]
        const isDuplicate = duplicates.has(code)
        return (
            <span className={isDuplicate ? styles.duplicate : undefined}>
                {keyCodeLabel(code)}
            </span>
        )
    }

    const gamepadCell = (action: GameAction) => {
        if (capturing?.kind === "gamepad" && capturing.action === action) {
            return <span className={styles.capturing}>press a button…</span>
        }
        return <span>{gamepadButtonLabel(gamepadBindings[action])}</span>
    }

    return (
        <Modal title="Edit bindings" onClose={onClose}>
            <div className={styles.intro}>
                Click a key to rebind it. Aim stays on the mouse (desktop) or the
                right stick (controller).
            </div>

            <div className={styles.tableHead}>
                <div>Action</div>
                <div>Key</div>
                <div>Controller</div>
            </div>

            <div className={styles.rows}>
                {GAME_ACTIONS.map((action) => (
                    <div className={styles.row} key={action}>
                        <div className={styles.action}>{ACTION_LABELS[action]}</div>
                        <button
                            type="button"
                            className={styles.bindButton}
                            onClick={() => setCapturing({ kind: "key", action })}
                        >
                            {keyCell(action)}
                        </button>
                        <button
                            type="button"
                            className={styles.bindButton}
                            onClick={() => setCapturing({ kind: "gamepad", action })}
                        >
                            {gamepadCell(action)}
                        </button>
                    </div>
                ))}
            </div>

            {duplicates.size > 0 && (
                <div className={styles.warning}>
                    Some keys are bound to more than one action.
                </div>
            )}

            <div className={styles.actions}>
                <GameButton onClick={resetBindings}>Reset to defaults</GameButton>
            </div>
        </Modal>
    )
}
