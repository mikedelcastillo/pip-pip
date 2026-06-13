// Pure, dependency-free math for the on-screen twin-stick touch controls.
//
// Kept free of React/DOM so it can be unit-tested in isolation (see
// tests/client/touch.test.ts). The TouchControls component owns the pointer
// plumbing and feeds raw stick deltas (in pixels, relative to each stick's
// centre) through these helpers, then writes the result into the shared
// `touchState` singleton that processInputs reads each update tick.

export type StickMovement = {
    // Direction of the deflection, in radians (atan2(dy, dx)). Only meaningful
    // when `amount > 0`.
    angle: number,
    // Magnitude of the deflection, clamped to 0..1. Zero while the stick rests
    // inside the deadzone so a barely-touched stick never nudges the ship.
    amount: number,
}

export type StickAim = {
    // False while the stick rests inside the deadzone, so a settled aim stick
    // does not snap the crosshair to an arbitrary angle (and does not fire in
    // twin-stick mode).
    active: boolean,
    // Aim direction in radians. Only meaningful when `active` is true.
    rotation: number,
}

// Translate a stick deflection (dx, dy in px from the stick centre) into a
// movement intent. Inside `deadzone` the amount is 0; past it the magnitude
// ramps from 0 at the deadzone edge to 1 at `maxRadius` (and clamps there), so
// the full travel between deadzone and rim maps onto the 0..1 input range.
export function stickToMovement(
    dx: number,
    dy: number,
    deadzone: number,
    maxRadius: number,
): StickMovement {
    const distance = Math.hypot(dx, dy)
    if(distance <= deadzone){
        return { angle: 0, amount: 0 }
    }
    const span = Math.max(1e-6, maxRadius - deadzone)
    const amount = Math.min(1, (distance - deadzone) / span)
    return { angle: Math.atan2(dy, dx), amount }
}

// Translate a stick deflection into an aim intent. Inside the deadzone the
// stick is inactive (resting), so callers should keep the previous aim and not
// auto-fire. Past the deadzone the rotation is the raw atan2 of the deflection.
export function stickToAim(dx: number, dy: number, deadzone: number): StickAim {
    const distance = Math.hypot(dx, dy)
    if(distance <= deadzone){
        return { active: false, rotation: 0 }
    }
    return { active: true, rotation: Math.atan2(dy, dx) }
}

// Shared, mutable touch-input state. The TouchControls component mutates this
// object directly on every pointer event (NO React setState per frame); the
// game's processInputs reads it each update tick and merges it into the local
// player's inputs. A plain singleton keeps the hot path allocation-free and
// decoupled from React's render cycle.
export type TouchState = {
    // True while at least one stick or button is engaged this frame. When false
    // processInputs leaves keyboard/mouse in charge so desktop is untouched.
    active: boolean,

    // Movement (left stick).
    moveActive: boolean,
    movementAngle: number,
    movementAmount: number,

    // Aim (right stick). When the aim stick is deflected we both steer the
    // crosshair and fire — classic twin-stick, reachable with one thumb.
    aimActive: boolean,
    aimRotation: number,

    // Action buttons.
    useWeapon: boolean,
    useTactical: boolean,
    doReload: boolean,
}

export function createTouchState(): TouchState {
    return {
        active: false,
        moveActive: false,
        movementAngle: 0,
        movementAmount: 0,
        aimActive: false,
        aimRotation: 0,
        useWeapon: false,
        useTactical: false,
        doReload: false,
    }
}

// Module singleton shared between the component and processInputs.
export const touchState = createTouchState()

// Recompute the top-level `active` flag from the individual intents. Touch is
// "engaged" if any stick is deflected or any action button is held; only then
// does processInputs let touch override keyboard/mouse.
export function refreshTouchActive(state: TouchState){
    state.active = state.moveActive
        || state.aimActive
        || state.useWeapon
        || state.useTactical
        || state.doReload
}
