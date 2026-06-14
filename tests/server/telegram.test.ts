import { describe, expect, it, vi } from "vitest"

import {
    buildConfig,
    createTelegramBot,
    formatServerStart,
    isAdmin,
    parseAdminIds,
    routeCommand,
    ServerSnapshot,
    TelegramBot,
    TelegramConfig,
} from "@pip-pip/server/src/telegram"

// A fixed snapshot the command formatters read from. Kept tiny but realistic.
function makeSnapshot(overrides: Partial<ServerSnapshot> = {}): ServerSnapshot{
    return {
        region: "asia-southeast1",
        port: 8443,
        commit: "abc1234 test commit",
        startedAt: Date.now() - 5000,
        lobbyCount: 2,
        publicLobbyCount: 1,
        totalPlayers: 3,
        botCount: 1,
        players: ["Robin", "Wren", "Finch"],
        lobbies: [
            { id: "AAAA", name: "Nest", isPublic: true, playerCount: 2 },
            { id: "BBBB", name: "Roost", isPublic: false, playerCount: 1 },
        ],
        ...overrides,
    }
}

const getSnapshot = () => makeSnapshot()

describe("formatServerStart", () => {
    it("includes the deployed commit so admins know what is live", () => {
        const text = formatServerStart(makeSnapshot({ commit: "deadbee Fix the thing" }))
        expect(text).toContain("deadbee Fix the thing")
        expect(text).toContain("server is up")
    })
})

describe("parseAdminIds", () => {
    it("parses a clean comma list", () => {
        expect(parseAdminIds("111,222,333")).toEqual([111, 222, 333])
    })

    it("handles spaces around ids and the commas", () => {
        expect(parseAdminIds(" 111 , 222 ,333 ")).toEqual([111, 222, 333])
    })

    it("drops empty entries and trailing commas", () => {
        expect(parseAdminIds("111,,222,")).toEqual([111, 222])
        expect(parseAdminIds("")).toEqual([])
        expect(parseAdminIds("   ")).toEqual([])
    })

    it("drops garbage / non-integer tokens", () => {
        expect(parseAdminIds("111,abc,222,1.5,0x10")).toEqual([111, 222])
    })

    it("de-duplicates repeated ids", () => {
        expect(parseAdminIds("111,111,222")).toEqual([111, 222])
    })

    it("returns [] for undefined", () => {
        expect(parseAdminIds(undefined)).toEqual([])
    })
})

describe("buildConfig", () => {
    it("returns undefined when the token is unset/empty/whitespace", () => {
        expect(buildConfig(undefined, "111")).toBeUndefined()
        expect(buildConfig("", "111")).toBeUndefined()
        expect(buildConfig("   ", "111")).toBeUndefined()
    })

    it("builds config with trimmed token and parsed admin ids", () => {
        const config = buildConfig("  secret-token  ", "111, 222")
        expect(config).toEqual({ token: "secret-token", adminIds: [111, 222] })
    })

    it("allows a token with no admin ids", () => {
        expect(buildConfig("token", undefined)).toEqual({ token: "token", adminIds: [] })
    })
})

describe("isAdmin", () => {
    const config: TelegramConfig = { token: "t", adminIds: [111, 222] }
    it("is true for listed ids", () => {
        expect(isAdmin(config, 111)).toBe(true)
        expect(isAdmin(config, 222)).toBe(true)
    })
    it("is false for unlisted ids", () => {
        expect(isAdmin(config, 999)).toBe(false)
    })
})

describe("routeCommand public commands (work for ANYONE)", () => {
    const config: TelegramConfig = { token: "t", adminIds: [111] }

    it("/userinfo returns the sender's id for a non-admin", () => {
        const result = routeCommand(config, 999, "/userinfo", getSnapshot)
        expect(result.text).toBe("Your Telegram user id is 999")
    })

    it("/start also returns the sender's id (bootstrap)", () => {
        const result = routeCommand(config, 42, "/start", getSnapshot)
        expect(result.text).toBe("Your Telegram user id is 42")
    })

    it("/userinfo returns the sender's id for an admin too", () => {
        const result = routeCommand(config, 111, "/userinfo", getSnapshot)
        expect(result.text).toBe("Your Telegram user id is 111")
    })

    it("/ping replies pong", () => {
        const result = routeCommand(config, 999, "/ping", getSnapshot)
        expect(result.text).toContain("pong")
    })
})

describe("routeCommand admin gating", () => {
    const config: TelegramConfig = { token: "t", adminIds: [111] }

    it("denies /reboot for a non-admin and does NOT ask to reboot", () => {
        const result = routeCommand(config, 999, "/reboot", getSnapshot)
        expect(result.reboot).not.toBe(true)
        expect(result.text).toContain("admins only")
    })

    it("allows /reboot for an admin and flags reboot", () => {
        const result = routeCommand(config, 111, "/reboot", getSnapshot)
        expect(result.reboot).toBe(true)
        expect(result.text).toBe("Rebooting...")
    })

    it("denies /status, /stats, /players, /lobbies, /dice for non-admins", () => {
        for(const command of ["/status", "/stats", "/players", "/lobbies", "/dice"]){
            const result = routeCommand(config, 999, command, getSnapshot)
            expect(result.text).toContain("admins only")
            expect(result.reboot).not.toBe(true)
        }
    })

    it("allows /status for an admin and reports region/port", () => {
        const result = routeCommand(config, 111, "/status", getSnapshot)
        expect(result.text).toContain("asia-southeast1")
        expect(result.text).toContain("8443")
    })

    it("allows /stats for an admin and reports counts", () => {
        const result = routeCommand(config, 111, "/stats", getSnapshot)
        expect(result.text).toContain("Lobbies: 2")
        expect(result.text).toContain("Players: 3")
        expect(result.text).toContain("Bots: 1")
    })

    it("allows /players for an admin and lists names", () => {
        const result = routeCommand(config, 111, "/players", getSnapshot)
        expect(result.text).toContain("Robin")
        expect(result.text).toContain("Finch")
    })

    it("allows /lobbies for an admin and lists lobbies", () => {
        const result = routeCommand(config, 111, "/lobbies", getSnapshot)
        expect(result.text).toContain("AAAA")
        expect(result.text).toContain("BBBB")
    })

    it("/dice for an admin replies with a roll", () => {
        const result = routeCommand(config, 111, "/dice", getSnapshot)
        expect(result.text).toMatch(/rolled a \d+/)
    })
})

describe("routeCommand list caps", () => {
    const config: TelegramConfig = { token: "t", adminIds: [111] }

    it("caps the /players list and notes the remainder", () => {
        const manyPlayers = Array.from({ length: 30 }, (_, i) => `P${i}`)
        const snapshot = () => makeSnapshot({ players: manyPlayers, totalPlayers: 30 })
        const result = routeCommand(config, 111, "/players", snapshot)
        expect(result.text).toContain("...and 10 more")
    })

    it("handles no players online", () => {
        const snapshot = () => makeSnapshot({ players: [], totalPlayers: 0 })
        const result = routeCommand(config, 111, "/players", snapshot)
        expect(result.text).toBe("No players online right now.")
    })
})

describe("routeCommand unknown / case handling", () => {
    const config: TelegramConfig = { token: "t", adminIds: [111] }

    it("replies with help for an unknown command", () => {
        const result = routeCommand(config, 111, "/wat", getSnapshot)
        expect(result.text).toContain("Pip-Pip bot commands")
    })

    it("is case-insensitive on the command word", () => {
        const result = routeCommand(config, 999, "/USERINFO", getSnapshot)
        expect(result.text).toBe("Your Telegram user id is 999")
    })

    it("ignores trailing args on the command word", () => {
        const result = routeCommand(config, 999, "/ping pong pong", getSnapshot)
        expect(result.text).toContain("pong")
    })
})

describe("createTelegramBot no-op when disabled", () => {
    it("returns undefined when the token is unset", () => {
        const bot = createTelegramBot(undefined, "111,222", getSnapshot)
        expect(bot).toBeUndefined()
    })

    it("returns undefined when the token is empty/whitespace", () => {
        expect(createTelegramBot("", "111", getSnapshot)).toBeUndefined()
        expect(createTelegramBot("   ", "111", getSnapshot)).toBeUndefined()
    })

    it("returns a bot when the token is set", () => {
        const bot = createTelegramBot("token", "111", getSnapshot, { send: vi.fn(async () => {}) })
        expect(bot).toBeInstanceOf(TelegramBot)
    })
})

describe("TelegramBot.broadcast", () => {
    it("sends to every admin id", async () => {
        const send = vi.fn(async () => {})
        const bot = createTelegramBot("token", "111,222,333", getSnapshot, { send })
        await bot?.broadcast("hello")
        expect(send).toHaveBeenCalledTimes(3)
        expect(send).toHaveBeenCalledWith(111, "hello")
        expect(send).toHaveBeenCalledWith(222, "hello")
        expect(send).toHaveBeenCalledWith(333, "hello")
    })

    it("sends to nobody when there are no admins", async () => {
        const send = vi.fn(async () => {})
        const bot = createTelegramBot("token", undefined, getSnapshot, { send })
        await bot?.broadcast("hello")
        expect(send).not.toHaveBeenCalled()
    })
})

describe("TelegramBot.handleUpdate", () => {
    it("replies to /userinfo in the same chat", async () => {
        const send = vi.fn(async () => {})
        const bot = createTelegramBot("token", "111", getSnapshot, { send })
        await bot?.handleUpdate({
            update_id: 1,
            message: { text: "/userinfo", chat: { id: 555 }, from: { id: 999 } },
        })
        expect(send).toHaveBeenCalledWith(555, "Your Telegram user id is 999")
    })

    it("admin /reboot broadcasts then triggers onReboot", async () => {
        const send = vi.fn(async () => {})
        const onReboot = vi.fn()
        const bot = createTelegramBot("token", "111", getSnapshot, { send, onReboot })
        await bot?.handleUpdate({
            update_id: 1,
            message: { text: "/reboot", chat: { id: 111 }, from: { id: 111 } },
        })
        // reply + broadcast to the single admin
        expect(send).toHaveBeenCalledWith(111, "Rebooting...")
        expect(onReboot).toHaveBeenCalledTimes(1)
    })

    it("non-admin /reboot is denied and never reboots", async () => {
        const send = vi.fn(async () => {})
        const onReboot = vi.fn()
        const bot = createTelegramBot("token", "111", getSnapshot, { send, onReboot })
        await bot?.handleUpdate({
            update_id: 1,
            message: { text: "/reboot", chat: { id: 999 }, from: { id: 999 } },
        })
        expect(onReboot).not.toHaveBeenCalled()
        expect(send.mock.calls[0][1]).toContain("admins only")
    })

    it("ignores updates without text / chat / from", async () => {
        const send = vi.fn(async () => {})
        const bot = createTelegramBot("token", "111", getSnapshot, { send })
        await bot?.handleUpdate({ update_id: 1 })
        await bot?.handleUpdate({ update_id: 2, message: { text: "/ping" } })
        await bot?.handleUpdate({ update_id: 3, message: { chat: { id: 1 }, from: { id: 1 } } })
        expect(send).not.toHaveBeenCalled()
    })
})
