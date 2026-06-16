import { CHAT_MAX_MESSAGE_LENGTH } from "./constants"

export const tickDown = (n: number, amount = 1) => Math.max(0, n - amount)

// Validate one raw chat message for display or broadcast. Returns the cleaned
// text, or undefined to drop it: empty/whitespace-only messages are dropped and
// the rest is clamped to CHAT_MAX_MESSAGE_LENGTH so a single message can never be
// oversized even if a client ignores its own limit. Shared by the server's
// broadcast approval and the client's incoming-chat render so both clean the same.
export function sanitizeChatMessage(message: string){
    if(typeof message !== "string") return undefined
    const trimmed = message.trim()
    if(trimmed.length === 0) return undefined
    return trimmed.slice(0, CHAT_MAX_MESSAGE_LENGTH)
}

// The single player-name policy: keep alphanumerics + underscore only, trim, and
// cap to 16 (matches MAX_PLAYER_NAME_LENGTH). Every name path runs this exact
// function (client input, server ingest, and PipPlayer.setName via clampPlayerName)
// so names can never be cleaned two different ways.
export const sanitize = (s: string) => s.replace(/[^0-9a-z_]/gmi, "").trim().substring(0, 16).trim()

export const CACHE_NAME_KEY = "pip_name_a"