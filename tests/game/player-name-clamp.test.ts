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

    it("does not split an emoji at the boundary into a lone surrogate", () => {
        // 15 ASCII + a 2-code-unit emoji lands the emoji at slot 16: keep it whole.
        const name = "a".repeat(MAX_PLAYER_NAME_LENGTH - 1) + "\u{1F600}" + "tail"
        const result = clampPlayerName(name)
        expect([...result].length).toBe(MAX_PLAYER_NAME_LENGTH)
        expect(result.endsWith("\u{1F600}")).toBe(true)
        // A split surrogate would round-trip through UTF-8 as U+FFFD; a whole one does not.
        expect(result).not.toContain("�")
        expect(new TextDecoder().decode(new TextEncoder().encode(result))).toBe(result)
    })

    it("keeps the cap comfortably above the longest bot name", () => {
        // Bot names are "BOT-" + difficulty letter + "-" + 3-char id = 9 chars.
        const botName = "BOT-H-ABC"
        expect(botName.length).toBeLessThanOrEqual(MAX_PLAYER_NAME_LENGTH)
        expect(clampPlayerName(botName)).toBe(botName)
    })

    it("handles an empty string", () => {
        expect(clampPlayerName("")).toBe("")
    })
})
