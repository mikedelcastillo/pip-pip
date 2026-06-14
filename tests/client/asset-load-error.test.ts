import { describe, expect, it, vi } from "vitest"
import type { ReactElement } from "react"

// Stub the CSS-module imports so this plain node suite never runs the Sass/Vite
// pipeline. GameButton is imported for real so we can match it by identity.
vi.mock("../../packages/client/src/components/AssetLoadError.module.sass", () => ({
    default: new Proxy({}, { get: (_target, key) => String(key) }),
}))
vi.mock("../../packages/client/src/components/GameButton.module.sass", () => ({
    default: new Proxy({}, { get: (_target, key) => String(key) }),
}))

import AssetLoadError from "../../packages/client/src/components/AssetLoadError"
import GameButton from "../../packages/client/src/components/GameButton"

type AnyElement = ReactElement<Record<string, unknown>>

// Depth-first collect every element whose `type` is the given component fn.
const collectByType = (node: unknown, type: unknown): AnyElement[] => {
    const out: AnyElement[] = []
    const walk = (n: unknown) => {
        if (n === null || typeof n !== "object") return
        const el = n as AnyElement
        if (el.type === type) out.push(el)
        const children = (el.props?.children ?? []) as unknown
        const list = Array.isArray(children) ? children : [children]
        for (const child of list) walk(child)
    }
    walk(node)
    return out
}

const collectText = (node: unknown): string => {
    if (node === null || node === undefined || typeof node === "boolean") return ""
    if (typeof node === "string" || typeof node === "number") return String(node)
    if (Array.isArray(node)) return node.map(collectText).join("")
    const el = node as AnyElement
    return collectText(el.props?.children)
}

// Locks in the in-app retry contract: the asset-load failure screen renders a
// real GameButton wired to onRetry, so the player never hits a native
// alert()/prompt() (which steal focus and look broken on mobile).
describe("AssetLoadError", () => {
    it("renders a Retry button wired to onRetry", () => {
        const onRetry = () => undefined
        const tree = AssetLoadError({ onRetry }) as AnyElement
        const buttons = collectByType(tree, GameButton)
        const labels = buttons.map((b) => collectText(b.props.children))
        expect(labels).toContain("Retry")

        const retryBtn = buttons.find((b) => collectText(b.props.children) === "Retry")
        expect(retryBtn?.props.onClick).toBe(onRetry)
    })

    it("explains the failure to the player", () => {
        const tree = AssetLoadError({ onRetry: () => undefined }) as AnyElement
        const text = collectText(tree)
        expect(text).toContain("Could not load the game")
        expect(text).toContain("try again")
    })
})
