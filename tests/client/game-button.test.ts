import { describe, expect, it, vi } from "vitest"
import type { ReactElement } from "react"

// The CSS-module import is stubbed so the suite (a plain node environment) never
// runs the Sass/Vite pipeline — we only care about the rendered element shape,
// not the real hashed class names. Returning identity-ish keys lets the
// className assertions below match on the stable stems ("accent", etc.).
vi.mock("../../packages/client/src/components/GameButton.module.sass", () => ({
    default: new Proxy({}, { get: (_target, key) => String(key) }),
}))

import GameButton from "../../packages/client/src/components/GameButton"

// GameButton is a pure function component, so we can render it to a React
// element tree and inspect the shape directly — no DOM/renderer needed (the
// suite runs in a plain node environment). These assertions lock in the
// accessibility contract: a real, focusable <button type="button"> that still
// exposes the .top/.bottom/.text layered structure and the className/accent API.

type AnyElement = ReactElement<Record<string, unknown>>

// Depth-first search for the first element whose className contains `needle`.
const findByClassFragment = (
    node: unknown,
    needle: string,
): AnyElement | undefined => {
    if (node === null || typeof node !== "object") return undefined
    const el = node as AnyElement
    const className = el.props?.className
    if (typeof className === "string" && className.includes(needle)) return el
    const children = el.props?.children
    const list = Array.isArray(children) ? children : [children]
    for (const child of list) {
        const found = findByClassFragment(child, needle)
        if (found) return found
    }
    return undefined
}

const collectText = (node: unknown): string => {
    if (node === null || node === undefined || typeof node === "boolean") return ""
    if (typeof node === "string" || typeof node === "number") return String(node)
    if (Array.isArray(node)) return node.map(collectText).join("")
    const el = node as AnyElement
    return collectText(el.props?.children)
}

describe("GameButton accessibility", () => {
    it("renders a native, focusable <button type=\"button\">", () => {
        const tree = GameButton({ children: "Host Game" }) as AnyElement
        // A real <button> is keyboard-focusable and fires on Enter/Space for
        // free — no role/tabIndex/key-handler shims required.
        expect(tree.type).toBe("button")
        expect(tree.props.type).toBe("button")
    })

    it("forwards the onClick handler to the button element", () => {
        const onClick = () => undefined
        const tree = GameButton({ children: "Go", onClick }) as AnyElement
        expect(tree.props.onClick).toBe(onClick)
    })

    it("keeps the layered .top/.bottom/.text structure", () => {
        const tree = GameButton({ children: "Go" }) as AnyElement
        expect(findByClassFragment(tree, "top")).toBeDefined()
        expect(findByClassFragment(tree, "bottom")).toBeDefined()
        const text = findByClassFragment(tree, "text")
        expect(text).toBeDefined()
        expect(collectText(text)).toBe("Go")
    })

    it("preserves the accent and className API on the root button", () => {
        const tree = GameButton({
            children: "Go",
            accent: true,
            className: "my-custom-class",
        }) as AnyElement
        const className = tree.props.className as string
        // accent maps to the module's accent class (hashed, so match the stem)
        // and the caller-supplied className is appended verbatim.
        expect(className).toMatch(/accent/)
        expect(className).toContain("my-custom-class")
    })

    it("omits the accent class when not accented", () => {
        const tree = GameButton({ children: "Go" }) as AnyElement
        const className = tree.props.className as string
        expect(className).not.toMatch(/accent/)
    })
})
