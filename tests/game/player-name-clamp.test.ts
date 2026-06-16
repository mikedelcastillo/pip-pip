import { describe, expect, it } from "vitest"
import { clampPlayerName, MAX_PLAYER_NAME_LENGTH } from "@pip-pip/game/src/logic/player"

// Player names are display-only but flow over the wire and into several tight HUD
// layouts (spectate panel, scoreboard, kill feed). clampPlayerName is the single
// chokepoint (called from setName on every side) that bounds them.
describe("clampPlayerName", () => {
    it("leaves a short name untouched", () => {
        expect(clampPlayerName("Pilot123")).toBe("Pilot123")
    })

    it("leaves a name at exactly the cap untouched", () => {
        const exact = "a".repeat(MAX_PLAYER_NAME_LENGTH)
        expect(clampPlayerName(exact)).toBe(exact)
        expect(clampPlayerName(exact).length).toBe(MAX_PLAYER_NAME_LENGTH)
    })

    it("truncates a name longer than the cap to exactly the cap", () => {
        const long = "a".repeat(MAX_PLAYER_NAME_LENGTH + 50)
        const result = clampPlayerName(long)
        expect([...result].length).toBe(MAX_PLAYER_NAME_LENGTH)
        expect(result).toBe("a".repeat(MAX_PLAYER_NAME_LENGTH))
    })

    it("strips characters outside the alphanumeric + underscore policy", () => {
        // The single name policy keeps [0-9a-z_] only, so spaces, punctuation, and
        // emoji are removed rather than preserved.
        expect(clampPlayerName("Cool Name")).toBe("CoolName")
        expect(clampPlayerName("a-b.c")).toBe("abc")
        expect(clampPlayerName("hi\u{1F600}there")).toBe("hithere")
        expect(clampPlayerName("under_score_ok")).toBe("under_score_ok")
    })

    it("keeps the cap comfortably above the longest bot name", () => {
        // Bot names are "BOT_" + difficulty letter + "_" + 3-char id = 9 chars, all
        // alphanumeric + underscore so they pass the name policy unchanged.
        const botName = "BOT_H_ABC"
        expect(botName.length).toBeLessThanOrEqual(MAX_PLAYER_NAME_LENGTH)
        expect(clampPlayerName(botName)).toBe(botName)
    })

    it("handles an empty string", () => {
        expect(clampPlayerName("")).toBe("")
    })
})
