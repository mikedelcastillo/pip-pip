import { describe, expect, it, vi } from "vitest"

// These are the pure helpers the server-browser rows are built from: the "3 / 8"
// players label, the clamped fill fraction, and the open/busy/full bucketing the
// .sass colours each badge by. They carry no React/DOM/Pixi dependencies of their
// own, but importing the component module evaluates its top-level imports, so we
// stub the sass modules (the node suite can't run the Sass/Vite pipeline) and the
// heavy `../game` barrel (GAME_CONTEXT pulls in Pixi) just to let the import land.
vi.mock("../../packages/client/src/components/PublicMatchBrowser.module.sass", () => ({
    default: new Proxy({}, { get: (_target, key) => String(key) }),
}))
vi.mock("../../packages/client/src/components/Modal.module.sass", () => ({
    default: new Proxy({}, { get: (_target, key) => String(key) }),
}))
vi.mock("../../packages/client/src/components/GameButton.module.sass", () => ({
    default: new Proxy({}, { get: (_target, key) => String(key) }),
}))
vi.mock("react-router-dom", () => ({
    useNavigate: () => () => undefined,
}))
vi.mock("../../packages/client/src/game", () => ({
    GAME_CONTEXT: { client: { listPublicLobbies: async () => [] } },
}))

import {
    formatPlayerCount,
    fillFraction,
    fillState,
} from "../../packages/client/src/components/PublicMatchBrowser"

describe("formatPlayerCount", () => {
    it("formats the players label as a spaced \"3 / 8\"", () => {
        expect(formatPlayerCount(3, 8)).toBe("3 / 8")
        expect(formatPlayerCount(0, 8)).toBe("0 / 8")
        expect(formatPlayerCount(8, 8)).toBe("8 / 8")
    })
})

describe("fillFraction", () => {
    it("returns the fraction filled for a normal lobby", () => {
        expect(fillFraction(0, 8)).toBeCloseTo(0)
        expect(fillFraction(4, 8)).toBeCloseTo(0.5)
        expect(fillFraction(8, 8)).toBeCloseTo(1)
    })

    it("clamps to 0..1 and treats a non-positive max as full", () => {
        // A malformed lobby must never divide by zero or push the bar past full.
        expect(fillFraction(1, 0)).toBe(1)
        expect(fillFraction(5, -2)).toBe(1)
        expect(fillFraction(-3, 8)).toBe(0)
        expect(fillFraction(99, 8)).toBe(1)
    })
})

describe("fillState", () => {
    it("buckets the fill fraction into open / busy / full", () => {
        expect(fillState(0)).toBe("open")
        expect(fillState(0.5)).toBe("open")
        expect(fillState(0.7)).toBe("busy")
        expect(fillState(0.9)).toBe("busy")
        expect(fillState(1)).toBe("full")
    })

    it("composes with fillFraction so a full lobby reads \"full\"", () => {
        // The row marks a lobby "Full" (and skips the Join hint) exactly when the
        // fraction hits the full bucket; verify the two helpers agree end-to-end.
        expect(fillState(fillFraction(8, 8))).toBe("full")
        expect(fillState(fillFraction(7, 8))).toBe("busy")
        expect(fillState(fillFraction(2, 8))).toBe("open")
        // A malformed (zero-max) lobby clamps full rather than crashing.
        expect(fillState(fillFraction(1, 0))).toBe("full")
    })
})
