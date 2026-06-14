// Pure, dependency-free math + state for gamepad (controller) input.
//
// Kept free of React/DOM (and of any package import) so the axis->intent helpers
// can be unit-tested in isolation (see tests/client/gamepad.test.ts). The only
// browser API touched is navigator.getGamepads(), and that is read in
// processInputs (the caller), NOT here — pollGamepad below takes an already-read
// Gamepad-or-null so the math stays testable.
//
// Shape mirrors ./touch: a set of pure helpers, a mutable singleton the hot path
// fills in, and a refresh that recomputes the top-level `active` flag.

// A minimal structural view of the Gamepad API objects we read. Declaring our
// own avoids depending on lib.dom's Gamepad type in node/vitest and documents
// exactly which fields we touch.
export type GamepadButtonLike = { pressed: boolean }
export type GamepadLike = {
    axes: readonly number[]
    buttons: readonly GamepadButtonLike[]
}

// Standard-mapping axis indices: left stick = axes[0] (x), axes[1] (y);
// right stick = axes[2] (x), axes[3] (y).
export const AXIS_LEFT_X = 0
export const AXIS_LEFT_Y = 1
export const AXIS_RIGHT_X = 2
export const AXIS_RIGHT_Y = 3

// Deadzones as a fraction of full stick travel (axes are already -1..1).
export const STICK_MOVE_DEADZONE = 0.25
export const STICK_AIM_DEADZONE = 0.35

export type StickMovement = {
    // Direction of the deflection in radians (atan2(y, x)). Only meaningful when
    // `amount > 0`.
    angle: number,
    // Magnitude of the deflection, clamped to 0..1. Zero inside the deadzone.
    amount: number,
}

export type StickAim = {
    // False while the stick rests inside the deadzone, so a settled aim stick
    // does not snap the crosshair to an arbitrary angle.
    active: boolean,
    // Aim direction in radians. Only meaningful when `active` is true.
    rotation: number,
}

// Translate a normalised stick deflection (x, y each in -1..1) into a movement
// intent. Inside `deadzone` the amount is 0; past it the magnitude ramps from 0
// at the deadzone edge to 1 at full deflection (magnitude 1), so the usable
// travel between deadzone and rim maps onto the 0..1 input range.
export function axesToMovement(x: number, y: number, deadzone: number): StickMovement {
    const distance = Math.hypot(x, y)
    if (distance <= deadzone) {
        return { angle: 0, amount: 0 }
    }
    const span = Math.max(1e-6, 1 - deadzone)
    const amount = Math.min(1, (distance - deadzone) / span)
    return { angle: Math.atan2(y, x), amount }
}

// Translate a normalised stick deflection into an aim intent. Inside the
// deadzone the stick is inactive (resting), so callers keep the previous aim.
// Past the deadzone the rotation is the raw atan2 of the deflection.
export function axesToAim(x: number, y: number, deadzone: number): StickAim {
    const distance = Math.hypot(x, y)
    if (distance <= deadzone) {
        return { active: false, rotation: 0 }
    }
    return { active: true, rotation: Math.atan2(y, x) }
}

// Read whether a mapped button is currently pressed. `index` is the gamepad
// button index from the bindings (-1 = unbound -> never pressed). Guards against
// an out-of-range index (controllers vary) so it is safe on any pad.
export function isButtonPressed(pad: GamepadLike, index: number): boolean {
    if (index < 0) return false
    const button = pad.buttons[index]
    return button !== undefined && button.pressed === true
}

// Shared, mutable gamepad-input state. processInputs fills this each tick from
// the live pad (via pollGamepad) and then merges it into the local player's
// inputs — exactly like ./touch. A plain singleton keeps the hot path
// allocation-free.
export type GamepadState = {
    // True while the pad is contributing anything this tick. When false,
    // processInputs leaves keyboard/mouse/touch in charge.
    active: boolean,

    // Movement (left stick).
    moveActive: boolean,
    movementAngle: number,
    movementAmount: number,

    // Aim (right stick). When deflected we steer the crosshair.
    aimActive: boolean,
    aimRotation: number,

    // Action buttons.
    useWeapon: boolean,
    useTactical: boolean,
    doReload: boolean,
}

export function createGamepadState(): GamepadState {
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

// Module singleton shared between processInputs ticks (so we do not allocate a
// fresh state object every frame).
export const gamepadState = createGamepadState()

// Recompute the top-level `active` flag from the individual intents. The pad is
// "engaged" if either stick is deflected or any action button is held; only then
// does processInputs let it OR-in over keyboard/mouse.
export function refreshGamepadActive(state: GamepadState) {
    state.active = state.moveActive
        || state.aimActive
        || state.useWeapon
        || state.useTactical
        || state.doReload
}

// The action -> button-index map pollGamepad needs. Structural so it does not
// import the store/keybindings type (keeping this module import-free); the store
// type ControlBindings["gamepad"] satisfies it.
export type GamepadButtonMap = {
    fire: number,
    tactical: number,
    reload: number,
}

// Read one frame of the given pad into `state` using the supplied button map.
// `pad` is null when no controller is connected (or under SSR/node) — then the
// state is reset to inactive. Pure aside from mutating the passed-in `state`,
// so it is fully unit-testable with a synthetic GamepadLike.
export function pollGamepad(
    state: GamepadState,
    pad: GamepadLike | null,
    buttons: GamepadButtonMap,
): GamepadState {
    if (pad === null) {
        state.moveActive = false
        state.movementAmount = 0
        state.aimActive = false
        state.useWeapon = false
        state.useTactical = false
        state.doReload = false
        state.active = false
        return state
    }

    const move = axesToMovement(
        pad.axes[AXIS_LEFT_X] ?? 0,
        pad.axes[AXIS_LEFT_Y] ?? 0,
        STICK_MOVE_DEADZONE,
    )
    state.moveActive = move.amount > 0
    state.movementAngle = move.angle
    state.movementAmount = move.amount

    const aim = axesToAim(
        pad.axes[AXIS_RIGHT_X] ?? 0,
        pad.axes[AXIS_RIGHT_Y] ?? 0,
        STICK_AIM_DEADZONE,
    )
    state.aimActive = aim.active
    state.aimRotation = aim.rotation

    state.useWeapon = isButtonPressed(pad, buttons.fire)
    state.useTactical = isButtonPressed(pad, buttons.tactical)
    state.doReload = isButtonPressed(pad, buttons.reload)

    refreshGamepadActive(state)
    return state
}

// Pick the first connected pad from navigator.getGamepads()'s sparse array
// (entries are null until a controller reports input). Returns null when there
// is no navigator / no getGamepads / no connected pad — covers SSR, node, and
// desktop-without-controller. Separated from pollGamepad so the math above stays
// DOM-free and testable.
export function readFirstGamepad(): GamepadLike | null {
    if (typeof navigator === "undefined") return null
    const nav = navigator as Navigator & {
        getGamepads?: () => (GamepadLike | null)[],
    }
    if (typeof nav.getGamepads !== "function") return null

    let pads: (GamepadLike | null)[]
    try {
        pads = nav.getGamepads()
    } catch {
        return null
    }
    for (const pad of pads) {
        if (pad !== null && pad !== undefined) return pad
    }
    return null
}
