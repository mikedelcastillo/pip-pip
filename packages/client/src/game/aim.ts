// Aim latching for the local client's crosshair. Kept in its own light module
// (no game-context / Pixi imports) so the pure resolver is unit-testable.
//
// Why this exists: touch.ts and gamepad.ts both report a RESTING stick as
// inactive precisely so the caller can keep the previous aim (see their stickToAim
// notes). processInputs used to overwrite aim with the mouse angle every tick,
// which clobbered that intent: letting go of a touch/gamepad stick snapped the
// crosshair back to the mouse default. The latch below holds the last aimed
// direction on release and only lets the mouse re-take aim when it actually moves.

// Mutable per-session aim latch. `rotation` is the currently held aim (radians);
// lastMouseX/Y track the mouse so we can tell when it has actually moved (NaN
// seeds force the very first tick to adopt the mouse angle).
export type AimState = {
    rotation: number,
    lastMouseX: number,
    lastMouseY: number,
}

export function createAimState(): AimState {
    return { rotation: 0, lastMouseX: NaN, lastMouseY: NaN }
}

// Pure aim resolver. An actively deflected stick always wins, so it is also what
// gets HELD after release (it was the last value written to `previous`).
// Otherwise the mouse takes over only when it moved this tick; otherwise the
// previous aim is held. This is what makes releasing a touch or gamepad stick
// keep the last aimed direction instead of snapping back to the mouse.
export function resolveAimRotation(
    previous: number,
    mouseMoved: boolean,
    mouseAngle: number,
    stickAim: number | null,
): number {
    if(stickAim !== null) return stickAim
    if(mouseMoved) return mouseAngle
    return previous
}
