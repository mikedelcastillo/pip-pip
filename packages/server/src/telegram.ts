// Optional Telegram bot for live analytics + control of the Pip-Pip server.
//
// FULLY OPTIONAL: with no TELEGRAM_TOKEN set, this whole module is a no-op. No
// polling loop starts, broadcasts do nothing, and the game server runs exactly
// as it did before. Every network call is wrapped so a Telegram outage or error
// NEVER crashes or blocks the game server (we swallow + console.warn). Polling
// runs on its own self-scheduling loop, never inside the 20Hz game tick.
//
// The pure logic (env parsing, admin gating, command routing, message
// formatting) is kept side-effect-free and the HTTP send is injected, so it can
// all be unit-tested without a network. See tests/server/telegram.test.ts.

// Two env vars, both read in index.ts and passed in here:
//   TELEGRAM_TOKEN    : bot token. Unset/empty => feature disabled.
//   TELEGRAM_USER_IDS : comma-separated numeric Telegram user ids. These are the
//                       ADMINS (broadcast targets + the only ids allowed to run
//                       privileged commands).

// A single Telegram update from getUpdates we care about: a text message.
export type TelegramUpdate = {
    update_id: number,
    message?: {
        text?: string,
        chat?: { id: number },
        from?: { id: number },
    },
}

// Injectable send: (chatId, text) => Promise. The real implementation hits the
// Telegram Bot API; tests pass a spy so routing/formatting is checked offline.
export type SendFn = (chatId: number, text: string) => Promise<void>

export type TelegramConfig = {
    token: string,
    adminIds: number[],
}

// Read-only snapshot of live server state the command/broadcast formatters use.
// index.ts supplies a getter that computes this on demand from server.lobbies /
// game.players, so telegram.ts never imports the heavy Server/game machinery.
export type ServerSnapshot = {
    region: string,
    port: number,
    // The deployed build's commit, e.g. "aca4c39 Apex-style HUD redesign".
    // Short sha + subject so a startup broadcast says exactly what is live.
    commit: string,
    startedAt: number,
    lobbyCount: number,
    publicLobbyCount: number,
    totalPlayers: number,
    botCount: number,
    players: string[],
    lobbies: { id: string, name: string, isPublic: boolean, playerCount: number }[],
}

// Caps so a /players or /lobbies reply can never produce a giant message.
const LIST_CAP = 20

// Parse TELEGRAM_USER_IDS. Tolerates spaces, trailing commas, empty entries and
// garbage (non-numeric tokens are dropped). Returns a de-duplicated id list.
export function parseAdminIds(raw: string | undefined): number[]{
    if(typeof raw !== "string") return []
    const ids: number[] = []
    for(const part of raw.split(",")){
        const trimmed = part.trim()
        if(trimmed.length === 0) continue
        // Telegram ids are plain decimal integers. Require a strict decimal form
        // so hex (0x10), floats (1.5) and other garbage are rejected outright.
        if(!/^\d+$/.test(trimmed)) continue
        const value = Number(trimmed)
        if(!Number.isInteger(value)) continue
        if(!ids.includes(value)) ids.push(value)
    }
    return ids
}

// Build config from raw env. Returns undefined when the feature is disabled
// (token unset/empty/whitespace), which is the signal for "do nothing".
export function buildConfig(
    token: string | undefined,
    userIds: string | undefined,
): TelegramConfig | undefined{
    if(typeof token !== "string") return undefined
    const trimmed = token.trim()
    if(trimmed.length === 0) return undefined
    return { token: trimmed, adminIds: parseAdminIds(userIds) }
}

export function isAdmin(config: TelegramConfig, userId: number){
    return config.adminIds.includes(userId)
}

function formatUptime(ms: number){
    const totalSeconds = Math.max(0, Math.floor(ms / 1000))
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return `${hours}h ${minutes}m ${seconds}s`
}

// ---- Broadcast message formatters (pure) ----------------------------------

export function formatServerStart(snapshot: ServerSnapshot){
    const when = new Date(snapshot.startedAt).toISOString()
    return `🚀 Pip-Pip server is up\n📦 ${snapshot.commit}\nregion ${snapshot.region}, port ${snapshot.port}, at ${when}`
}

export function formatLobbyCreated(lobby: ServerSnapshot["lobbies"][number]){
    const visibility = lobby.isPublic ? "public" : "private"
    return `🛰️ Lobby created: ${lobby.id} "${lobby.name}" (${visibility})`
}

export function formatPlayerConnect(name: string, totalPlayers: number){
    return `🐦 ${name} joined, ${totalPlayers} online now`
}

export function formatPlayerMilestone(totalPlayers: number){
    return `🎉 ${totalPlayers} pilots online! The skies are busy.`
}

export function formatMatchStarted(lobby: ServerSnapshot["lobbies"][number]){
    return `⚔️ Match started in lobby ${lobby.id} "${lobby.name}", ${lobby.playerCount} pilots in the fight`
}

// ---- Command router (pure) -------------------------------------------------

export type CommandResult = {
    // Reply sent back to the chat that issued the command. Undefined => no reply.
    text?: string,
    // Set when the command asks the process to exit (e.g. /reboot). The caller
    // performs the side effect (broadcast + process.exit) so routing stays pure.
    reboot?: boolean,
}

const HELP_TEXT = [
    "Pip-Pip bot commands:",
    "/userinfo - your Telegram user id",
    "/ping - pong",
    "/status - server status (admin)",
    "/stats - live numbers (admin)",
    "/players - players online (admin)",
    "/lobbies - active lobbies (admin)",
    "/dice - roll a d20 (admin)",
    "/reboot - restart the server (admin)",
].join("\n")

// Route a single text message to a reply. Pure: takes the config, the sender id,
// the raw text, and a snapshot getter; returns what to reply (and whether to
// reboot). Admin-only commands are denied for non-admins. Anyone can run the
// public commands (/userinfo, /start, /ping). Unknown commands get short help.
export function routeCommand(
    config: TelegramConfig,
    fromId: number,
    text: string,
    getSnapshot: () => ServerSnapshot,
): CommandResult{
    const command = text.trim().toLowerCase().split(/\s+/)[0]
    const admin = isAdmin(config, fromId)

    // Public commands: work for ANYONE who messages the bot.
    if(command === "/userinfo" || command === "/start"){
        return { text: `Your Telegram user id is ${fromId}` }
    }
    if(command === "/ping"){
        return { text: "pong 🏓" }
    }

    // Admin-only commands below. Politely deny non-admins.
    const adminCommands = ["/status", "/stats", "/players", "/lobbies", "/reboot", "/dice"]
    if(adminCommands.includes(command)){
        if(!admin){
            return { text: "Sorry, that command is admins only. Send /userinfo to get your id." }
        }
    }

    if(command === "/status"){
        const snapshot = getSnapshot()
        const uptime = formatUptime(Date.now() - snapshot.startedAt)
        return { text: `🟢 Up. Uptime ${uptime}. Region ${snapshot.region}, port ${snapshot.port}.` }
    }
    if(command === "/stats"){
        const snapshot = getSnapshot()
        return {
            text: [
                "📊 Live stats:",
                `Lobbies: ${snapshot.lobbyCount} (public ${snapshot.publicLobbyCount})`,
                `Players: ${snapshot.totalPlayers}`,
                `Bots: ${snapshot.botCount}`,
            ].join("\n"),
        }
    }
    if(command === "/players"){
        const snapshot = getSnapshot()
        if(snapshot.players.length === 0){
            return { text: "No players online right now." }
        }
        const shown = snapshot.players.slice(0, LIST_CAP)
        const extra = snapshot.players.length - shown.length
        const lines = shown.map(name => `- ${name}`)
        if(extra > 0) lines.push(`...and ${extra} more`)
        return { text: `👥 Players (${snapshot.players.length}):\n${lines.join("\n")}` }
    }
    if(command === "/lobbies"){
        const snapshot = getSnapshot()
        if(snapshot.lobbies.length === 0){
            return { text: "No active lobbies right now." }
        }
        const shown = snapshot.lobbies.slice(0, LIST_CAP)
        const extra = snapshot.lobbies.length - shown.length
        const lines = shown.map(lobby => {
            const visibility = lobby.isPublic ? "public" : "private"
            return `- ${lobby.id} "${lobby.name}" ${lobby.playerCount}p (${visibility})`
        })
        if(extra > 0) lines.push(`...and ${extra} more`)
        return { text: `🛰️ Lobbies (${snapshot.lobbies.length}):\n${lines.join("\n")}` }
    }
    if(command === "/dice"){
        const roll = 1 + Math.floor(Math.random() * 20)
        return { text: `🎲 You rolled a ${roll}` }
    }
    if(command === "/reboot"){
        return { text: "Rebooting...", reboot: true }
    }

    return { text: HELP_TEXT }
}

// ---- Telegram Bot API client (the only side-effecting part) ----------------

const API_BASE = "https://api.telegram.org/bot"

// Real send via Node 20+ global fetch. Wrapped so any error is swallowed (logged
// once) and never propagates into the caller / game loop.
export function makeSend(token: string): SendFn{
    return async (chatId: number, text: string) => {
        try{
            await fetch(`${API_BASE}${token}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, text }),
            })
        } catch(error){
            console.warn("[telegram] sendMessage failed:", error)
        }
    }
}

// Long-poll getUpdates once with the given offset. Returns the updates plus the
// next offset to use. On ANY error returns the offset unchanged and an empty
// list, so the poll loop simply retries next iteration without crashing.
export async function fetchUpdates(
    token: string,
    offset: number,
    timeoutSeconds = 25,
): Promise<{ updates: TelegramUpdate[], nextOffset: number }>{
    try{
        const url = `${API_BASE}${token}/getUpdates?timeout=${timeoutSeconds}&offset=${offset}`
        const response = await fetch(url)
        const data = await response.json() as { ok?: boolean, result?: TelegramUpdate[] }
        if(data.ok !== true || !Array.isArray(data.result)){
            return { updates: [], nextOffset: offset }
        }
        let nextOffset = offset
        for(const update of data.result){
            if(update.update_id >= nextOffset) nextOffset = update.update_id + 1
        }
        return { updates: data.result, nextOffset }
    } catch(error){
        console.warn("[telegram] getUpdates failed:", error)
        return { updates: [], nextOffset: offset }
    }
}

// ---- The bot wired together ------------------------------------------------

export type TelegramBotDeps = {
    config: TelegramConfig,
    send: SendFn,
    getSnapshot: () => ServerSnapshot,
    // Performs the actual process exit. Injectable so tests don't kill the runner.
    onReboot?: () => void,
}

export class TelegramBot{
    private config: TelegramConfig
    private send: SendFn
    private getSnapshot: () => ServerSnapshot
    private onReboot: () => void
    private offset = 0
    private polling = false

    constructor(deps: TelegramBotDeps){
        this.config = deps.config
        this.send = deps.send
        this.getSnapshot = deps.getSnapshot
        this.onReboot = deps.onReboot ?? (() => process.exit(0))
    }

    // Send `text` to every admin id. Each send is independently wrapped, so one
    // failing chat never blocks the others. No-op when there are no admins.
    async broadcast(text: string){
        await Promise.all(this.config.adminIds.map(id => this.send(id, text)))
    }

    // Handle one update: route it and reply in the same chat. Reboot requests
    // broadcast a heads-up first, then trigger the injected onReboot.
    async handleUpdate(update: TelegramUpdate){
        const message = update.message
        const text = message?.text
        const chatId = message?.chat?.id
        const fromId = message?.from?.id
        if(typeof text !== "string") return
        if(typeof chatId !== "number") return
        if(typeof fromId !== "number") return

        const result = routeCommand(this.config, fromId, text, this.getSnapshot)
        if(typeof result.text === "string"){
            await this.send(chatId, result.text)
        }
        if(result.reboot === true){
            await this.broadcast("♻️ Rebooting...")
            this.onReboot()
        }
    }

    // Start the self-scheduling long-poll loop. Runs OUTSIDE the game tick. Each
    // iteration is fully wrapped, so a Telegram outage just means an idle retry.
    start(){
        if(this.polling) return
        this.polling = true
        const loop = async () => {
            while(this.polling){
                try{
                    const { updates, nextOffset } = await fetchUpdates(this.config.token, this.offset)
                    this.offset = nextOffset
                    for(const update of updates){
                        await this.handleUpdate(update)
                    }
                } catch(error){
                    console.warn("[telegram] poll loop error:", error)
                    // Brief backoff so a hard failure does not hot-loop.
                    await new Promise(resolve => setTimeout(resolve, 1000))
                }
            }
        }
        void loop()
    }

    stop(){
        this.polling = false
    }
}

// Convenience factory used by index.ts: builds the bot from raw env, or returns
// undefined when the feature is disabled (token unset). The caller starts it.
export function createTelegramBot(
    token: string | undefined,
    userIds: string | undefined,
    getSnapshot: () => ServerSnapshot,
    overrides: { send?: SendFn, onReboot?: () => void } = {},
): TelegramBot | undefined{
    const config = buildConfig(token, userIds)
    if(typeof config === "undefined") return undefined
    const send = overrides.send ?? makeSend(config.token)
    return new TelegramBot({ config, send, getSnapshot, onReboot: overrides.onReboot })
}
