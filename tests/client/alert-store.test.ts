import { describe, expect, it, beforeEach } from "vitest"
import { useAlertStore, showAlert } from "../../packages/client/src/store/alert"

// The global alert store backs AlertModal, which replaces native alert(). These
// lock in the contract the host/join error paths rely on: showAlert raises a
// message (with an optional title) and clear() takes it back down.
describe("alert store", () => {
    beforeEach(() => useAlertStore.getState().clear())

    it("starts with no alert showing", () => {
        expect(useAlertStore.getState().message).toBe(null)
    })

    it("showAlert sets the message and a default title", () => {
        showAlert("Could not host a game!")
        const state = useAlertStore.getState()
        expect(state.message).toBe("Could not host a game!")
        expect(state.title).toBe("Heads up")
    })

    it("showAlert accepts a custom title", () => {
        showAlert("Could not host a game!", "Could not host")
        expect(useAlertStore.getState().title).toBe("Could not host")
    })

    it("clear takes the alert back down", () => {
        showAlert("boom")
        useAlertStore.getState().clear()
        expect(useAlertStore.getState().message).toBe(null)
    })
})
