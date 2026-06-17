// PURE map-tile rendering helpers, kept apart from the Pixi renderer so the
// shape geometry and block-colour logic can be unit-tested without a WebGL
// context (see tests/client/mapGraphics.test.ts). The renderer (renderer.ts)
// consumes these to draw the static map ONCE into a cached layer instead of one
// sprite per tile, which is the Phase 2 performance win.

import { PipGameTile, PipGameTileShape } from "@pip-pip/game/src/logic/map"
import { TILE_SIZE } from "@pip-pip/game/src/logic/constants"

// A polygon corner in world space.
export type TilePoint = { x: number, y: number }

// The four block fills the renderer paints with. Two shades per block read as a
// flat top face plus a darker bevel edge, keeping the existing dark blocky
// aesthetic while letting maps look varied. Colours are intentionally on-brand
// dark space hues (the same family as styles.COLORS DARK_*/ACCENT). Each entry
// is { face, edge } as 0xRRGGBB.
export type TileMaterialStyle = {
    face: number,
    edge: number,
}

// A small named palette of block styles. A tile's block key (or texture) selects
// one of these deterministically via materialStyleFor, so a map authored with a
// handful of distinct palette keys looks varied without any art assets. The
// legacy migrated maps only ever use "tile_default" / "tile_hidden", which map
// to the first two styles, so they keep today's look.
export const TILE_MATERIAL_STYLES: Record<string, TileMaterialStyle> = {
    // The original default wall: dark plum face with a faintly lighter bevel.
    tile_default: { face: 0x362631, edge: 0x4A3343 },
    // The original "hidden" wall: nearly black, barely-there bevel.
    tile_hidden: { face: 0x241921, edge: 0x32232E },
    // A cool slate block for variety.
    slate: { face: 0x26303A, edge: 0x35434F },
    // A warm rust block.
    rust: { face: 0x3A2826, edge: 0x4F3733 },
    // A muted accent (purple) block, echoing COLORS.ACCENT_DARKER.
    accent: { face: 0x2E2438, edge: 0x42324F },
    // A deep teal block.
    teal: { face: 0x1F3030, edge: 0x2C4444 },
    // A cold steel blue, slightly brighter than slate so the two read apart.
    cobalt: { face: 0x1E2A45, edge: 0x2C3C5E },
    // A mossy dark green, the only "warm-cool" green besides teal.
    moss: { face: 0x26321F, edge: 0x37472D },
    // A dusty mauve/rose, a softer companion to the accent purple.
    mauve: { face: 0x3A2533, edge: 0x4F3447 },
}

// Ordered fallback styles, used when a block key is not a named style. A stable
// string hash picks one so the SAME key always renders the SAME way (a map's
// look is deterministic) while different keys spread across the palette.
const FALLBACK_STYLES: TileMaterialStyle[] = [
    TILE_MATERIAL_STYLES.tile_default,
    TILE_MATERIAL_STYLES.slate,
    TILE_MATERIAL_STYLES.rust,
    TILE_MATERIAL_STYLES.accent,
    TILE_MATERIAL_STYLES.teal,
]

// A tiny deterministic string hash (djb2-ish, kept in 32-bit range). Pure and
// stable across runs so a given block key always lands on the same style.
export function hashMaterialKey(key: string): number{
    let hash = 5381
    for(let i = 0; i < key.length; i++){
        hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0
    }
    return Math.abs(hash)
}

// The { face, edge } style for a raw block KEY (not a whole tile). A named style
// wins outright; anything else is spread deterministically across the fallback
// palette so the editor preview and the in-game renderer agree on any key. Kept
// separate from materialStyleFor (which takes a tile) so the editor can colour a
// material swatch straight from its key without fabricating a tile.
export function materialStyleForKey(key: string): TileMaterialStyle{
    const named = TILE_MATERIAL_STYLES[key]
    if(typeof named !== "undefined") return named
    const index = hashMaterialKey(key) % FALLBACK_STYLES.length
    return FALLBACK_STYLES[index]
}

// A material key's FACE colour as a CSS "#rrggbb" string, so the 2D editor canvas
// (which paints with CSS colours, not Pixi's 0xRRGGBB numbers) can render a tile
// in the EXACT face colour the in-game Pixi renderer uses. Routed through
// materialStyleForKey so a named material, a legacy key, or an unknown key all map
// the same way in the editor as they will in the match.
export function materialFaceCss(key: string): string{
    const face = materialStyleForKey(key).face
    return `#${face.toString(16).padStart(6, "0")}`
}

// Resolve a tile's material key (falling back to its texture) to a concrete
// { face, edge } style. A named style wins outright; anything else is spread
// deterministically across the fallback palette so varied keys look varied.
export function materialStyleFor(tile: PipGameTile): TileMaterialStyle{
    return materialStyleForKey(tile.material ?? tile.texture)
}

// The polygon (in world space) that fills a tile of the given shape, centred on
// (tile.x, tile.y) at TILE_SIZE. A "full"/"deco" tile is the whole square; each
// "diag_*" tile is the right triangle whose right angle sits in the named corner
// and whose hypotenuse matches the diagonal segWall a ship glides along. The
// corner names line up with diagonalSegmentEndpoints in grid-map.ts:
//   diag_tl fills the TOP-LEFT corner, hypotenuse top-right -> bottom-left, etc.
export function tilePolygon(tile: PipGameTile): TilePoint[]{
    const half = TILE_SIZE / 2
    const left = tile.x - half
    const right = tile.x + half
    const top = tile.y - half
    const bottom = tile.y + half

    const shape: PipGameTileShape = tile.shape ?? "full"

    if(shape === "diag_tl"){
        // Right angle top-left; the two legs meet there, hypotenuse TR -> BL.
        return [
            { x: left, y: top },
            { x: right, y: top },
            { x: left, y: bottom },
        ]
    }
    if(shape === "diag_tr"){
        // Right angle top-right; hypotenuse TL -> BR.
        return [
            { x: left, y: top },
            { x: right, y: top },
            { x: right, y: bottom },
        ]
    }
    if(shape === "diag_bl"){
        // Right angle bottom-left; hypotenuse TL -> BR.
        return [
            { x: left, y: top },
            { x: left, y: bottom },
            { x: right, y: bottom },
        ]
    }
    if(shape === "diag_br"){
        // Right angle bottom-right; hypotenuse TR -> BL.
        return [
            { x: right, y: top },
            { x: right, y: bottom },
            { x: left, y: bottom },
        ]
    }

    // Half tiles: a half-cell rectangle (4 points) matching the axis-aligned
    // half-cell rect wall the loader builds. The flat edge runs down the middle
    // of the cell (y increases downward, so "top" = smaller y). The renderer
    // strokes a full polygon outline for any non-3-point shape, which is correct
    // for these rectangles.
    if(shape === "half_top"){
        // Top half: from the top edge down to the cell's vertical midline.
        return [
            { x: left, y: top },
            { x: right, y: top },
            { x: right, y: tile.y },
            { x: left, y: tile.y },
        ]
    }
    if(shape === "half_bottom"){
        // Bottom half: from the cell's vertical midline down to the bottom edge.
        return [
            { x: left, y: tile.y },
            { x: right, y: tile.y },
            { x: right, y: bottom },
            { x: left, y: bottom },
        ]
    }
    if(shape === "half_left"){
        // Left half: from the left edge across to the cell's horizontal midline.
        return [
            { x: left, y: top },
            { x: tile.x, y: top },
            { x: tile.x, y: bottom },
            { x: left, y: bottom },
        ]
    }
    if(shape === "half_right"){
        // Right half: from the cell's horizontal midline across to the right edge.
        return [
            { x: tile.x, y: top },
            { x: right, y: top },
            { x: right, y: bottom },
            { x: tile.x, y: bottom },
        ]
    }

    // "full" and "deco" both render as the whole square.
    return [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
    ]
}

// Is this tile a diagonal slope (vs a square full/deco tile)?
export function isDiagonalTile(tile: PipGameTile): boolean{
    const shape = tile.shape ?? "full"
    return shape === "diag_tl" || shape === "diag_tr" || shape === "diag_bl" || shape === "diag_br"
}

// Flatten a polygon to the [x0, y0, x1, y1, ...] number array PIXI.Graphics
// drawPolygon expects.
export function polygonToFlat(points: TilePoint[]): number[]{
    const flat: number[] = []
    for(const p of points){
        flat.push(p.x, p.y)
    }
    return flat
}
