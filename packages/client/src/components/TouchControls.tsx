import { useEffect, useRef, useState } from "react"
import { refreshTouchActive, touchState } from "../game/touch"
import {
    StickState,
    createStickState,
    stickBegin,
    stickEnd,
    stickMove,
} from "../game/touchstick"
import styles from "./TouchControls.module.sass"

// Detect touch-first / coarse-pointer devices. We only mount the overlay there
// so it never covers the mouse-aim game on desktop. Computed once at module
// load - pointer hardware does not change mid-session in practice.
function detectTouch(): boolean {
    if(typeof window === "undefined") return false
    const coarse = typeof window.matchMedia === "function"
        && window.matchMedia("(pointer: coarse)").matches
    return coarse || "ontouchstart" in window
}

// Visual snapshot of one floating stick for rendering: where it is anchored
// (origin) and where the nub sits relative to that anchor (nub offset). `active`
// gates visibility - the stick is invisible until a finger lands.
type StickVisual = {
    active: boolean,
    originX: number,
    originY: number,
    nubX: number,
    nubY: number,
}

const HIDDEN_VISUAL: StickVisual = {
    active: false,
    originX: 0,
    originY: 0,
    nubX: 0,
    nubY: 0,
}

function toVisual(s: StickState): StickVisual {
    return {
        active: s.active,
        originX: s.originX,
        originY: s.originY,
        nubX: s.nubX,
        nubY: s.nubY,
    }
}

export default function TouchControls() {
    // Decide once; if it ever returns false we render nothing and add no
    // listeners, so desktop is wholly unaffected.
    const [isTouch] = useState(detectTouch)

    // Floating stick state lives in refs (mutated on every pointer event, no
    // setState per move) so the game loop never depends on a React re-render. The
    // input path writes straight into the shared `touchState` singleton.
    const moveStick = useRef<StickState>(createStickState())
    const aimStick = useRef<StickState>(createStickState())

    // Visual snapshots ARE React state so the on-screen base ring + nub follow
    // the thumb. Updated alongside the ref mutation on each event.
    const [moveVisual, setMoveVisual] = useState<StickVisual>(HIDDEN_VISUAL)
    const [aimVisual, setAimVisual] = useState<StickVisual>(HIDDEN_VISUAL)

    const [tacticalHeld, setTacticalHeld] = useState(false)
    const [reloadHeld, setReloadHeld] = useState(false)

    useEffect(() => {
        if(!isTouch) return
        // Reset shared state on unmount so a later session (or a remount) never
        // inherits a stuck stick.
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

    // --- Move zone (lower-left) → movement stick ----------------------------
    //
    // The left stick drives movement AND, until the right (aim) stick is
    // touched, also steers aim+fire - the chilibird coupling so a one-thumbed
    // player can still shoot in the direction they move.

    const writeMove = () => {
        const s = moveStick.current
        const m = Math.hypot(s.x, s.y)
        touchState.moveActive = m > 0
        if(m > 0){
            touchState.movementAngle = Math.atan2(s.y, s.x)
            touchState.movementAmount = Math.min(1, m)
        } else {
            touchState.movementAmount = 0
        }
        // Couple aim to the move stick only while the dedicated aim stick is idle.
        if(!aimStick.current.active && m > 0){
            touchState.aimActive = true
            touchState.aimRotation = Math.atan2(s.y, s.x)
            touchState.useWeapon = true
        } else if(!aimStick.current.active){
            touchState.aimActive = false
            touchState.useWeapon = false
        }
        refreshTouchActive(touchState)
    }

    const onMoveDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if(moveStick.current.pointerId !== null) return
        e.currentTarget.setPointerCapture(e.pointerId)
        stickBegin(moveStick.current, e.pointerId, e.clientX, e.clientY)
        setMoveVisual(toVisual(moveStick.current))
        writeMove()
    }

    const onMoveMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if(moveStick.current.pointerId !== e.pointerId) return
        stickMove(moveStick.current, e.clientX, e.clientY)
        setMoveVisual(toVisual(moveStick.current))
        writeMove()
    }

    const onMoveUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if(moveStick.current.pointerId !== e.pointerId) return
        stickEnd(moveStick.current)
        setMoveVisual(HIDDEN_VISUAL)
        touchState.moveActive = false
        touchState.movementAmount = 0
        // Drop the coupled aim/fire too if the aim stick is not the one steering.
        if(!aimStick.current.active){
            touchState.aimActive = false
            touchState.useWeapon = false
        }
        refreshTouchActive(touchState)
    }

    // --- Aim zone (right half) → aim stick -----------------------------------
    //
    // While deflected the aim stick OWNS aim + fire, overriding the move-stick
    // coupling above. Releasing it hands aim back to the move stick.

    const writeAim = () => {
        const s = aimStick.current
        const m = Math.hypot(s.x, s.y)
        touchState.aimActive = m > 0
        if(m > 0){
            touchState.aimRotation = Math.atan2(s.y, s.x)
            touchState.useWeapon = true
        }
        refreshTouchActive(touchState)
    }

    const onAimDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if(aimStick.current.pointerId !== null) return
        e.currentTarget.setPointerCapture(e.pointerId)
        stickBegin(aimStick.current, e.pointerId, e.clientX, e.clientY)
        setAimVisual(toVisual(aimStick.current))
        writeAim()
    }

    const onAimMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if(aimStick.current.pointerId !== e.pointerId) return
        stickMove(aimStick.current, e.clientX, e.clientY)
        setAimVisual(toVisual(aimStick.current))
        writeAim()
    }

    const onAimUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if(aimStick.current.pointerId !== e.pointerId) return
        stickEnd(aimStick.current)
        setAimVisual(HIDDEN_VISUAL)
        // Hand aim/fire back to the move-stick coupling (or clear it if move is
        // idle too). Re-derive from the live move stick so we don't strand a
        // stuck fire when both thumbs lift.
        const m = Math.hypot(moveStick.current.x, moveStick.current.y)
        if(m > 0){
            touchState.aimActive = true
            touchState.aimRotation = Math.atan2(moveStick.current.y, moveStick.current.x)
            touchState.useWeapon = true
        } else {
            touchState.aimActive = false
            touchState.useWeapon = false
        }
        refreshTouchActive(touchState)
    }

    // --- Action buttons (held) -----------------------------------------------

    const makeButtonHandlers = (
        field: "useTactical" | "doReload",
        setHeld: (held: boolean) => void,
    ) => {
        const press = (e: React.PointerEvent<HTMLDivElement>) => {
            // Stop the press from reaching the aim zone underneath and starting a
            // floating aim stick on top of the button.
            e.stopPropagation()
            e.currentTarget.setPointerCapture(e.pointerId)
            touchState[field] = true
            setHeld(true)
            refreshTouchActive(touchState)
        }
        const release = (e: React.PointerEvent<HTMLDivElement>) => {
            e.stopPropagation()
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

    const stickStyle = (v: StickVisual) => ({
        left: `${v.originX}px`,
        top: `${v.originY}px`,
    })

    return (
        <div className={styles.root}>
            {/* Move zone: lower-left of the screen. A finger landing anywhere
                here anchors the floating move stick at that point. */}
            <div
                className={styles.moveZone}
                onPointerDown={onMoveDown}
                onPointerMove={onMoveMove}
                onPointerUp={onMoveUp}
                onPointerCancel={onMoveUp}
            />

            {/* Aim zone: the right half of the screen. Same floating anchor. */}
            <div
                className={styles.aimZone}
                onPointerDown={onAimDown}
                onPointerMove={onAimMove}
                onPointerUp={onAimUp}
                onPointerCancel={onAimUp}
            />

            {/* Action buttons sit above the aim zone (higher z-index) so pressing
                one never starts the aim stick. */}
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

            {/* Floating stick visuals: invisible until a finger lands, then a base
                ring at the anchor with a nub that tracks the thumb. */}
            {moveVisual.active && (
                <div className={`${styles.stick} ${styles.move}`} style={stickStyle(moveVisual)}>
                    <div className={styles.base} />
                    <div
                        className={styles.nub}
                        style={{ transform: `translate(${moveVisual.nubX}px, ${moveVisual.nubY}px)` }}
                    />
                </div>
            )}
            {aimVisual.active && (
                <div className={`${styles.stick} ${styles.aim}`} style={stickStyle(aimVisual)}>
                    <div className={styles.base} />
                    <div
                        className={styles.nub}
                        style={{ transform: `translate(${aimVisual.nubX}px, ${aimVisual.nubY}px)` }}
                    />
                </div>
            )}
        </div>
    )
}
