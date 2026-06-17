import { describe, expect, it } from "vitest"
import { getStateChanges } from "@pip-pip/core/src/common/state"

// getStateChanges is the deep-diff backbone of the networked State: it decides
// which fields are broadcast each tick. These tests pin its contract, including
// the deliberate array shallow-compare (arrays are reference-compared, NOT deep
// diffed, because isObject excludes them).
describe("getStateChanges", () => {
    it("reports a changed primitive and ignores unchanged ones", () => {
        const { changes, deletions } = getStateChanges({ a: 2, b: 5 }, { a: 1, b: 5 })
        expect(changes).toEqual({ a: 2 })
        expect(deletions).toEqual({})
    })

    it("returns empty changes when nothing changed", () => {
        const { changes, deletions } = getStateChanges({ a: 1, b: "x" }, { a: 1, b: "x" })
        expect(changes).toEqual({})
        expect(deletions).toEqual({})
    })

    it("recurses into nested objects and reports only the changed leaf", () => {
        const { changes } = getStateChanges({ p: { x: 2, y: 5 } }, { p: { x: 1, y: 5 } })
        expect(changes).toEqual({ p: { x: 2 } })
    })

    it("marks a key as deleted when its new value is undefined", () => {
        const { changes, deletions } = getStateChanges({ a: undefined } as { a?: number }, { a: 1 })
        expect(deletions).toEqual({ a: true })
        expect(changes).toEqual({})
    })

    it("marks a key absent from the new state as deleted", () => {
        const { deletions } = getStateChanges({} as { a?: number }, { a: 1 })
        expect(deletions).toEqual({ a: true })
    })

    it("compares array fields by reference (shallow), not by contents", () => {
        // Intentional contract: a field holding the SAME array reference reads as
        // unchanged, but a new array with equal contents reads as a change. Callers
        // must reuse the reference for unchanged array fields or they broadcast every diff.
        const shared = [1, 2, 3]
        expect(getStateChanges({ arr: shared }, { arr: shared }).changes).toEqual({})
        expect(getStateChanges({ arr: [1, 2, 3] }, { arr: [1, 2, 3] }).changes).toEqual({ arr: [1, 2, 3] })
    })
})
