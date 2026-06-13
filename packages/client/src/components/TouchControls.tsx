import { useEffect, useRef, useState } from "react"
import {
    refreshTouchActive,
    stickToAim,
    stickToMovement,
    touchState,
} from "../game/touch"
import styles from "./TouchControls.module.sass"

// Fraction of a stick's radius that counts as the resting deadzone.
const DEADZONE_RATIO = 0.18

// Detect touch-first / coarse-pointer devices. We only mount the overlay there
// so it never covers the mouse-aim game on desktop. Computed once at module
// load — pointer hardware does not change mid-session in practice.
function detectTouch(): boolean {
    if(typeof window === "undefined") return false
    const coarse = typeof window.matchMedia === "function"
        && window.matchMedia("(pointer: coarse)").matches
    return coarse || "ontouchstart" in window
}

type StickKind = "move" | "aim"

// Per-stick live state: which pointer owns it and the knob offset (px) for
// rendering. Input math is written straight into the shared `touchState`.
type StickRuntime = {
    pointerId: number | null,
    knobX: number,
    knobY: number,
}

export default function TouchControls() {
    // Decide once; if it ever returns false we render nothing and add no
    // listeners, so desktop is wholly unaffected.
    const [isTouch] = useState(detectTouch)

    const moveStickRef = useRef<HTMLDivElement>(null)
    const aimStickRef = useRef<HTMLDivElement>(null)

    // Knob offsets live in React state purely for the visual; the *input* path
    // goes through the mutable singleton, not setState, so the game loop never
    // depends on a React re-render.
    const [moveKnob, setMoveKnob] = useState({ x: 0, y: 0, engaged: false })
    const [aimKnob, setAimKnob] = useState({ x: 0, y: 0, engaged: false })

    const moveRuntime = useRef<StickRuntime>({ pointerId: null, knobX: 0, knobY: 0 })
    const aimRuntime = useRef<StickRuntime>({ pointerId: null, knobX: 0, knobY: 0 })

    useEffect(() => {
        if(!isTouch) return

        // Reset shared state on unmount so a later desktop-style session (or a
        // remount) never inherits a stuck stick.
        return () => {
            touchState.moveActive = false
            touchState.movementAmount = 0
            touchState.aimActive = false
            touchState.useWeapon = false
            touchState.useTactical = false
            touchState.doReload = false
            refreshTouchActive(touchState)
        }
    }, [isTouch])

    if(!isTouch) return null

    // --- Stick gesture handling ---------------------------------------------

    const stickGeometry = (el: HTMLDivElement) => {
        const rect = el.getBoundingClientRect()
        const radius = rect.width / 2
        return {
            centerX: rect.left + radius,
            centerY: rect.top + radius,
            radius,
            deadzone: radius * DEADZONE_RATIO,
        }
    }

    const applyStick = (kind: StickKind, dx: number, dy: number, radius: number, deadzone: number) => {
        // Clamp the visible knob to the rim while letting the input math read the
        // raw deflection (stickToMovement/aim clamp internally).
        const dist = Math.hypot(dx, dy)
        const clamp = dist > radius ? radius / dist : 1
        const knobX = dx * clamp
        const knobY = dy * clamp

        if(kind === "move"){
            const { angle, amount } = stickToMovement(dx, dy, deadzone, radius)
            touchState.moveActive = amount > 0
            touchState.movementAngle = angle
            touchState.movementAmount = amount
            moveRuntime.current.knobX = knobX
            moveRuntime.current.knobY = knobY
            setMoveKnob({ x: knobX, y: knobY, engaged: amount > 0 })
        } else {
            const { active, rotation } = stickToAim(dx, dy, deadzone)
            touchState.aimActive = active
            if(active) touchState.aimRotation = rotation
            // Twin-stick: deflecting the aim stick also fires.
            touchState.useWeapon = active
            aimRuntime.current.knobX = knobX
            aimRuntime.current.knobY = knobY
            setAimKnob({ x: knobX, y: knobY, engaged: active })
        }
        refreshTouchActive(touchState)
    }

    const releaseStick = (kind: StickKind) => {
        if(kind === "move"){
            touchState.moveActive = false
            touchState.movementAmount = 0
            moveRuntime.current.pointerId = null
            setMoveKnob({ x: 0, y: 0, engaged: false })
        } else {
            touchState.aimActive = false
            touchState.useWeapon = false
            aimRuntime.current.pointerId = null
            setAimKnob({ x: 0, y: 0, engaged: false })
        }
        refreshTouchActive(touchState)
    }

    const makeStickHandlers = (kind: StickKind, ref: React.RefObject<HTMLDivElement>) => {
        const runtime = kind === "move" ? moveRuntime : aimRuntime

        const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
            const el = ref.current
            if(!el) return
            // First finger on this stick owns it; ignore further pointers so the
            // two thumbs stay on their own sticks.
            if(runtime.current.pointerId !== null) return
            runtime.current.pointerId = e.pointerId
            el.setPointerCapture(e.pointerId)
            const { centerX, centerY, radius, deadzone } = stickGeometry(el)
            applyStick(kind, e.clientX - centerX, e.clientY - centerY, radius, deadzone)
        }

        const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
            const el = ref.current
            if(!el) return
            if(runtime.current.pointerId !== e.pointerId) return
            const { centerX, centerY, radius, deadzone } = stickGeometry(el)
            applyStick(kind, e.clientX - centerX, e.clientY - centerY, radius, deadzone)
        }

        const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
            if(runtime.current.pointerId !== e.pointerId) return
            releaseStick(kind)
        }

        return {
            onPointerDown,
            onPointerMove,
            onPointerUp: onPointerEnd,
            onPointerCancel: onPointerEnd,
        }
    }

    // --- Action button handling ---------------------------------------------

    const makeButtonHandlers = (
        field: "useTactical" | "doReload",
        setHeld: (held: boolean) => void,
    ) => {
        const press = (e: React.PointerEvent<HTMLDivElement>) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            touchState[field] = true
            setHeld(true)
            refreshTouchActive(touchState)
        }
        const release = () => {
            touchState[field] = false
            setHeld(false)
            refreshTouchActive(touchState)
        }
        return {
            onPointerDown: press,
            onPointerUp: release,
            onPointerCancel: release,
            onPointerLeave: release,
        }
    }

    const [tacticalHeld, setTacticalHeld] = useState(false)
    const [reloadHeld, setReloadHeld] = useState(false)

    const moveHandlers = makeStickHandlers("move", moveStickRef)
    const aimHandlers = makeStickHandlers("aim", aimStickRef)

    return (
        <div className={styles.root}>
            <div className={styles.actions}>
                <div
                    className={`${styles.actionButton} ${styles.tactical} ${tacticalHeld ? styles.held : ""}`}
                    {...makeButtonHandlers("useTactical", setTacticalHeld)}
                >
                    Tac
                </div>
                <div
                    className={`${styles.actionButton} ${reloadHeld ? styles.held : ""}`}
                    {...makeButtonHandlers("doReload", setReloadHeld)}
                >
                    Rel
                </div>
            </div>

            <div
                ref={moveStickRef}
                className={`${styles.stick} ${styles.left} ${moveKnob.engaged ? styles.engaged : ""}`}
                {...moveHandlers}
            >
                <div className={styles.stickLabel}>Move</div>
                <div
                    className={styles.knob}
                    style={{ transform: `translate(${moveKnob.x}px, ${moveKnob.y}px)` }}
                />
            </div>

            <div
                ref={aimStickRef}
                className={`${styles.stick} ${styles.right} ${aimKnob.engaged ? styles.engaged : ""}`}
                {...aimHandlers}
            >
                <div className={styles.stickLabel}>Aim / Fire</div>
                <div
                    className={styles.knob}
                    style={{ transform: `translate(${aimKnob.x}px, ${aimKnob.y}px)` }}
                />
            </div>
        </div>
    )
}
