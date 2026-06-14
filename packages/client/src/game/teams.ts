import { PipPipGameMode } from "@pip-pip/game/src/logic"
import type { GameStorePlayer } from "./store"

// Shared TEAM_DEATHMATCH presentation: team colors + small helpers used by both
// the objective HUD (the team-score readout) and the scoreboard (team-colored
// rows/names). One source of truth so the two never drift on which team is which
// color. Team 0 is the cool blue squad, team 1 the warm orange squad - two clear,
// palette-friendly hues that read at a glance and never clash with the neutral UI.
export const TEAM_COLORS = ["#33CCFF", "#FF8A3D"] as const
export const TEAM_NAMES = ["Team 1", "Team 2"] as const

// The two real teams, mirroring TDM_TEAMS in the game logic. -1 (unassigned)
// never renders a team color.
export const TEAMS = [0, 1] as const

// The color for a team (0 or 1). Falls back to a neutral white for an unassigned
// player (-1) so a stray pre-assignment value never reads as a real team.
export function teamColor(team: number): string {
    if (team === 0 || team === 1) return TEAM_COLORS[team]
    return "#FFFFFF"
}

// The display name for a team (0 or 1); empty for unassigned.
export function teamName(team: number): string {
    if (team === 0 || team === 1) return TEAM_NAMES[team]
    return ""
}

// Sum a team's kills across the store's player list. Mirrors game.teamScore on
// the client side so the HUD can show the live "Team 1 X - Y Team 2" readout
// without a dedicated packet (each player's team + kills are already networked).
// Pure (no store/DOM access) so it is trivially unit-testable.
export function teamScore(players: GameStorePlayer[], team: number): number {
    let total = 0
    for (const player of players) {
        if (player.team === team) total += player.score.kills
    }
    return total
}

// Whether the active mode shows team UI. Kept here so the HUD + scoreboard share
// one predicate instead of each re-checking the enum value.
export function isTeamMode(mode: PipPipGameMode): boolean {
    return mode === PipPipGameMode.TEAM_DEATHMATCH
}
