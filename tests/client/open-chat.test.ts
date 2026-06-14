import { describe, expect, it, vi } from "vitest"

// GameOverlayMatch pulls in the whole HUD (and, through ../game/store, the Pixi
// renderer + every sibling panel's Sass module). This suite only exercises the
// pure open/close helpers it exports, so we stub its heavy direct imports: the
// own Sass module, the store hooks, and every child component is replaced with a
// trivial double. That keeps the import cheap and DOM-free while the real
// keybindings module (which the helpers depend on) loads untouched.
vi.mock("../../packages/client/src/components/GameOverlayMatch.module.sass", () => ({
    default: new Proxy({}, { get: (_target, key) => String(key) }),
}))
vi.mock("../../packages/client/src/game/store", () => ({
    useGameStore: () => undefined,
    fraction: () => 0,
}))
// Each child is replaced with a trivial component double. The factory is inlined
// (not a shared const) because vi.mock is hoisted above any module-level binding.
vi.mock("../../packages/client/src/components/GameChat", () => ({ default: () => null }))
vi.mock("../../packages/client/src/components/GamePlayerList", () => ({ default: () => null }))
vi.mock("../../packages/client/src/components/PauseMenu", () => ({ default: () => null }))
vi.mock("../../packages/client/src/components/KillFeed", () => ({ default: () => null }))
vi.mock("../../packages/client/src/components/PowerupFeed", () => ({ default: () => null }))
vi.mock("../../packages/client/src/components/Minimap", () => ({ default: () => null }))
vi.mock("../../packages/client/src/components/GameBuffBars", () => ({ default: () => null }))
vi.mock("../../packages/client/src/components/RespawnOverlay", () => ({ default: () => null }))

import {
    DEFAULT_GAMEPAD_BINDINGS,
    DEFAULT_KEYBINDINGS,
    GAME_ACTIONS,
    keyBinding,
    keyMatchesBindings,
} from "../../packages/client/src/store/keybindings"
import {
    chatPrefillForKey,
    isEditableTarget,
    shouldOpenChatOnKey,
} from "../../packages/client/src/components/GameOverlayMatch"

// (a) The new openChat action is wired through every keybindings table the same
// way the existing actions are, so it lists + persists + remaps for free.
describe("openChat keybinding wiring", () => {
    it("is part of the ordered GAME_ACTIONS list the bindings UI iterates", () => {
        expect(GAME_ACTIONS).toContain("openChat")
    })

    it("defaults to the \"/\" (Slash) and \"T\" (KeyT) keys", () => {
        expect(DEFAULT_KEYBINDINGS.openChat).toEqual([
            { kind: "key", code: "Slash" },
            { kind: "key", code: "KeyT" },
        ])
    })

    it("has a gamepad default (unbound: typing needs a keyboard)", () => {
        expect(DEFAULT_GAMEPAD_BINDINGS.openChat).toBe(-1)
    })

    it("does not collide with any existing default key binding", () => {
        // Slash and KeyT must be unique, else findDuplicateKeys (and the existing
        // keybindings suite's zero-duplicates assertion) would flag them.
        const codes: string[] = []
        for (const action of GAME_ACTIONS) {
            for (const binding of DEFAULT_KEYBINDINGS[action]) {
                if (binding.kind === "key") codes.push(binding.code)
            }
        }
        expect(codes.filter((c) => c === "Slash")).toHaveLength(1)
        expect(codes.filter((c) => c === "KeyT")).toHaveLength(1)
    })
})

// (b) The pure open/close helpers extracted from GameOverlayMatch decide the open
// behavior without a DOM, so they are directly testable here.
describe("chatPrefillForKey", () => {
    it("seeds a leading \"/\" when opened with the Slash key", () => {
        expect(chatPrefillForKey("Slash")).toBe("/")
    })

    it("opens empty for the T key (or anything else)", () => {
        expect(chatPrefillForKey("KeyT")).toBe("")
        expect(chatPrefillForKey("Enter")).toBe("")
    })
})

describe("isEditableTarget", () => {
    it("treats <input> and <textarea> as editable", () => {
        expect(isEditableTarget({ tagName: "INPUT" } as Element)).toBe(true)
        expect(isEditableTarget({ tagName: "TEXTAREA" } as Element)).toBe(true)
    })

    it("treats a contenteditable host as editable", () => {
        const el = { tagName: "DIV", isContentEditable: true } as unknown as Element
        expect(isEditableTarget(el)).toBe(true)
    })

    it("is false for a plain element or null", () => {
        expect(isEditableTarget({ tagName: "DIV" } as Element)).toBe(false)
        expect(isEditableTarget(null)).toBe(false)
    })
})

describe("shouldOpenChatOnKey", () => {
    const bindings = DEFAULT_KEYBINDINGS.openChat

    it("opens on a bound key when closed and nothing editable is focused", () => {
        expect(shouldOpenChatOnKey("Slash", bindings, false, false)).toBe(true)
        expect(shouldOpenChatOnKey("KeyT", bindings, false, false)).toBe(true)
    })

    it("ignores keys that are not bound to openChat", () => {
        expect(shouldOpenChatOnKey("KeyW", bindings, false, false)).toBe(false)
    })

    it("never re-opens while the chat is already open", () => {
        expect(shouldOpenChatOnKey("Slash", bindings, true, false)).toBe(false)
    })

    it("never hijacks a key while an editable field is focused", () => {
        expect(shouldOpenChatOnKey("Slash", bindings, false, true)).toBe(false)
    })

    it("honors a remapped binding rather than a hard-coded key", () => {
        const remapped = [keyBinding("KeyY")]
        expect(shouldOpenChatOnKey("KeyY", remapped, false, false)).toBe(true)
        // The old default no longer opens once the player has remapped away.
        expect(shouldOpenChatOnKey("Slash", remapped, false, false)).toBe(false)
        // Cross-check against the underlying matcher it relies on.
        expect(keyMatchesBindings("KeyY", remapped)).toBe(true)
    })
})
