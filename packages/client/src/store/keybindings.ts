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
// `openChat` opens the in-match chat input (the chat is hidden until then); it is
// handled in GameOverlayMatch, NOT processInputs, so it never feeds the ship.
export type GameAction =
    | "moveUp"
    | "moveDown"
    | "moveLeft"
    | "moveRight"
    | "fire"
    | "tactical"
    | "reload"
    | "scoreboard"
    | "openChat"

// Ordered list - the single source of truth for iteration (UI rows, validation,
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
    "openChat",
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
    openChat: "Open Chat",
}

// A single binding for an action. Three kinds, so one action can be triggered by
// a keyboard key, a mouse button, or a wheel scroll direction:
//   - "key":   a KeyboardEvent.code (e.g. "KeyW", "Space", "Tab"), the same code
//              the core KeyboardListener keys its state by.
//   - "mouse": a MouseEvent.button index (0 = left, 1 = middle, 2 = right).
//   - "wheel": a scroll direction. Momentary: active only on the tick the wheel
//              moved that way (see processInputs).
export type MouseButton = 0 | 1 | 2
export type WheelDirection = "up" | "down"

export type Binding =
    | { kind: "key", code: string }
    | { kind: "mouse", button: MouseButton }
    | { kind: "wheel", dir: WheelDirection }

// Convenience constructors so call sites (defaults, capture, tests) read cleanly.
export const keyBinding = (code: string): Binding => ({ kind: "key", code })
export const mouseBinding = (button: MouseButton): Binding => ({ kind: "mouse", button })
export const wheelBinding = (dir: WheelDirection): Binding => ({ kind: "wheel", dir })

// action -> list of bindings. An action is active if ANY of its bindings is
// active, so a player can bind "fire" to BOTH Space and left-click at once. An
// empty array means the action is currently unbound (allowed; the UI warns).
export type KeyBindings = Record<GameAction, Binding[]>

// action -> gamepad button index (the index into Gamepad.buttons from the
// Gamepad API). Standard mapping: 0=A/cross, 1=B/circle, 2=X/square, 3=Y/triangle,
// 4=LB, 5=RB, 6=LT, 7=RT. -1 means "unbound".
export type GamepadBindings = Record<GameAction, number>

// The full persisted shape.
export interface ControlBindings {
    keys: KeyBindings
    gamepad: GamepadBindings
}

// Current defaults: these reproduce the behavior processInputs had before it
// was made configurable, now expressed as the new multi-binding model: WASD
// move, Space + left-click fire, Q + right-click tactical, R reload, Tab
// scoreboard, "/" or "T" open chat. The mouse entries reproduce the old
// hard-wired mouse-left=fire / mouse-right=tactical lines that processInputs used
// to carry directly. openChat defaults to Slash AND KeyT so "/" reads as "start a
// command" and "T" as the familiar "talk" key, matching most shooters.
export const DEFAULT_KEYBINDINGS: KeyBindings = {
    moveUp: [keyBinding("KeyW")],
    moveDown: [keyBinding("KeyS")],
    moveLeft: [keyBinding("KeyA")],
    moveRight: [keyBinding("KeyD")],
    fire: [keyBinding("Space"), mouseBinding(0)],
    tactical: [keyBinding("KeyQ"), mouseBinding(2)],
    reload: [keyBinding("KeyR")],
    scoreboard: [keyBinding("Tab")],
    openChat: [keyBinding("Slash"), keyBinding("KeyT")],
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
    openChat: -1, // no pad default: typing needs a keyboard / on-screen button
}

// Deep-clone a default binding list so callers never share the module's frozen
// constants (a setter mutating a shared array would corrupt the defaults).
const cloneBindingList = (list: Binding[]): Binding[] => list.map((b) => ({ ...b }))

export const cloneDefaultKeys = (): KeyBindings => {
    const result = {} as KeyBindings
    for (const action of GAME_ACTIONS) {
        result[action] = cloneBindingList(DEFAULT_KEYBINDINGS[action])
    }
    return result
}

export const DEFAULT_CONTROL_BINDINGS: ControlBindings = {
    keys: cloneDefaultKeys(),
    gamepad: { ...DEFAULT_GAMEPAD_BINDINGS },
}

// Build a fresh copy of the defaults (so callers never share the frozen module
// constants). Used by every parse/read fallback below.
const defaultBindings = (): ControlBindings => ({
    keys: cloneDefaultKeys(),
    gamepad: { ...DEFAULT_GAMEPAD_BINDINGS },
})

// Validate + normalise one stored binding value into a Binding, or null if it is
// malformed. Tolerant of unknown shapes so a corrupt entry is dropped, not fatal.
const parseBinding = (raw: unknown): Binding | null => {
    if (typeof raw !== "object" || raw === null) return null
    const record = raw as Record<string, unknown>
    if (record.kind === "key") {
        return typeof record.code === "string" && record.code.length > 0
            ? keyBinding(record.code)
            : null
    }
    if (record.kind === "mouse") {
        const button = record.button
        return button === 0 || button === 1 || button === 2
            ? mouseBinding(button)
            : null
    }
    if (record.kind === "wheel") {
        return record.dir === "up" || record.dir === "down"
            ? wheelBinding(record.dir)
            : null
    }
    return null
}

// Normalise one action's stored value into a Binding[]. Accepts:
//   - the new array form: [{kind:"key",code:"Space"}, {kind:"mouse",button:0}]
//   - the OLD single-string form: "Space" (upgraded to [{kind:"key",...}])
// Anything malformed yields null so the caller can fall back to the default.
const parseBindingList = (raw: unknown): Binding[] | null => {
    // Old persisted blob: action -> a single KeyboardEvent.code string. Upgrade
    // it to the new array shape so existing users do not lose their remaps.
    if (typeof raw === "string") {
        return raw.length > 0 ? [keyBinding(raw)] : null
    }
    if (Array.isArray(raw)) {
        const bindings: Binding[] = []
        for (const entry of raw) {
            const binding = parseBinding(entry)
            if (binding !== null) bindings.push(binding)
        }
        // A present-but-empty array is a deliberate "unbound" state; keep it.
        return bindings
    }
    return null
}

// Merge a partial, possibly-malformed record of key bindings onto the defaults.
// Each action's value is normalised independently (and old single-string blobs
// are upgraded), so a partial/old persisted blob upgrades cleanly. Unknown
// actions are dropped.
export const mergeKeyBindings = (raw: unknown): KeyBindings => {
    const result = cloneDefaultKeys()
    if (typeof raw !== "object" || raw === null) return result

    const record = raw as Record<string, unknown>
    for (const action of GAME_ACTIONS) {
        const list = parseBindingList(record[action])
        if (list !== null) {
            result[action] = list
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

// A stable, comparable identity for a binding. Used to dedupe within an action's
// list (so "Add" never inserts the same binding twice) and to spot a binding
// shared across actions (the UI warns on those). Pure, so it is unit-testable.
export const bindingId = (b: Binding): string => {
    if (b.kind === "key") return `key:${b.code}`
    if (b.kind === "mouse") return `mouse:${b.button}`
    return `wheel:${b.dir}`
}

export const bindingsEqual = (a: Binding, b: Binding): boolean => bindingId(a) === bindingId(b)

// Find every binding that is shared by more than one action. Returns the set of
// conflicting binding ids (empty when all bindings are unique). The UI uses this
// to warn: duplicates are allowed (a player may genuinely want one input to do
// two things) but flagged. Duplicate ids within a single action's own list are
// not double-counted (the setters dedupe those away).
export const findDuplicateKeys = (keys: KeyBindings): Set<string> => {
    const counts = new Map<string, number>()
    for (const action of GAME_ACTIONS) {
        const seen = new Set<string>()
        for (const binding of keys[action]) {
            const id = bindingId(binding)
            if (seen.has(id)) continue
            seen.add(id)
            counts.set(id, (counts.get(id) ?? 0) + 1)
        }
    }
    const duplicates = new Set<string>()
    for (const [id, count] of counts) {
        if (count > 1) duplicates.add(id)
    }
    return duplicates
}

// Turn a KeyboardEvent.code into a short, friendly label for display
// ("KeyW" -> "W", "ArrowUp" -> "↑", "Space" -> "Space"). Falls back to the raw
// code for anything unrecognised. Pure, so it is unit-testable.
export const keyCodeLabel = (code: string): string => {
    if (code.length === 0) return "--"
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

// Friendly label for a mouse button index. Pure, so it is unit-testable.
export const mouseButtonLabel = (button: number): string => {
    const named: Record<number, string> = {
        0: "L-Click",
        1: "M-Click",
        2: "R-Click",
    }
    return named[button] ?? `Mouse ${button}`
}

// Friendly label for ANY binding kind, for chip display in the modal. Pure, so
// it is unit-testable.
export const bindingLabel = (b: Binding): string => {
    if (b.kind === "key") return keyCodeLabel(b.code)
    if (b.kind === "mouse") return mouseButtonLabel(b.button)
    return b.dir === "up" ? "Wheel Up" : "Wheel Down"
}

// One-line summary of an action's whole binding list (e.g. "Space / L-Click"),
// for read-only displays like the settings overview. Shows the empty-binding
// glyph (matching keyCodeLabel) when unbound. Pure.
export const bindingListLabel = (bindings: Binding[]): string => {
    if (bindings.length === 0) return "--"
    return bindings.map(bindingLabel).join(" / ")
}

// Friendly label for a gamepad button index under the standard mapping. Falls
// back to "Button N" for anything outside the well-known set, and "--" when
// unbound (-1). Pure, so it is unit-testable.
export const gamepadButtonLabel = (index: number): string => {
    if (index < 0) return "--"
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

// The per-frame input snapshot a binding is resolved against. Decoupled from the
// core listeners (which carry far more) so this stays import-free and testable:
//   - keys:  the keyboard listener's state map (code -> held?).
//   - mouse: which buttons are currently down.
//   - wheel: which wheel directions fired THIS tick (momentary). Empty unless the
//            wheel moved since the last drain.
export type BindingInputState = {
    keys: Record<string, boolean>,
    mouse: { left: boolean, middle: boolean, right: boolean },
    wheel: { up: boolean, down: boolean },
}

// Is this single binding active given the current input snapshot? Key + mouse
// bindings are level (held); wheel bindings are momentary (true only on the tick
// the wheel moved that way). Pure, so it is unit-testable.
export const isBindingActive = (b: Binding, state: BindingInputState): boolean => {
    if (b.kind === "key") return state.keys[b.code] === true
    if (b.kind === "mouse") {
        if (b.button === 0) return state.mouse.left
        if (b.button === 1) return state.mouse.middle
        return state.mouse.right
    }
    return b.dir === "up" ? state.wheel.up : state.wheel.down
}

// Is an ACTION active? True if ANY of its bindings is active. This is what lets
// "fire" be bound to both Space and left-click at once. Pure + testable.
export const isActionActive = (bindings: Binding[], state: BindingInputState): boolean => {
    for (const binding of bindings) {
        if (isBindingActive(binding, state)) return true
    }
    return false
}

// Does a single KeyboardEvent.code match any KEY binding in this list? Used by
// edge-triggered handlers (like opening the chat on a keydown) that work off the
// raw DOM event rather than the per-tick BindingInputState. Only "key" bindings
// can match a keyboard event, so mouse/wheel bindings are ignored here. Pure, so
// it is unit-testable and never special-cases a hard-coded "Slash"/"KeyT".
export const keyMatchesBindings = (code: string, bindings: Binding[]): boolean => {
    for (const binding of bindings) {
        if (binding.kind === "key" && binding.code === code) return true
    }
    return false
}
