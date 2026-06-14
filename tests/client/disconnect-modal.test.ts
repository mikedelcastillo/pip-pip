import { describe, expect, it, vi } from "vitest"
import type { ReactElement } from "react"

// Stub the CSS-module imports so this plain node suite never runs the Sass/Vite
// pipeline — we only inspect the rendered element tree, not hashed class names.
// Modal and GameButton are imported for real (as function references) so we can
// match nodes by identity; their own sass modules are stubbed too.
vi.mock("../../packages/client/src/components/DisconnectModal.module.sass", () => ({
    default: new Proxy({}, { get: (_target, key) => String(key) }),
}))
vi.mock("../../packages/client/src/components/Modal.module.sass", () => ({
    default: new Proxy({}, { get: (_target, key) => String(key) }),
}))
vi.mock("../../packages/client/src/components/GameButton.module.sass", () => ({
    default: new Proxy({}, { get: (_target, key) => String(key) }),
}))

import DisconnectModal from "../../packages/client/src/components/DisconnectModal"
import Modal from "../../packages/client/src/components/Modal"
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

describe("DisconnectModal", () => {
    const noop = () => undefined

    it("renders a Modal titled \"Disconnected\" that closes to home", () => {
        const onHome = () => undefined
        const tree = DisconnectModal({ onHome, onReconnect: noop }) as AnyElement
        // The root is the shared Modal, so it inherits the backdrop tap / Escape
        // dismiss affordances for free (works on desktop and mobile).
        expect(tree.type).toBe(Modal)
        expect(tree.props.title).toBe("Disconnected")
        // Closing the modal (backdrop tap, Escape, Close) routes to onHome.
        expect(tree.props.onClose).toBe(onHome)
    })

    it("wires Reconnect and Back to Home to their handlers", () => {
        const onHome = () => undefined
        const onReconnect = () => undefined
        const tree = DisconnectModal({ onHome, onReconnect }) as AnyElement
        const buttons = collectByType(tree, GameButton)
        const labels = buttons.map((b) => collectText(b.props.children))
        expect(labels).toContain("Reconnect")
        expect(labels).toContain("Back to Home")

        const reconnectBtn = buttons.find((b) => collectText(b.props.children) === "Reconnect")
        const homeBtn = buttons.find((b) => collectText(b.props.children) === "Back to Home")
        expect(reconnectBtn?.props.onClick).toBe(onReconnect)
        expect(homeBtn?.props.onClick).toBe(onHome)
    })

    it("shows a reconnecting label while a retry is in flight", () => {
        const tree = DisconnectModal({
            onHome: noop,
            onReconnect: noop,
            reconnecting: true,
        }) as AnyElement
        const labels = collectByType(tree, GameButton).map((b) => collectText(b.props.children))
        expect(labels).toContain("Reconnecting...")
        expect(labels).not.toContain("Reconnect")
    })
})
