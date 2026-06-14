import { describe, expect, it } from "vitest"
import {
    Binding,
    BindingInputState,
    DEFAULT_CONTROL_BINDINGS,
    DEFAULT_GAMEPAD_BINDINGS,
    DEFAULT_KEYBINDINGS,
    GAME_ACTIONS,
    bindingId,
    bindingLabel,
    bindingsEqual,
    findDuplicateKeys,
    gamepadButtonLabel,
    isActionActive,
    isBindingActive,
    keyBinding,
    keyCodeLabel,
    mergeGamepadBindings,
    mergeKeyBindings,
    mouseBinding,
    mouseButtonLabel,
    parseControlBindings,
    serializeControlBindings,
    wheelBinding,
} from "../../packages/client/src/store/keybindings"

describe("DEFAULT_KEYBINDINGS", () => {
    it("matches the legacy defaults expressed as the multi-binding model", () => {
        expect(DEFAULT_KEYBINDINGS).toEqual({
            moveUp: [{ kind: "key", code: "KeyW" }],
            moveDown: [{ kind: "key", code: "KeyS" }],
            moveLeft: [{ kind: "key", code: "KeyA" }],
            moveRight: [{ kind: "key", code: "KeyD" }],
            fire: [{ kind: "key", code: "Space" }, { kind: "mouse", button: 0 }],
            tactical: [{ kind: "key", code: "KeyQ" }, { kind: "mouse", button: 2 }],
            reload: [{ kind: "key", code: "KeyR" }],
            scoreboard: [{ kind: "key", code: "Tab" }],
            openChat: [{ kind: "key", code: "Slash" }, { kind: "key", code: "KeyT" }],
        })
    })

    it("has a binding list for every action and a gamepad index", () => {
        for (const action of GAME_ACTIONS) {
            expect(Array.isArray(DEFAULT_KEYBINDINGS[action])).toBe(true)
            expect(typeof DEFAULT_GAMEPAD_BINDINGS[action]).toBe("number")
        }
    })
})

describe("parseControlBindings", () => {
    it("returns defaults for null", () => {
        expect(parseControlBindings(null)).toEqual(DEFAULT_CONTROL_BINDINGS)
    })

    it("returns defaults for malformed JSON", () => {
        expect(parseControlBindings("{not json")).toEqual(DEFAULT_CONTROL_BINDINGS)
    })

    it("returns defaults for non-object JSON", () => {
        expect(parseControlBindings("42")).toEqual(DEFAULT_CONTROL_BINDINGS)
        expect(parseControlBindings("null")).toEqual(DEFAULT_CONTROL_BINDINGS)
    })

    it("does not share references with the module defaults", () => {
        const parsed = parseControlBindings(null)
        parsed.keys.fire.push(keyBinding("KeyZ"))
        expect(DEFAULT_KEYBINDINGS.fire).toHaveLength(2)
    })

    it("merges a partial keys blob (new array shape) onto the defaults", () => {
        const raw = JSON.stringify({ keys: { fire: [{ kind: "key", code: "Enter" }] } })
        const parsed = parseControlBindings(raw)
        expect(parsed.keys.fire).toEqual([{ kind: "key", code: "Enter" }])
        // Untouched actions keep their defaults.
        expect(parsed.keys.moveUp).toEqual([{ kind: "key", code: "KeyW" }])
        expect(parsed.keys.reload).toEqual([{ kind: "key", code: "KeyR" }])
    })

    it("accepts a multi-kind binding list", () => {
        const raw = JSON.stringify({
            keys: {
                fire: [
                    { kind: "key", code: "Space" },
                    { kind: "mouse", button: 0 },
                    { kind: "wheel", dir: "up" },
                ],
            },
        })
        const parsed = parseControlBindings(raw)
        expect(parsed.keys.fire).toEqual([
            { kind: "key", code: "Space" },
            { kind: "mouse", button: 0 },
            { kind: "wheel", dir: "up" },
        ])
    })

    it("drops malformed bindings inside an otherwise valid list", () => {
        const raw = JSON.stringify({
            keys: {
                fire: [
                    { kind: "key", code: "Space" },
                    { kind: "mouse", button: 9 }, // out of range, dropped
                    { kind: "wheel", dir: "sideways" }, // bad dir, dropped
                    { kind: "bogus" }, // unknown kind, dropped
                    42, // not an object, dropped
                ],
            },
        })
        const parsed = parseControlBindings(raw)
        expect(parsed.keys.fire).toEqual([{ kind: "key", code: "Space" }])
    })

    it("keeps a present-but-empty list as an unbound action", () => {
        const raw = JSON.stringify({ keys: { fire: [] } })
        const parsed = parseControlBindings(raw)
        expect(parsed.keys.fire).toEqual([])
    })

    it("UPGRADES an old single-string-per-action blob to the array shape", () => {
        // The legacy persisted shape: action -> a single KeyboardEvent.code.
        const oldBlob = JSON.stringify({
            keys: {
                moveUp: "KeyI",
                fire: "Enter",
            },
            gamepad: { fire: 0 },
        })
        const parsed = parseControlBindings(oldBlob)
        expect(parsed.keys.moveUp).toEqual([{ kind: "key", code: "KeyI" }])
        expect(parsed.keys.fire).toEqual([{ kind: "key", code: "Enter" }])
        // Untouched actions still fall back to their (new-shape) defaults.
        expect(parsed.keys.reload).toEqual([{ kind: "key", code: "KeyR" }])
        // Gamepad still merges as before.
        expect(parsed.gamepad.fire).toBe(0)
    })

    it("merges a partial gamepad blob onto the defaults", () => {
        const raw = JSON.stringify({ gamepad: { fire: 0 } })
        const parsed = parseControlBindings(raw)
        expect(parsed.gamepad.fire).toBe(0)
        expect(parsed.gamepad.reload).toBe(DEFAULT_GAMEPAD_BINDINGS.reload)
    })

    it("ignores unknown actions in a stored blob", () => {
        const raw = JSON.stringify({ keys: { jump: [{ kind: "key", code: "KeyJ" }] } })
        const parsed = parseControlBindings(raw)
        expect((parsed.keys as Record<string, unknown>).jump).toBeUndefined()
    })
})

describe("mergeKeyBindings", () => {
    it("falls back to defaults for non-object input", () => {
        expect(mergeKeyBindings(undefined)).toEqual(DEFAULT_KEYBINDINGS)
        expect(mergeKeyBindings(null)).toEqual(DEFAULT_KEYBINDINGS)
        expect(mergeKeyBindings("nope")).toEqual(DEFAULT_KEYBINDINGS)
    })

    it("upgrades old string values and keeps defaults for bad values", () => {
        const merged = mergeKeyBindings({ fire: "Enter", reload: 5, tactical: "KeyT" })
        expect(merged.fire).toEqual([{ kind: "key", code: "Enter" }])
        // A number is neither a string nor an array, so reload keeps its default.
        expect(merged.reload).toEqual(DEFAULT_KEYBINDINGS.reload)
        expect(merged.tactical).toEqual([{ kind: "key", code: "KeyT" }])
    })

    it("treats an empty old string as no binding (falls back to default)", () => {
        const merged = mergeKeyBindings({ fire: "" })
        expect(merged.fire).toEqual(DEFAULT_KEYBINDINGS.fire)
    })
})

describe("mergeGamepadBindings", () => {
    it("accepts integers >= -1 and rejects everything else", () => {
        const merged = mergeGamepadBindings({
            fire: 0,
            tactical: -1,
            reload: 1.5, // non-integer rejected
            scoreboard: -2, // below -1 rejected
            moveUp: "3", // wrong type rejected
        })
        expect(merged.fire).toBe(0)
        expect(merged.tactical).toBe(-1)
        expect(merged.reload).toBe(DEFAULT_GAMEPAD_BINDINGS.reload)
        expect(merged.scoreboard).toBe(DEFAULT_GAMEPAD_BINDINGS.scoreboard)
        expect(merged.moveUp).toBe(DEFAULT_GAMEPAD_BINDINGS.moveUp)
    })

    it("rejects NaN", () => {
        expect(mergeGamepadBindings({ fire: NaN }).fire).toBe(DEFAULT_GAMEPAD_BINDINGS.fire)
    })
})

describe("serializeControlBindings -> parseControlBindings", () => {
    it("round-trips the defaults", () => {
        expect(parseControlBindings(serializeControlBindings(DEFAULT_CONTROL_BINDINGS)))
            .toEqual(DEFAULT_CONTROL_BINDINGS)
    })

    it("round-trips a custom multi-binding set", () => {
        const custom = {
            keys: {
                ...DEFAULT_CONTROL_BINDINGS.keys,
                fire: [keyBinding("Enter"), mouseBinding(0), wheelBinding("down")],
                reload: [keyBinding("KeyT")],
            },
            gamepad: { ...DEFAULT_GAMEPAD_BINDINGS, fire: 1 },
        }
        expect(parseControlBindings(serializeControlBindings(custom))).toEqual(custom)
    })
})

describe("bindingId / bindingsEqual", () => {
    it("gives a stable, kind-aware identity", () => {
        expect(bindingId(keyBinding("Space"))).toBe("key:Space")
        expect(bindingId(mouseBinding(1))).toBe("mouse:1")
        expect(bindingId(wheelBinding("up"))).toBe("wheel:up")
    })

    it("compares by identity, not reference", () => {
        expect(bindingsEqual(mouseBinding(0), mouseBinding(0))).toBe(true)
        expect(bindingsEqual(keyBinding("Space"), keyBinding("Enter"))).toBe(false)
        expect(bindingsEqual(mouseBinding(0), wheelBinding("up"))).toBe(false)
    })
})

describe("findDuplicateKeys", () => {
    it("is empty when every binding is unique across actions", () => {
        expect(findDuplicateKeys(DEFAULT_KEYBINDINGS).size).toBe(0)
    })

    it("reports a binding shared by two actions", () => {
        const keys = {
            ...DEFAULT_CONTROL_BINDINGS.keys,
            reload: [keyBinding("KeyW")], // collides with moveUp
        }
        const dupes = findDuplicateKeys(keys)
        expect(dupes.has("key:KeyW")).toBe(true)
        expect(dupes.has("key:KeyS")).toBe(false)
    })

    it("does not flag a binding repeated within a single action's own list", () => {
        const keys = {
            ...DEFAULT_CONTROL_BINDINGS.keys,
            fire: [keyBinding("Space"), keyBinding("Space")],
            // strip the mouse default off the other actions so nothing else collides
            tactical: [keyBinding("KeyQ")],
        }
        const dupes = findDuplicateKeys(keys)
        expect(dupes.has("key:Space")).toBe(false)
    })

    it("flags a mouse button shared across actions", () => {
        const keys = {
            ...DEFAULT_CONTROL_BINDINGS.keys,
            fire: [keyBinding("Space"), mouseBinding(0)],
            reload: [keyBinding("KeyR"), mouseBinding(0)],
        }
        const dupes = findDuplicateKeys(keys)
        expect(dupes.has("mouse:0")).toBe(true)
    })
})

describe("keyCodeLabel", () => {
    it("strips the Key/Digit/Numpad prefixes", () => {
        expect(keyCodeLabel("KeyW")).toBe("W")
        expect(keyCodeLabel("Digit1")).toBe("1")
        expect(keyCodeLabel("Numpad5")).toBe("Num 5")
    })

    it("maps named codes to friendly glyphs", () => {
        expect(keyCodeLabel("ArrowUp")).toBe("↑")
        expect(keyCodeLabel("Space")).toBe("Space")
        expect(keyCodeLabel("Tab")).toBe("Tab")
        expect(keyCodeLabel("ShiftLeft")).toBe("L Shift")
    })

    it("falls back to the raw code and handles empty", () => {
        expect(keyCodeLabel("F13")).toBe("F13")
        expect(keyCodeLabel("")).toBe("--")
    })
})

describe("mouseButtonLabel", () => {
    it("labels the standard three buttons", () => {
        expect(mouseButtonLabel(0)).toBe("L-Click")
        expect(mouseButtonLabel(1)).toBe("M-Click")
        expect(mouseButtonLabel(2)).toBe("R-Click")
    })

    it("falls back for an unknown button index", () => {
        expect(mouseButtonLabel(4)).toBe("Mouse 4")
    })
})

describe("bindingLabel", () => {
    it("labels every binding kind", () => {
        expect(bindingLabel(keyBinding("Space"))).toBe("Space")
        expect(bindingLabel(keyBinding("KeyW"))).toBe("W")
        expect(bindingLabel(mouseBinding(0))).toBe("L-Click")
        expect(bindingLabel(mouseBinding(2))).toBe("R-Click")
        expect(bindingLabel(wheelBinding("up"))).toBe("Wheel Up")
        expect(bindingLabel(wheelBinding("down"))).toBe("Wheel Down")
    })
})

describe("gamepadButtonLabel", () => {
    it("labels known standard-mapping buttons", () => {
        expect(gamepadButtonLabel(0)).toBe("A / ✕")
        expect(gamepadButtonLabel(7)).toBe("RT / R2")
    })

    it("shows a dash for an unbound (-1) button", () => {
        expect(gamepadButtonLabel(-1)).toBe("--")
    })

    it("falls back to Button N for an unknown index", () => {
        expect(gamepadButtonLabel(42)).toBe("Button 42")
    })
})

describe("isBindingActive", () => {
    const state = (over: Partial<BindingInputState> = {}): BindingInputState => ({
        keys: {},
        mouse: { left: false, middle: false, right: false },
        wheel: { up: false, down: false },
        ...over,
    })

    it("resolves a key binding via the keyboard state map", () => {
        expect(isBindingActive(keyBinding("Space"), state({ keys: { Space: true } }))).toBe(true)
        expect(isBindingActive(keyBinding("Space"), state({ keys: { Space: false } }))).toBe(false)
        expect(isBindingActive(keyBinding("Space"), state())).toBe(false)
    })

    it("resolves a mouse binding via the mouse button flags (0=left,1=middle,2=right)", () => {
        expect(isBindingActive(mouseBinding(0), state({ mouse: { left: true, middle: false, right: false } }))).toBe(true)
        expect(isBindingActive(mouseBinding(1), state({ mouse: { left: false, middle: true, right: false } }))).toBe(true)
        expect(isBindingActive(mouseBinding(2), state({ mouse: { left: false, middle: false, right: true } }))).toBe(true)
        expect(isBindingActive(mouseBinding(2), state({ mouse: { left: true, middle: false, right: false } }))).toBe(false)
    })

    it("resolves a wheel binding as a momentary direction trigger", () => {
        expect(isBindingActive(wheelBinding("up"), state({ wheel: { up: true, down: false } }))).toBe(true)
        expect(isBindingActive(wheelBinding("down"), state({ wheel: { up: false, down: true } }))).toBe(true)
        expect(isBindingActive(wheelBinding("up"), state({ wheel: { up: false, down: true } }))).toBe(false)
        expect(isBindingActive(wheelBinding("up"), state())).toBe(false)
    })
})

describe("isActionActive", () => {
    const state = (over: Partial<BindingInputState> = {}): BindingInputState => ({
        keys: {},
        mouse: { left: false, middle: false, right: false },
        wheel: { up: false, down: false },
        ...over,
    })

    const fire: Binding[] = [keyBinding("Space"), mouseBinding(0)]

    it("is active if ANY binding is active (Space OR left-click fires)", () => {
        expect(isActionActive(fire, state({ keys: { Space: true } }))).toBe(true)
        expect(isActionActive(fire, state({ mouse: { left: true, middle: false, right: false } }))).toBe(true)
    })

    it("is inactive when no binding is active", () => {
        expect(isActionActive(fire, state())).toBe(false)
    })

    it("is inactive for an empty (unbound) action", () => {
        expect(isActionActive([], state({ keys: { Space: true } }))).toBe(false)
    })
})
