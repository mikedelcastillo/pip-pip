// Pure, dependency-free helpers for the static map-preview thumbnail shown in
// the map selector. Kept apart from the React component / canvas draw so the
// fit math can be unit-tested in isolation (see tests/client/mapPreview.test.ts).
//
// Unlike the in-match radar (game/minimap.ts), which scales each axis
// independently to fill a square radar, the preview must preserve the map's
// aspect ratio so a wide map reads as wide. We therefore compute a single
// uniform scale that fits the whole map inside the thumbnail and centre it.

export type MapPreviewBounds = {
    min: { x: number, y: number },
    max: { x: number, y: number },
}

export type MapPreviewPoint = { x: number, y: number }

// A uniform-scale fit of a world-space box into a `width`x`height` thumbnail,
// inset by `padding` on every side. `scale` is world-units → preview-pixels;
// `offsetX`/`offsetY` translate so the scaled, centred map lands inside the pad.
export type MapPreviewTransform = {
    scale: number,
    offsetX: number,
    offsetY: number,
}

export function mapPreviewTransform(
    bounds: MapPreviewBounds,
    width: number,
    height: number,
    padding = 0,
): MapPreviewTransform {
    const innerW = Math.max(0, width - padding * 2)
    const innerH = Math.max(0, height - padding * 2)
    const spanX = bounds.max.x - bounds.min.x
    const spanY = bounds.max.y - bounds.min.y

    // Degenerate span on either axis (a point/line map) has no meaningful scale;
    // collapse to the thumbnail centre with a 1:1 scale so we never divide by
    // zero and the (tiny) geometry still lands in view.
    const scaleX = spanX > 0 ? innerW / spanX : 0
    const scaleY = spanY > 0 ? innerH / spanY : 0
    const scale = scaleX > 0 && scaleY > 0
        ? Math.min(scaleX, scaleY)
        : Math.max(scaleX, scaleY) // one axis flat: use the other; both flat → 0

    if(scale <= 0){
        // Both axes flat: there is no meaningful scale. Centre the map's single
        // point in the thumbnail at 1:1 (offset cancels the point so it lands
        // dead centre regardless of its world coordinate).
        return {
            scale: 1,
            offsetX: width / 2 - bounds.min.x,
            offsetY: height / 2 - bounds.min.y,
        }
    }

    // Centre the scaled map in the thumbnail: leftover space split evenly.
    const offsetX = padding + (innerW - spanX * scale) / 2 - bounds.min.x * scale
    const offsetY = padding + (innerH - spanY * scale) / 2 - bounds.min.y * scale
    return { scale, offsetX, offsetY }
}

// Apply a transform to a single world coordinate.
export function worldToPreview(
    x: number,
    y: number,
    transform: MapPreviewTransform,
): MapPreviewPoint {
    return {
        x: x * transform.scale + transform.offsetX,
        y: y * transform.scale + transform.offsetY,
    }
}

// Convert a map's 0xRRGGBB background number to a CSS hex string. Mirrors how
// the renderer feeds the same number to Pixi's backgroundColor.
export function backgroundToCss(background: number): string {
    return "#" + (background & 0xFFFFFF).toString(16).padStart(6, "0")
}
