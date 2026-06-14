import { useEffect, useRef, useState } from "react"
import { useUiStore } from "../store/ui"
import {
    ACTION_LABELS,
    Binding,
    GAME_ACTIONS,
    GameAction,
    MouseButton,
    bindingId,
    bindingLabel,
    findDuplicateKeys,
    gamepadButtonLabel,
    keyBinding,
    mouseBinding,
    wheelBinding,
} from "../store/keybindings"
import { readFirstGamepad } from "../game/gamepad"
import Modal from "./Modal"
import GameButton from "./GameButton"
import styles from "./KeyBindingsModal.module.sass"

interface Props {
    onClose: () => void
}

// The "capture mode" target: which action is waiting for its next input. An
// "input" capture accepts ANY kind (key / mouse button / wheel) on the next
// event; a "gamepad" capture polls the pad for the next pressed button.
type Capturing =
    | { kind: "input", action: GameAction }
    | { kind: "gamepad", action: GameAction }
    | null

export default function KeyBindingsModal({ onClose }: Props) {
    const keyBindings = useUiStore((s) => s.keyBindings)
    const gamepadBindings = useUiStore((s) => s.gamepadBindings)
    const addBinding = useUiStore((s) => s.addBinding)
    const removeBinding = useUiStore((s) => s.removeBinding)
    const setGamepadBinding = useUiStore((s) => s.setGamepadBinding)
    const resetBindings = useUiStore((s) => s.resetBindings)

    const [capturing, setCapturing] = useState<Capturing>(null)
    const duplicates = findDuplicateKeys(keyBindings)

    // Input capture: while an "input" row is armed, the NEXT input of any kind
    // becomes a new binding for that action. A keydown -> key binding, a mousedown
    // -> mouse-button binding, a wheel -> wheel-up/down binding. Escape cancels.
    // All listeners are registered in the capture phase with
    // stopImmediatePropagation so the input never reaches the game listeners.
    useEffect(() => {
        if (capturing === null || capturing.kind !== "input") return
        const action = capturing.action

        const onKeyDown = (e: KeyboardEvent) => {
            e.preventDefault()
            e.stopImmediatePropagation()
            if (e.code === "Escape") {
                setCapturing(null)
                return
            }
            addBinding(action, keyBinding(e.code))
            setCapturing(null)
        }
        // Swallow the matching keyup too, so neither the captured key nor a
        // cancelling Escape leaks to the Modal's keyup-to-close handler.
        const onKeyUp = (e: KeyboardEvent) => {
            e.preventDefault()
            e.stopImmediatePropagation()
        }
        const onMouseDown = (e: MouseEvent) => {
            e.preventDefault()
            e.stopImmediatePropagation()
            if (e.button === 0 || e.button === 1 || e.button === 2) {
                addBinding(action, mouseBinding(e.button as MouseButton))
            }
            setCapturing(null)
        }
        // Block the context menu a right-click would otherwise raise mid-capture.
        const onContextMenu = (e: MouseEvent) => {
            e.preventDefault()
            e.stopImmediatePropagation()
        }
        const onWheel = (e: WheelEvent) => {
            e.preventDefault()
            e.stopImmediatePropagation()
            if (e.deltaY !== 0) {
                addBinding(action, wheelBinding(e.deltaY < 0 ? "up" : "down"))
                setCapturing(null)
            }
        }

        window.addEventListener("keydown", onKeyDown, true)
        window.addEventListener("keyup", onKeyUp, true)
        window.addEventListener("mousedown", onMouseDown, true)
        window.addEventListener("contextmenu", onContextMenu, true)
        window.addEventListener("wheel", onWheel, { capture: true, passive: false })
        return () => {
            window.removeEventListener("keydown", onKeyDown, true)
            window.removeEventListener("keyup", onKeyUp, true)
            window.removeEventListener("mousedown", onMouseDown, true)
            window.removeEventListener("contextmenu", onContextMenu, true)
            window.removeEventListener("wheel", onWheel, true)
        }
    }, [capturing, addBinding])

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

    // The list of binding chips for an action, plus the "Add" affordance. Each
    // chip shows the binding label and a remove (×) button; a chip whose binding
    // is shared with another action is flagged.
    const bindingCells = (action: GameAction) => {
        const bindings = keyBindings[action]
        const isCapturing = capturing?.kind === "input" && capturing.action === action
        return (
            <div className={styles.chips}>
                {bindings.map((binding: Binding, index: number) => {
                    const isDuplicate = duplicates.has(bindingId(binding))
                    return (
                        <span
                            key={`${bindingId(binding)}-${index}`}
                            className={isDuplicate ? `${styles.chip} ${styles.duplicate}` : styles.chip}
                        >
                            <span className={styles.chipLabel}>{bindingLabel(binding)}</span>
                            <button
                                type="button"
                                className={styles.chipRemove}
                                aria-label={`Remove ${bindingLabel(binding)}`}
                                onClick={() => removeBinding(action, index)}
                            >
                                ×
                            </button>
                        </span>
                    )
                })}
                {bindings.length === 0 && !isCapturing && (
                    <span className={styles.unbound}>Unbound</span>
                )}
                {isCapturing ? (
                    <span className={styles.capturing}>press any input…</span>
                ) : (
                    <button
                        type="button"
                        className={styles.addButton}
                        onClick={() => setCapturing({ kind: "input", action })}
                    >
                        + Add
                    </button>
                )}
            </div>
        )
    }

    const gamepadCell = (action: GameAction) => {
        if (capturing?.kind === "gamepad" && capturing.action === action) {
            return <span className={styles.capturing}>press a button…</span>
        }
        return <span>{gamepadButtonLabel(gamepadBindings[action])}</span>
    }

    const hasUnbound = GAME_ACTIONS.some((action) => keyBindings[action].length === 0)

    return (
        <Modal title="Edit bindings" onClose={onClose}>
            <div className={styles.intro}>
                Add several inputs per action: a key, a mouse button, or the mouse
                wheel. Click Add then press any input. Aim stays on the mouse
                (desktop) or the right stick (controller).
            </div>

            <div className={styles.tableHead}>
                <div>Action</div>
                <div>Inputs</div>
                <div>Controller</div>
            </div>

            <div className={styles.rows}>
                {GAME_ACTIONS.map((action) => (
                    <div className={styles.row} key={action}>
                        <div className={styles.action}>{ACTION_LABELS[action]}</div>
                        <div className={styles.inputs}>{bindingCells(action)}</div>
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
                    Some inputs are bound to more than one action.
                </div>
            )}

            {hasUnbound && (
                <div className={styles.warning}>
                    Some actions have no input bound.
                </div>
            )}

            <div className={styles.actions}>
                <GameButton onClick={resetBindings}>Reset to defaults</GameButton>
            </div>
        </Modal>
    )
}
