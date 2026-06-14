// Pure, dependency-free helpers for persisting the player's custom control
// bindings to localStorage. Like ./audioSettings and ./graphicsSettings this
// module MUST import nothing: it is consumed by the UI store (which pulls in
// Pixi via ../game) and by processInputs on the hot path, and it is exercised
// directly under node/vitest where there is no DOM. All localStorage access is
// guarded by a `typeof localStorage !== "undefined"` check (also covers SSR).

export const KEYBINDINGS_KEY = "pip-pip:keybindings"

// Every remappable action. Movement is four discrete directions (so WASD and
// arrow keys both fit the same model); aim stays on the mouse (desktop) or the
// right stick (gamepad) and is therefore NOT a remappable key here. `scoreboard`
// is included so the UI can display/rebind it, though the actual show-scoreboard
// wiring lives in the game store and currently still reads Tab directly.
export type GameAction =
    | "moveUp"
    | "moveDown"
    | "moveLeft"
    | "moveRight"
    | "fire"
    | "tactical"
    | "reload"
    | "scoreboard"

// Ordered list — the single source of truth for iteration (UI rows, validation,
// merge). Keeping it explicit avoids relying on object key order.
export const GAME_ACTIONS: readonly GameAction[] = [
    "moveUp",
    "moveDown",
    "moveLeft",
    "moveRight",
    "fire",
    "tactical",
    "reload",
    "scoreboard",
] as const

// Human-readable labels for the UI. Kept here (next to the action list) so the
// component stays a thin renderer.
export const ACTION_LABELS: Record<GameAction, string> = {
    moveUp: "Move up",
    moveDown: "Move down",
    moveLeft: "Move left",
    moveRight: "Move right",
    fire: "Primary fire",
    tactical: "Secondary cannon",
    reload: "Reload",
    scoreboard: "Scoreboard",
}

// action -> KeyboardEvent.code (the same `e.code` the core KeyboardListener
// keys its state by, e.g. "KeyW", "Space", "Tab").
export type KeyBindings = Record<GameAction, string>

// action -> gamepad button index (the index into Gamepad.buttons from the
// Gamepad API). Standard mapping: 0=A/cross, 1=B/circle, 2=X/square, 3=Y/triangle,
// 4=LB, 5=RB, 6=LT, 7=RT. -1 means "unbound".
export type GamepadBindings = Record<GameAction, number>

// The full persisted shape.
export interface ControlBindings {
    keys: KeyBindings
    gamepad: GamepadBindings
}

// Current defaults — these mirror the behavior processInputs had before it was
// made configurable (WASD move, Space fire, Q tactical, R reload, Tab
// scoreboard). Movement keys default to WASD.
export const DEFAULT_KEYBINDINGS: KeyBindings = {
    moveUp: "KeyW",
    moveDown: "KeyS",
    moveLeft: "KeyA",
    moveRight: "KeyD",
    fire: "Space",
    tactical: "KeyQ",
    reload: "KeyR",
    scoreboard: "Tab",
}

// Sensible gamepad defaults for a standard-mapping controller. Left stick drives
// movement and right stick drives aim (handled in processInputs, not buttons);
// the face/shoulder buttons map to the actions. -1 for the movement actions
// (they come from the stick) so the d-pad stays free.
export const DEFAULT_GAMEPAD_BINDINGS: GamepadBindings = {
    moveUp: -1,
    moveDown: -1,
    moveLeft: -1,
    moveRight: -1,
    fire: 7, // right trigger (RT / R2)
    tactical: 5, // right bumper (RB / R1)
    reload: 2, // X / square
    scoreboard: 3, // Y / triangle
}

export const DEFAULT_CONTROL_BINDINGS: ControlBindings = {
    keys: { ...DEFAULT_KEYBINDINGS },
    gamepad: { ...DEFAULT_GAMEPAD_BINDINGS },
}

// Build a fresh copy of the defaults (so callers never share the frozen module
// constants). Used by every parse/read fallback below.
const defaultBindings = (): ControlBindings => ({
    keys: { ...DEFAULT_KEYBINDINGS },
    gamepad: { ...DEFAULT_GAMEPAD_BINDINGS },
})

// Merge a partial, possibly-malformed record of key codes onto the defaults.
// Any action whose value is not a non-empty string falls back to its default,
// and unknown actions are dropped — so an old/partial blob upgrades cleanly.
export const mergeKeyBindings = (raw: unknown): KeyBindings => {
    const result: KeyBindings = { ...DEFAULT_KEYBINDINGS }
    if (typeof raw !== "object" || raw === null) return result

    const record = raw as Record<string, unknown>
    for (const action of GAME_ACTIONS) {
        const value = record[action]
        if (typeof value === "string" && value.length > 0) {
            result[action] = value
        }
    }
    return result
}

// Merge a partial, possibly-malformed record of gamepad button indices onto the
// defaults. A value is only accepted if it is an integer >= -1; anything else
// (NaN, float, wrong type) falls back to its default.
export const mergeGamepadBindings = (raw: unknown): GamepadBindings => {
    const result: GamepadBindings = { ...DEFAULT_GAMEPAD_BINDINGS }
    if (typeof raw !== "object" || raw === null) return result

    const record = raw as Record<string, unknown>
    for (const action of GAME_ACTIONS) {
        const value = record[action]
        if (typeof value === "number" && Number.isInteger(value) && value >= -1) {
            result[action] = value
        }
    }
    return result
}

// Parse a raw localStorage string into validated control bindings. Any
// malformed input (null, bad JSON, wrong shape) falls back to the defaults;
// individual fields are merged so a partial/old blob still upgrades cleanly.
export const parseControlBindings = (raw: string | null): ControlBindings => {
    if (raw === null) return defaultBindings()

    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return defaultBindings()
    }

    if (typeof parsed !== "object" || parsed === null) {
        return defaultBindings()
    }

    const record = parsed as Record<string, unknown>
    return {
        keys: mergeKeyBindings(record.keys),
        gamepad: mergeGamepadBindings(record.gamepad),
    }
}

export const serializeControlBindings = (b: ControlBindings): string => JSON.stringify({
    keys: b.keys,
    gamepad: b.gamepad,
})

// Read persisted bindings. Returns defaults when there is no localStorage
// (node/SSR) or when reading throws.
export const readControlBindings = (): ControlBindings => {
    if (typeof localStorage === "undefined") return defaultBindings()
    try {
        return parseControlBindings(localStorage.getItem(KEYBINDINGS_KEY))
    } catch {
        return defaultBindings()
    }
}

// Write bindings. No-ops when there is no localStorage (node/SSR) or when
// writing throws (e.g. quota / private mode).
export const writeControlBindings = (b: ControlBindings): void => {
    if (typeof localStorage === "undefined") return
    try {
        localStorage.setItem(KEYBINDINGS_KEY, serializeControlBindings(b))
    } catch {
        // Ignore write failures; persistence is best-effort.
    }
}

// Find every key code that is bound to more than one action. Returns the set of
// conflicting codes (empty when all bindings are unique). The UI uses this to
// warn — duplicates are allowed (a player may genuinely want one key to do two
// things) but flagged.
export const findDuplicateKeys = (keys: KeyBindings): Set<string> => {
    const counts = new Map<string, number>()
    for (const action of GAME_ACTIONS) {
        const code = keys[action]
        counts.set(code, (counts.get(code) ?? 0) + 1)
    }
    const duplicates = new Set<string>()
    for (const [code, count] of counts) {
        if (count > 1) duplicates.add(code)
    }
    return duplicates
}

// Turn a KeyboardEvent.code into a short, friendly label for display
// ("KeyW" -> "W", "ArrowUp" -> "↑", "Space" -> "Space"). Falls back to the raw
// code for anything unrecognised. Pure, so it is unit-testable.
export const keyCodeLabel = (code: string): string => {
    if (code.length === 0) return "—"
    if (code.startsWith("Key")) return code.slice(3)
    if (code.startsWith("Digit")) return code.slice(5)
    if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`
    const named: Record<string, string> = {
        ArrowUp: "↑",
        ArrowDown: "↓",
        ArrowLeft: "←",
        ArrowRight: "→",
        ShiftLeft: "L Shift",
        ShiftRight: "R Shift",
        ControlLeft: "L Ctrl",
        ControlRight: "R Ctrl",
        AltLeft: "L Alt",
        AltRight: "R Alt",
        Space: "Space",
        Tab: "Tab",
        Enter: "Enter",
        Escape: "Esc",
    }
    return named[code] ?? code
}

// Friendly label for a gamepad button index under the standard mapping. Falls
// back to "Button N" for anything outside the well-known set, and "—" when
// unbound (-1). Pure, so it is unit-testable.
export const gamepadButtonLabel = (index: number): string => {
    if (index < 0) return "—"
    const named: Record<number, string> = {
        0: "A / ✕",
        1: "B / ○",
        2: "X / □",
        3: "Y / △",
        4: "LB / L1",
        5: "RB / R1",
        6: "LT / L2",
        7: "RT / R2",
        8: "Back / Select",
        9: "Start",
        10: "L Stick",
        11: "R Stick",
        12: "D-Pad ↑",
        13: "D-Pad ↓",
        14: "D-Pad ←",
        15: "D-Pad →",
    }
    return named[index] ?? `Button ${index}`
}
