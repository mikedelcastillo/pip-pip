import { PipPipGameMode } from "@pip-pip/game/src/logic"
import type { GameStorePlayer } from "./store"

// Shared TEAM_DEATHMATCH presentation: a palette of up to 6 distinct team colors +
// names used by both the objective HUD (the team-score readout / leaderboard) and
// the scoreboard (team-colored rows/names). One source of truth so the two never
// drift on which team is which color. Teams 0..5 read at a glance and never clash
// with the neutral UI. The first two (cool blue, warm orange) are unchanged from
// the original two-team split, so an existing 2-team match looks exactly as before.
export const TEAM_COLORS = ["#33CCFF", "#FF8A3D", "#66DD77", "#CC88FF", "#FFE14D", "#FF6699"] as const
export const TEAM_NAMES = ["Team 1", "Team 2", "Team 3", "Team 4", "Team 5", "Team 6"] as const

// The number of distinct teams the palette supports (mirrors MAX_TEAMS in logic).
export const MAX_TEAM_COLORS = TEAM_COLORS.length

// A real team is any index in [0, MAX_TEAM_COLORS). -1 (unassigned) never renders
// a team color.
function isRealTeam(team: number): boolean {
    return Number.isInteger(team) && team >= 0 && team < MAX_TEAM_COLORS
}

// The color for a real team (0..5). Falls back to a neutral white for an
// unassigned player (-1) so a stray pre-assignment value never reads as a team.
export function teamColor(team: number): string {
    if (isRealTeam(team)) return TEAM_COLORS[team]
    return "#FFFFFF"
}

// The display name for a real team (0..5); empty for unassigned.
export function teamName(team: number): string {
    if (isRealTeam(team)) return TEAM_NAMES[team]
    return ""
}

// Sum a team's kills across the store's player list. Mirrors game.teamScore on
// the client side so the HUD can show the live team scores without a dedicated
// packet (each player's team + kills are already networked). Pure (no store/DOM
// access) so it is trivially unit-testable.
export function teamScore(players: GameStorePlayer[], team: number): number {
    let total = 0
    for (const player of players) {
        if (player.team === team) total += player.score.kills
    }
    return total
}

// The team indices for a given team count: [0, 1, ..., numTeams-1], clamped to the
// palette so a stray numTeams can never index past the colors. Mirrors teamIndices
// in the game logic. Used by the N-team HUD leaderboard + scoreboard grouping.
export function teamIndices(numTeams: number): number[] {
    const count = Math.max(0, Math.min(MAX_TEAM_COLORS, Math.floor(numTeams)))
    const out: number[] = []
    for (let team = 0; team < count; team++) {
        out.push(team)
    }
    return out
}

// Whether the active mode shows team UI. Kept here so the HUD + scoreboard share
// one predicate instead of each re-checking the enum value.
export function isTeamMode(mode: PipPipGameMode): boolean {
    return mode === PipPipGameMode.TEAM_DEATHMATCH
}
