// Pure, dependency-free helpers for the in-match minimap / radar. Kept apart
// from the React component and the rAF draw loop so the coordinate math can be
// unit-tested in isolation (see tests/client/minimap.test.ts).

export type MinimapBounds = {
    min: { x: number, y: number },
    max: { x: number, y: number },
}

export type MinimapPoint = { x: number, y: number }

// Map a world coordinate into a `size`x`size` radar. The world span
// [bounds.min, bounds.max] maps linearly onto the padded radar span
// [padding, size - padding], independently per axis. Coordinates outside the
// world bounds clamp to the padded edge so off-bounds entities stay visible at
// the rim rather than drawing outside the canvas. A zero-extent axis (min ===
// max, which would divide by zero) collapses to the radar centre on that axis.
export function worldToMinimap(
    x: number,
    y: number,
    bounds: MinimapBounds,
    size: number,
    padding = 0,
): MinimapPoint {
    return {
        x: axisToMinimap(x, bounds.min.x, bounds.max.x, size, padding),
        y: axisToMinimap(y, bounds.min.y, bounds.max.y, size, padding),
    }
}

function axisToMinimap(
    value: number,
    min: number,
    max: number,
    size: number,
    padding: number,
): number {
    const lo = padding
    const hi = size - padding
    const extent = max - min
    // Zero (or inverted) extent → centre of the padded span: there is no
    // meaningful direction to map along and we must not divide by zero.
    if(extent <= 0) return (lo + hi) / 2
    const t = (value - min) / extent
    const mapped = lo + t * (hi - lo)
    // Clamp so out-of-bounds entities pin to the rim instead of overflowing.
    return Math.max(lo, Math.min(hi, mapped))
}
