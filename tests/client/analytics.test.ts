import { afterEach, describe, expect, it, vi } from "vitest"
import {
    analyticsEnabled,
    initAnalytics,
    trackEvent,
    trackPageView,
} from "../../packages/client/src/analytics"

// The suite runs under the plain node environment with no VITE_GA_MEASUREMENT_ID
// set, so the module captured an undefined id and analytics is disabled. These
// cases prove the disabled path is a complete no-op: nothing throws and the DOM
// is never touched (there is no DOM here, so any access would throw outright).
describe("analytics (disabled: no measurement id, no DOM)", () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it("reports disabled when no id is configured", () => {
        expect(analyticsEnabled()).toBe(false)
    })

    it("initAnalytics is a silent no-op", () => {
        expect(() => initAnalytics()).not.toThrow()
    })

    it("trackEvent is a silent no-op", () => {
        expect(() => trackEvent("host_game")).not.toThrow()
        expect(() => trackEvent("join_game", { code: "abc" })).not.toThrow()
    })

    it("trackPageView is a silent no-op", () => {
        expect(() => trackPageView("/")).not.toThrow()
    })

    it("never reaches for window.gtag while disabled", () => {
        // A throwing gtag would surface if the disabled guard were skipped.
        const gtag = vi.fn(() => { throw new Error("should not be called") })
        vi.stubGlobal("window", { gtag })
        trackEvent("host_game")
        trackPageView("/")
        initAnalytics()
        expect(gtag).not.toHaveBeenCalled()
    })
})
