// Pure, dependency-free helpers for choosing which player a spectator's camera
// follows. Kept import-free (it only touches a minimal player shape) so it is
// trivially unit-testable under node/vitest without spinning up the whole game,
// and so the hot render path can call it without pulling in extra modules.

// The minimal player shape these helpers need. The real PipPlayer carries far
// more, but spectate selection only cares about identity and whether the player
// is currently a live, non-spectating target worth watching.
export interface SpectatablePlayer {
    id: string
    spawned: boolean
    spectator: boolean
}

// The players a spectator may watch: spawned and not themselves spectating,
// returned in a STABLE id order so "next" / "previous" are deterministic and the
// cycle does not jump around as the unordered players map is iterated.
export function spectateTargets<T extends SpectatablePlayer>(players: T[]): T[] {
    return players
        .filter((p) => p.spawned === true && p.spectator === false)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// The id of the next spectate target given the current target id and a cycle
// direction. `dir` is treated as +1 (next) for any value >= 0 and -1 (previous)
// otherwise. Returns:
//   - "" when there is nobody to watch (the caller clears its target), so the
//     camera falls back to holding its last position.
//   - the first target when the current id is unknown (not in the list), so a
//     cold start or a target that just despawned lands on a sensible watcher.
//   - the neighbour in the requested direction otherwise, wrapping around the
//     ends so the cycle is endless.
// Pure, so it is unit-testable.
export function nextSpectateTargetId<T extends SpectatablePlayer>(
    players: T[],
    currentId: string,
    dir: number,
): string {
    const targets = spectateTargets(players)
    if (targets.length === 0) return ""
    const current = targets.findIndex((p) => p.id === currentId)
    if (current === -1) return targets[0].id
    const step = dir < 0 ? -1 : 1
    const nextIndex = ((current + step) % targets.length + targets.length) % targets.length
    return targets[nextIndex].id
}

// The player the spectate camera should follow given a chosen target id. Returns
// the chosen player when it is still a valid target (spawned, not spectating);
// otherwise the first available target; otherwise undefined when nobody can be
// watched. Pure, so it is unit-testable.
export function resolveSpectateTarget<T extends SpectatablePlayer>(
    players: T[],
    currentId: string,
): T | undefined {
    const chosen = players.find((p) => p.id === currentId)
    if (typeof chosen !== "undefined" && chosen.spawned === true && chosen.spectator === false) {
        return chosen
    }
    return spectateTargets(players)[0]
}
