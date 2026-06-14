// Pure, dependency-free math for a FLOATING analog stick (chilibird-style).
//
// A floating stick has no fixed centre: the finger lands ANYWHERE inside a zone
// and that landing point becomes the stick's origin. The thumb's offset from the
// origin, measured against STICK_RADIUS, becomes the normalized vector the game
// reads. Below STICK_DEADZONE the vector is zeroed so a resting thumb never
// nudges the ship; the visual "nub" is clamped to the rim but NOT deadzoned, so
// it always tracks the finger for clear feedback.
//
// Kept free of React/DOM so it can be unit-tested in isolation (see
// tests/client/touchstick.test.ts). TouchControls owns the pointer plumbing and
// feeds raw screen coordinates (px) through these helpers, then maps the
// resulting vector onto the shared `touchState` singleton that processInputs
// reads each update tick.

// Pixels of thumb travel that map to full (magnitude 1) deflection.
export const STICK_RADIUS = 56

// Fraction of the radius treated as the resting deadzone; below this the input
// vector collapses to {0, 0} (the nub still follows the finger though).
export const STICK_DEADZONE = 0.18

// Live state for one floating stick. `originX/Y` is the anchor (where the finger
// landed), `x/y` is the normalized input vector (-1..1, clamped to the unit
// disc, deadzoned), and `nubX/Y` is the visual knob offset in px from the origin
// (clamped to the rim, NOT deadzoned).
export type StickState = {
    active: boolean,
    pointerId: number | null,
    originX: number,
    originY: number,
    x: number,
    y: number,
    nubX: number,
    nubY: number,
}

// A fresh, inactive stick.
export function createStickState(): StickState {
    return {
        active: false,
        pointerId: null,
        originX: 0,
        originY: 0,
        x: 0,
        y: 0,
        nubX: 0,
        nubY: 0,
    }
}

// Anchor the stick at the finger's landing point and zero the vector/nub. The
// stick becomes active and remembers which pointer owns it.
export function stickBegin(s: StickState, pointerId: number, px: number, py: number): StickState {
    s.active = true
    s.pointerId = pointerId
    s.originX = px
    s.originY = py
    s.x = 0
    s.y = 0
    s.nubX = 0
    s.nubY = 0
    return s
}

// Update the stick from the thumb's current screen position. Computes the offset
// from the origin in radius-normalized units, clamps to the unit disc, derives
// the rim-clamped nub for the visual, then deadzones the input vector.
export function stickMove(s: StickState, px: number, py: number): StickState {
    const dx = (px - s.originX) / STICK_RADIUS
    const dy = (py - s.originY) / STICK_RADIUS
    const m = Math.hypot(dx, dy)
    // Clamp the vector to the unit disc: past the rim, scale back to magnitude 1.
    const clamp = m > 1 ? 1 / m : 1
    // Nub follows the finger to the rim, deadzone-free, so it is always visible.
    s.nubX = dx * clamp * STICK_RADIUS
    s.nubY = dy * clamp * STICK_RADIUS
    if(m < STICK_DEADZONE){
        s.x = 0
        s.y = 0
    } else {
        s.x = dx * clamp
        s.y = dy * clamp
    }
    return s
}

// Release the stick: deactivate and zero everything so a later gesture (or a
// remount) never inherits a stuck deflection.
export function stickEnd(s: StickState): StickState {
    s.active = false
    s.pointerId = null
    s.x = 0
    s.y = 0
    s.nubX = 0
    s.nubY = 0
    return s
}
