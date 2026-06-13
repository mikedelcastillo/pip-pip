// Pure, dependency-free helpers for renderer interpolation decisions. Kept
// import-free so they run under vitest without Pixi/DOM.

// True when the interpolation target is farther than maxDistance from the
// currently-rendered position — i.e. the gap is a teleport/respawn that should
// snap instantly instead of sliding across the map. Compares squared distances
// to skip a sqrt.
//
// Regression guard: the inline check this replaces read `dx*dx + dy + dy`
// (=> dx² + 2·dy) instead of the squared distance `dx*dx + dy*dy`, so large
// VERTICAL-only jumps (small dx, large dy) never exceeded the threshold and the
// ship visibly slid across the map on respawn/teleport instead of snapping.
export function exceedsSnapDistance(dx: number, dy: number, maxDistance: number): boolean {
    return dx * dx + dy * dy > maxDistance * maxDistance
}
