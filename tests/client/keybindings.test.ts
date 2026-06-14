import { describe, expect, it } from "vitest"
import {
    DEFAULT_CONTROL_BINDINGS,
    DEFAULT_GAMEPAD_BINDINGS,
    DEFAULT_KEYBINDINGS,
    GAME_ACTIONS,
    findDuplicateKeys,
    gamepadButtonLabel,
    keyCodeLabel,
    mergeGamepadBindings,
    mergeKeyBindings,
    parseControlBindings,
    serializeControlBindings,
} from "../../packages/client/src/store/keybindings"

describe("DEFAULT_KEYBINDINGS", () => {
    it("matches the legacy hardcoded defaults", () => {
        expect(DEFAULT_KEYBINDINGS).toEqual({
            moveUp: "KeyW",
            moveDown: "KeyS",
            moveLeft: "KeyA",
            moveRight: "KeyD",
            fire: "Space",
            tactical: "KeyQ",
            reload: "KeyR",
            scoreboard: "Tab",
        })
    })

    it("has an entry for every action", () => {
        for (const action of GAME_ACTIONS) {
            expect(typeof DEFAULT_KEYBINDINGS[action]).toBe("string")
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
        parsed.keys.fire = "KeyZ"
        expect(DEFAULT_KEYBINDINGS.fire).toBe("Space")
    })

    it("merges a partial keys blob onto the defaults", () => {
        const raw = JSON.stringify({ keys: { fire: "Enter" } })
        const parsed = parseControlBindings(raw)
        expect(parsed.keys.fire).toBe("Enter")
        // Untouched actions keep their defaults.
        expect(parsed.keys.moveUp).toBe("KeyW")
        expect(parsed.keys.reload).toBe("KeyR")
    })

    it("merges a partial gamepad blob onto the defaults", () => {
        const raw = JSON.stringify({ gamepad: { fire: 0 } })
        const parsed = parseControlBindings(raw)
        expect(parsed.gamepad.fire).toBe(0)
        expect(parsed.gamepad.reload).toBe(DEFAULT_GAMEPAD_BINDINGS.reload)
    })

    it("ignores unknown actions in a stored blob", () => {
        const raw = JSON.stringify({ keys: { jump: "KeyJ", fire: "KeyF" } })
        const parsed = parseControlBindings(raw)
        expect((parsed.keys as Record<string, string>).jump).toBeUndefined()
        expect(parsed.keys.fire).toBe("KeyF")
    })
})

describe("mergeKeyBindings", () => {
    it("falls back to defaults for non-object input", () => {
        expect(mergeKeyBindings(undefined)).toEqual(DEFAULT_KEYBINDINGS)
        expect(mergeKeyBindings(null)).toEqual(DEFAULT_KEYBINDINGS)
        expect(mergeKeyBindings("nope")).toEqual(DEFAULT_KEYBINDINGS)
    })

    it("rejects empty-string and non-string values", () => {
        const merged = mergeKeyBindings({ fire: "", reload: 5, tactical: "KeyT" })
        expect(merged.fire).toBe(DEFAULT_KEYBINDINGS.fire)
        expect(merged.reload).toBe(DEFAULT_KEYBINDINGS.reload)
        expect(merged.tactical).toBe("KeyT")
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

    it("round-trips a custom binding set", () => {
        const custom = {
            keys: { ...DEFAULT_KEYBINDINGS, fire: "Enter", reload: "KeyT" },
            gamepad: { ...DEFAULT_GAMEPAD_BINDINGS, fire: 1 },
        }
        expect(parseControlBindings(serializeControlBindings(custom))).toEqual(custom)
    })
})

describe("findDuplicateKeys", () => {
    it("is empty when all bindings are unique", () => {
        expect(findDuplicateKeys(DEFAULT_KEYBINDINGS).size).toBe(0)
    })

    it("reports a key bound to two actions", () => {
        const keys = { ...DEFAULT_KEYBINDINGS, reload: "KeyW" } // collides with moveUp
        const dupes = findDuplicateKeys(keys)
        expect(dupes.has("KeyW")).toBe(true)
        expect(dupes.has("KeyS")).toBe(false)
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
        expect(keyCodeLabel("")).toBe("—")
    })
})

describe("gamepadButtonLabel", () => {
    it("labels known standard-mapping buttons", () => {
        expect(gamepadButtonLabel(0)).toBe("A / ✕")
        expect(gamepadButtonLabel(7)).toBe("RT / R2")
    })

    it("shows a dash for an unbound (-1) button", () => {
        expect(gamepadButtonLabel(-1)).toBe("—")
    })

    it("falls back to Button N for an unknown index", () => {
        expect(gamepadButtonLabel(42)).toBe("Button 42")
    })
})
