// Pure, dependency-free model for the homepage MAP EDITOR. Everything here is
// framework-agnostic and DOM-free so it unit-tests cleanly (see
// tests/client/mapEditor.test.ts): the mutable SPARSE grid model, painting a
// single brush into a cell (at ANY coordinate, including far away), and
// round-tripping to/from the GridMapData shape that
// @pip-pip/game/src/logic/grid-map.ts -> loadGridMap consumes. The React view
// (views/MapEditor.tsx) only renders this model and wires pointer events to
// setCell; it owns no map logic of its own.

import {
    GridMapData,
    TileShape,
    TilePaletteEntry,
    MAX_CUSTOM_CELLS,
} from "@pip-pip/game/src/logic/grid-map"
import { TILE_SIZE } from "@pip-pip/game/src/logic/constants"

// A brush is what a single click/drag paints. "empty" erases (clears a cell).
// Every other brush writes a tile of the named shape; "spawn" is special-cased:
// it does not write a tile but toggles a spawn marker at the cell. Keeping spawn
// in the same brush enum lets the palette UI present one uniform list of
// paintable things. The four "half_*" brushes paint a half-tile (half the cell,
// flat edge down the middle) that collides as a simple axis-aligned half-cell
// box; they live in a direction flyout under the single "Half" tool.
//
// EditorBrush is exactly the FIXED-SHAPE brushes: each one either erases, toggles
// a spawn, or writes a known concrete tile shape. Tool tables in the view that
// must be EXHAUSTIVE per brush (e.g. Record<EditorBrush, string> label/shortcut
// maps) key off this union, so it deliberately excludes the RESOLVING brushes
// below (which have no fixed shape and no fixed label/shortcut of their own).
export type EditorBrush = "empty" | "full" | "auto" | "diag_tl" | "diag_tr" | "diag_bl" | "diag_br" | "deco" | "spawn"
    | "half_top" | "half_bottom" | "half_left" | "half_right"

// The RESOLVING brushes resolve their effect from the target cell + its
// neighbours at paint time instead of carrying a fixed shape:
//   "half_auto" picks a half-tile ORIENTATION from neighbours (like "auto" does
//     for slopes), so it has no single shape and never sits in EDITOR_PALETTE.
//   "recolor" recolours an EXISTING tile in place (keeping its shape) and never
//     creates or erases a tile, so it is not a shape either.
// They are kept OUT of EditorBrush so the view's exhaustive per-brush tables stay
// complete, and folded back in via PaintBrush (the full set setCell accepts).
export type ResolvingBrush = "half_auto" | "recolor"

// Every brush EditorMap.setCell accepts: the fixed-shape EditorBrush union plus
// the two resolving brushes. setCell branches on the resolving brushes BEFORE it
// ever treats a brush as a concrete TileShape, so they need no palette entry.
export type PaintBrush = EditorBrush | ResolvingBrush

// The four explicit slope directions, tucked under the Auto slope tool.
export const SLOPE_BRUSHES: EditorBrush[] = ["diag_tl", "diag_tr", "diag_bl", "diag_br"]

// The four explicit half-tile directions, tucked under the single "Half" tool's
// direction flyout (mirroring how the slope directions live under Auto slope).
export const HALF_BRUSHES: EditorBrush[] = ["half_top", "half_bottom", "half_left", "half_right"]

// A DRAW MODE is orthogonal to the brush: the BRUSH says WHAT to paint (block /
// slope / deco / spawn / erase) and the MODE says HOW. "freehand" is the default
// (one cell per pointer position while dragging, the original behaviour); "rect"
// fills the bounding box between the gesture's start and end cell; "line" draws a
// straight pixel line between them; "fill" flood-fills the connected same-value
// region under a single click. Shape/fill modes apply the active brush to a SET
// of cells in one batch (one undo step), so e.g. rect+full draws a filled block
// rectangle and line+empty erases a line. Kept here (DOM-free) so the cell-set
// enumeration is unit-testable independent of the view.
export type DrawMode = "freehand" | "rect" | "line" | "fill"

// Every draw mode, in the order the mode strip renders them. Freehand first as
// the default tool.
export const DRAW_MODES: DrawMode[] = ["freehand", "rect", "line", "fill"]

// A single cell coordinate as a tuple. Shape helpers return arrays of these so
// the view can paint each via setCell without re-parsing keys.
export type Cell = [number, number]

// Single-key keyboard shortcut for every tool, Aseprite-style: one letter
// selects one brush. "S" is the primary SLOPE tool = Auto slope (it picks the
// direction from neighbours); the four explicit directions keep the Q/W/A/X
// corner cluster for power users but live in a dropdown under Auto slope. Kept
// here (DOM-free) so the shortcut-key -> brush mapping is unit-testable.
//
// The four half-tile brushes (half_top/half_bottom/half_left/half_right)
// intentionally have NO keyboard shortcut: the obvious single keys are already
// claimed (B=Block, S=Auto slope, D=Deco, the Q/W/A/X cluster=slopes) and no
// clean non-clashing letters remain, so the half shapes are flyout-only (under
// the "Half" tool) rather than colliding with an existing shortcut.
export const BRUSH_SHORTCUTS: Record<string, EditorBrush> = {
    e: "empty",
    b: "full",
    s: "auto",
    d: "deco",
    g: "spawn",
    q: "diag_tl",
    w: "diag_tr",
    a: "diag_bl",
    x: "diag_br",
}

// Resolve a raw KeyboardEvent.key into the brush it selects, or null when the
// key is not a tool shortcut. Case-insensitive so Shift does not break it.
export function brushForKey(key: string): EditorBrush | null{
    const brush = BRUSH_SHORTCUTS[key.toLowerCase()]
    return typeof brush === "undefined" ? null : brush
}

// AUTO SLOPE: pick the 45-degree slope whose RIGHT ANGLE sits in the corner where
// two PERPENDICULAR-ADJACENT solid (full) neighbours meet, so the diagonal chamfers
// that inner corner into a smooth ramp the ship glides along. Anything that is not
// a clean two-wall corner (0/1/3/4 solid neighbours, or two OPPOSITE walls) has no
// sensible slope, so it falls back to a full block. Pure + unit-tested.
export function autoSlopeShape(top: boolean, right: boolean, bottom: boolean, left: boolean): TileShape{
    if(top && left && !right && !bottom) return "diag_tl"
    if(top && right && !left && !bottom) return "diag_tr"
    if(bottom && left && !top && !right) return "diag_bl"
    if(bottom && right && !top && !left) return "diag_br"
    return "full"
}

// Does `shape` present a SOLID, FULL-LENGTH wall on the named cell side? A solid
// edge is one a neighbouring cell butts flat against (so auto-resolution can treat
// that neighbour as a wall on this side). Derived straight from the collision
// geometry in packages/game/src/logic/grid-map.ts:
//   - "full" fills the whole cell, so all four edges are solid.
//   - A diagonal fills the triangle in its named corner; the two cell edges that
//     MEET that corner are full-length walls, the other two are the bevelled
//     (hypotenuse) side and are not solid:
//       diag_tl (top-left)     -> top + left
//       diag_tr (top-right)    -> top + right
//       diag_bl (bottom-left)  -> bottom + left
//       diag_br (bottom-right) -> bottom + right
//   - A half-tile fills the half-cell box on its named side (halfTileRect); the
//     box's three OUTER edges are full-length walls and the inner mid-cell face is
//     not. So the filled side plus the two perpendicular sides are solid, and only
//     the opposite (mid-cell) side is open:
//       half_top    -> top + left + right     (open: bottom)
//       half_bottom -> bottom + left + right  (open: top)
//       half_left   -> left + top + bottom    (open: right)
//       half_right  -> right + top + bottom   (open: left)
//   - "deco" carries no collision and an empty cell has no walls, so neither has a
//     solid edge on any side.
// Pure + total over TileShape + unit-tested.
export function shapeEdgeSolid(shape: TileShape, side: "top" | "right" | "bottom" | "left"): boolean{
    if(shape === "full") return true
    if(shape === "deco") return false
    if(shape === "diag_tl") return side === "top" || side === "left"
    if(shape === "diag_tr") return side === "top" || side === "right"
    if(shape === "diag_bl") return side === "bottom" || side === "left"
    if(shape === "diag_br") return side === "bottom" || side === "right"
    // Half-tiles: the filled side + the two perpendicular sides are solid; only
    // the opposite mid-cell face is open.
    if(shape === "half_top") return side !== "bottom"
    if(shape === "half_bottom") return side !== "top"
    if(shape === "half_left") return side !== "right"
    if(shape === "half_right") return side !== "left"
    return false
}

// AUTO HALF-BLOCK: pick the half-tile ORIENTATION that sits AGAINST the solid
// neighbour(s), the half-tile analogue of autoSlopeShape. A half-tile fills toward
// the side where there is a wall to back onto, so a single solid neighbour decides
// the orientation:
//   wall BELOW  -> half_bottom (the half hugs the floor)
//   wall ABOVE  -> half_top
//   wall RIGHT  -> half_right
//   wall LEFT   -> half_left
// A single clean neighbour wins. With OPPOSITE walls (a corridor: top+bottom or
// left+right) there is no single side to hug, so it fills the whole gap with a
// "full" block. Any other ambiguous count (perpendicular pair, three or four
// walls, or none) falls back to "half_bottom" as a sensible neutral default (the
// most common floor-hugging case). Pure + unit-tested.
export function autoHalfShape(top: boolean, right: boolean, bottom: boolean, left: boolean): TileShape{
    const count = (top ? 1 : 0) + (right ? 1 : 0) + (bottom ? 1 : 0) + (left ? 1 : 0)
    // Exactly one wall: hug it.
    if(count === 1){
        if(bottom) return "half_bottom"
        if(top) return "half_top"
        if(right) return "half_right"
        return "half_left"
    }
    // A pair of OPPOSITE walls (corridor): no single side to hug, so fill the gap.
    if((top && bottom && !left && !right) || (left && right && !top && !bottom)){
        return "full"
    }
    // Anything ambiguous (none, a perpendicular pair, three, or four walls):
    // default to the common floor-hugging half.
    return "half_bottom"
}

// The fixed editor palette. The editor authors with a SINGLE shared texture key
// per shape (the renderer's defaults), so the exported palette is small and
// every painted cell of a given shape shares one palette entry. Order here is
// also the order the palette buttons render in. This is the SEED palette an
// EditorMap starts from (tile_default block + slopes + a tile_hidden deco); the
// material picker then APPENDS extra {shape, key} entries on demand (see
// EditorMap.setCell) so painting a new colour never reindexes these.
export const EDITOR_PALETTE: { brush: EditorBrush, shape: TileShape, key: string, label: string }[] = [
    { brush: "full", shape: "full", key: "tile_default", label: "Block" },
    { brush: "diag_tl", shape: "diag_tl", key: "tile_default", label: "Slope TL" },
    { brush: "diag_tr", shape: "diag_tr", key: "tile_default", label: "Slope TR" },
    { brush: "diag_bl", shape: "diag_bl", key: "tile_default", label: "Slope BL" },
    { brush: "diag_br", shape: "diag_br", key: "tile_default", label: "Slope BR" },
    { brush: "half_top", shape: "half_top", key: "tile_default", label: "Half Top" },
    { brush: "half_bottom", shape: "half_bottom", key: "tile_default", label: "Half Bottom" },
    { brush: "half_left", shape: "half_left", key: "tile_default", label: "Half Left" },
    { brush: "half_right", shape: "half_right", key: "tile_default", label: "Half Right" },
    { brush: "deco", shape: "deco", key: "tile_hidden", label: "Deco" },
]

// A MATERIAL is the COLOUR half of a tile (the other half is its shape). Each is
// one of the named block styles in mapGraphics.TILE_BLOCK_STYLES, so the editor
// swatch and the in-game block render the SAME face colour. The active material
// applies to the block brush AND every slope (explicit + auto), so a slope always
// matches the block colour the author chose. Deco is NOT a material: it is
// non-colliding decoration and always keeps the "tile_hidden" key (see
// materialKeyForBrush), so it is excluded from this list and the picker.
export type EditorMaterial = {
    // The block style key. Stored verbatim in a tile's palette entry, so it flows
    // straight through GridMapData -> the validator (which accepts any key) -> the
    // renderer with no game/server/wire change.
    key: string,
    // The human label shown in the material picker tooltip.
    label: string,
}

// The ORDERED, colourable materials, in the order the picker renders them. Keys
// are a subset of TILE_BLOCK_STYLES (the colourable ones; tile_hidden/deco is
// excluded). "tile_default" is first so it stays the default look and a map that
// only ever uses it is byte-identical to today. Adding a key here is purely a
// client concern: any string key is valid map data.
export const EDITOR_MATERIALS: EditorMaterial[] = [
    { key: "tile_default", label: "Plum" },
    { key: "slate", label: "Slate" },
    { key: "rust", label: "Rust" },
    { key: "accent", label: "Purple" },
    { key: "teal", label: "Teal" },
    { key: "cobalt", label: "Cobalt" },
    { key: "moss", label: "Moss" },
    { key: "mauve", label: "Mauve" },
]

// The default active material: the original plum block, so a fresh editor paints
// exactly today's look until the author picks another colour.
export const DEFAULT_MATERIAL_KEY = EDITOR_MATERIALS[0].key

// The block key a brush paints with, given the active MATERIAL. Deco is always
// non-colliding decoration and keeps "tile_hidden" regardless of the picker;
// every colourable brush (block / slope / auto) uses the active material key. The
// shape is decided separately (by the brush / auto-resolution); this is only the
// colour half. Pure + unit-tested.
export function materialKeyForBrush(brush: EditorBrush, materialKey: string): string{
    if(brush === "deco") return "tile_hidden"
    return materialKey
}

// The editor's default map name. Size is no longer fixed: the canvas is
// UNBOUNDED and the author paints cells anywhere; the exported cols/rows are
// computed at export time from the bounding box of everything painted.
export const DEFAULT_MAP_NAME = "My Map"

// Key a cell coordinate into the sparse tile map. Stable, order-independent, and
// reversible via parseCellKey, so the model can store only painted cells.
export function cellKey(col: number, row: number): string{
    return `${col},${row}`
}

// Reverse cellKey back into [col, row]. Used by export to walk every painted
// cell and translate it relative to the bounding box.
export function parseCellKey(key: string): [number, number]{
    const comma = key.indexOf(",")
    const col = parseInt(key.slice(0, comma), 10)
    const row = parseInt(key.slice(comma + 1), 10)
    return [col, row]
}

// The bounding box (inclusive) of a set of cells in arbitrary coordinates, plus
// whether it contains anything at all. Used at export to size the dense grid.
export type EditorBounds = {
    empty: boolean,
    minCol: number,
    minRow: number,
    maxCol: number,
    maxRow: number,
}

// Every cell in the INCLUSIVE bounding box between two corners (a filled
// rectangle). The corners may be given in any diagonal order; the min/max of
// each axis is taken, so (5,7)->(2,3) and (2,3)->(5,7) enumerate the same box. A
// zero-area span (the same cell twice) yields exactly that one cell. Pure +
// unit-tested: the view just paints whatever this returns. Row-major order so a
// caller iterating the result paints top-to-bottom, left-to-right.
export function rectCells(a: Cell, b: Cell): Cell[]{
    const minCol = Math.min(a[0], b[0])
    const maxCol = Math.max(a[0], b[0])
    const minRow = Math.min(a[1], b[1])
    const maxRow = Math.max(a[1], b[1])
    const cells: Cell[] = []
    for(let row = minRow; row <= maxRow; row++){
        for(let col = minCol; col <= maxCol; col++){
            cells.push([col, row])
        }
    }
    return cells
}

// A straight CELL LINE from `a` to `b` via Bresenham's 8-connected algorithm (a
// pixel line, so a 45-degree drag steps diagonally without gaps). Both endpoints
// are included; a zero-length line (a == b) yields the single start cell. The
// result is gap-free: consecutive cells always touch (orthogonally or
// diagonally). Pure + unit-tested.
export function lineCells(a: Cell, b: Cell): Cell[]{
    let x0 = a[0]
    let y0 = a[1]
    const x1 = b[0]
    const y1 = b[1]
    const dx = Math.abs(x1 - x0)
    const dy = Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx - dy
    const cells: Cell[] = []
    // A line of N cells spans (Chebyshev distance + 1) steps; bound the loop by
    // exactly that count so it always terminates at (x1, y1) without a constant
    // `while(true)` condition.
    const steps = Math.max(dx, dy)
    for(let i = 0; i <= steps; i++){
        cells.push([x0, y0])
        if(x0 === x1 && y0 === y1) break
        const e2 = 2 * err
        if(e2 > -dy){
            err -= dy
            x0 += sx
        }
        if(e2 < dx){
            err += dx
            y0 += sy
        }
    }
    return cells
}

// SLOPE-LINE ALTERNATION PAIR: the TWO diagonal shapes a diagonal run alternates
// between to read as a continuous "slope band" (an antialiasing-with-slopes look)
// rather than a staircase of identical triangles. The base case is a DOWN-RIGHT
// stroke (sx = +1, sy = +1), which alternates diag_br / diag_tr; the other three
// quadrants are the geometric MIRRORS of that pair (so the band always slants the
// same way as the stroke):
//   down-right (+,+): [diag_br, diag_tr]
//   down-left  (-,+): mirror H -> [diag_bl, diag_tl]
//   up-right   (+,-): mirror V -> [diag_tr, diag_br]
//   up-left    (-,-): mirror H+V -> [diag_tl, diag_bl]
// Both shapes in a pair meet the stroke's leading diagonal from opposite corners,
// so consecutive diagonal steps overlap into one unbroken wedge. Pure +
// unit-tested; derived via mirrorShape so it can never drift from the geometry.
export function slopeAlternationPair(sx: number, sy: number): [TileShape, TileShape]{
    // Base pair for a down-right stroke.
    let a: TileShape = "diag_br"
    let b: TileShape = "diag_tr"
    // Mirror horizontally for a leftward stroke, vertically for an upward one, so
    // the pair slants the same way the stroke runs in every quadrant.
    if(sx < 0){
        a = mirrorShape(a, "horizontal")
        b = mirrorShape(b, "horizontal")
    }
    if(sy < 0){
        a = mirrorShape(a, "vertical")
        b = mirrorShape(b, "vertical")
    }
    return [a, b]
}

// SLOPE-AWARE LINE: the same cells as lineCells(a, b), each tagged with the
// TileShape that best approximates the line's angle with slope tiles. A
// 45-degree line steps diagonally every cell, so EVERY cell is a slope; a shallow
// (~30-degree) line alternates diagonal steps and straight runs, so it is a MIX
// of slope tiles (the steps) and full blocks (the runs); a pure horizontal or
// vertical line never steps diagonally, so every cell is a full BLOCK.
//
// The DIAGONAL STEP cells do NOT all share one slope: consecutive steps ALTERNATE
// between the two shapes of slopeAlternationPair, so a 45-degree run reads as a
// continuous slope band rather than a staircase of identical triangles. The
// alternation counts DIAGONAL STEPS (not cells), so the straight RUN cells of a
// shallow line never advance the toggle and the diagonal steps either side of a
// run keep alternating cleanly.
//
// Built directly ON lineCells so the rasterization (which cells, in what order)
// stays byte-identical: we only ADD a shape per cell. A cell is a DIAGONAL STEP
// when it moved on BOTH axes relative to the previous cell (the first cell
// compares to the NEXT instead, having no previous). Run cells (moved on one axis
// only), the first/last cells, and every cell of a pure-axis line resolve to
// "full". Pure + unit-tested.
export function lineShapeCells(a: Cell, b: Cell): { cell: Cell, shape: TileShape }[]{
    const cells = lineCells(a, b)
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    // Pure horizontal / vertical (or a single cell): no diagonal steps exist, so
    // the whole line is full blocks. Returning early also avoids a 0-sign slope.
    if(dx === 0 || dy === 0){
        return cells.map(cell => ({ cell, shape: "full" as TileShape }))
    }
    const sx = dx < 0 ? -1 : 1
    const sy = dy < 0 ? -1 : 1
    const [slopeA, slopeB] = slopeAlternationPair(sx, sy)
    // Counts DIAGONAL STEPS so consecutive steps flip between the two slope shapes;
    // run cells leave it untouched.
    let step = 0
    return cells.map((cell, i) => {
        // Compare each cell to its PREVIOUS cell to detect a diagonal step; the
        // first cell has no previous, so it compares to the NEXT cell instead.
        const ref = i === 0 ? cells[i + 1] : cells[i - 1]
        // No reference (a degenerate single-cell list) -> full.
        if(typeof ref === "undefined") return { cell, shape: "full" as TileShape }
        const movedBoth = cell[0] !== ref[0] && cell[1] !== ref[1]
        if(movedBoth === false) return { cell, shape: "full" as TileShape }
        // Alternate the two pair shapes per diagonal step.
        const shape = step % 2 === 0 ? slopeA : slopeB
        step++
        return { cell, shape }
    })
}

// The default extra margin (in cells) the bounded flood fill expands the painted
// content bounding box by before clamping. Lets a fill spill one or two cells
// into the empty border around the content (so an enclosed room whose walls sit
// on the bbox edge still fills), without ever running off into infinite empty
// space.
export const FILL_BOUNDS_MARGIN = 2

// The default hard cap on cells a single bounded flood fill may visit. A backstop
// beneath the bbox clamp: even a pathological clamp can never make the fill hang
// or blow memory; once the cap is hit the fill stops cleanly and returns the
// partial result.
export const FILL_CELL_CAP = 20000

// A BOUNDED 4-connected flood fill, pure and DOM-free so its termination is
// unit-testable. Starting at `start`, it visits every orthogonally-connected cell
// whose CURRENT value equals the start cell's value (empty counts as the value 0)
// and returns the set of cells to repaint. The canvas is INFINITE and the model
// SPARSE, so an OPEN empty region would otherwise fill forever; two bounds keep it
// safe: (a) a CLAMP rectangle (the caller passes the painted-content bbox expanded
// by FILL_BOUNDS_MARGIN) outside which no cell is ever visited, and (b) a hard CAP
// on visited cells as a backstop. Hitting either bound stops the fill cleanly with
// a partial result (no crash, no hang). `tileAt` reads the value at any cell (0 =
// empty); the caller wires it to EditorMap.tileAt.
export function boundedFloodFill(
    start: Cell,
    tileAt: (col: number, row: number) => number,
    clamp: { minCol: number, minRow: number, maxCol: number, maxRow: number },
    cap: number = FILL_CELL_CAP,
): Cell[]{
    // A start outside the clamp can never be the seed of an in-bounds fill.
    if(start[0] < clamp.minCol || start[0] > clamp.maxCol || start[1] < clamp.minRow || start[1] > clamp.maxRow){
        return []
    }
    const target = tileAt(start[0], start[1])
    const result: Cell[] = []
    const seen = new Set<string>()
    const stack: Cell[] = [start]
    seen.add(cellKey(start[0], start[1]))
    while(stack.length > 0){
        // Backstop cap: stop cleanly with whatever we have rather than hang.
        if(result.length >= cap) break
        const cell = stack.pop() as Cell
        const col = cell[0]
        const row = cell[1]
        if(tileAt(col, row) !== target) continue
        result.push(cell)
        // 4-connected neighbours, each gated by the clamp and the visited set so
        // no cell is ever queued twice or outside the bounded region.
        const neighbours: Cell[] = [
            [col + 1, row],
            [col - 1, row],
            [col, row + 1],
            [col, row - 1],
        ]
        for(const next of neighbours){
            if(next[0] < clamp.minCol || next[0] > clamp.maxCol || next[1] < clamp.minRow || next[1] > clamp.maxRow) continue
            const key = cellKey(next[0], next[1])
            if(seen.has(key)) continue
            seen.add(key)
            stack.push(next)
        }
    }
    return result
}

// The editor's own working state, SPARSE and UNBOUNDED. `tiles` is a Map keyed
// by "col,row" whose values use the SAME "palette index + 1" encoding the
// on-disk GridMapData uses (n >= 1 references palette[n-1]); a missing key is an
// empty cell. `spawns` is a list of [col, row] cells. There is no fixed
// cols/rows: cells live at any integer coordinate (including negative or far
// away), and the exported size is derived from the bounding box. Held as a class
// so the view can mutate in place and re-read without rebuilding the whole grid
// each paint.
export class EditorMap{
    name: string
    cellSize: number
    tiles: Map<string, number>
    spawns: [number, number][]
    palette: TilePaletteEntry[]

    constructor(
        name = DEFAULT_MAP_NAME,
        cellSize = TILE_SIZE,
    ){
        this.name = name
        this.cellSize = cellSize
        this.tiles = new Map<string, number>()
        this.spawns = []
        // Build a stable palette from the fixed editor palette so every shape
        // has a known index for the "index + 1" encoding. Index i here maps to
        // tiles value i + 1.
        this.palette = EDITOR_PALETTE.map((entry) => ({ key: entry.key, shape: entry.shape }))
    }

    // The tiles value (0 = empty, n >= 1 = palette[n-1]) at a cell. Any cell not
    // in the sparse map is empty (0).
    tileAt(col: number, row: number): number{
        return this.tiles.get(cellKey(col, row)) ?? 0
    }

    // Is there a spawn marker on this cell?
    hasSpawn(col: number, row: number): boolean{
        return this.spawns.some(([c, r]) => c === col && r === row)
    }

    // Is the cell a FULL (square wall) tile? Kept for callers that specifically
    // want a full block (the auto tools now use the richer solid-edge test below).
    isFull(col: number, row: number): boolean{
        const value = this.tileAt(col, row)
        if(value <= 0) return false
        const entry = this.palette[value - 1]
        return typeof entry !== "undefined" && entry.shape === "full"
    }

    // The concrete TileShape at a cell, or undefined when the cell is empty or its
    // value is out of palette. Lets the auto tools read a neighbour's shape (not
    // just "is it full") so they can honour slopes + half-tiles too.
    shapeAt(col: number, row: number): TileShape | undefined{
        const value = this.tileAt(col, row)
        if(value <= 0) return undefined
        const entry = this.palette[value - 1]
        return typeof entry === "undefined" ? undefined : entry.shape
    }

    // The four neighbour-solidity booleans (top, right, bottom, left) the AUTO
    // tools resolve against: a side is solid when the neighbour on that side EXISTS
    // and presents a FULL-LENGTH wall on the edge FACING this cell. So a full block
    // counts (all edges solid), and a slope or half-tile counts only when its flat
    // side faces here (e.g. a half_bottom ABOVE this cell faces DOWN with its open
    // mid-cell edge, so it does NOT count; a half_top above faces down with its
    // solid filled edge, so it DOES). The facing edge is the OPPOSITE of the
    // direction the neighbour lies in: the neighbour above must be solid on its
    // BOTTOM edge to wall this cell's top, etc. Shared by autoShapeAt +
    // autoHalfShapeAt so both read neighbours identically.
    neighbourSolidEdges(col: number, row: number): { top: boolean, right: boolean, bottom: boolean, left: boolean }{
        const solid = (nc: number, nr: number, facing: "top" | "right" | "bottom" | "left"): boolean => {
            const shape = this.shapeAt(nc, nr)
            return typeof shape !== "undefined" && shapeEdgeSolid(shape, facing)
        }
        return {
            top: solid(col, row - 1, "bottom"),
            right: solid(col + 1, row, "left"),
            bottom: solid(col, row + 1, "top"),
            left: solid(col - 1, row, "right"),
        }
    }

    // The shape the AUTO (slope) brush paints at a cell, derived from which
    // orthogonal neighbours wall it (full blocks AND slopes/half-tiles whose flat
    // side faces here both count).
    autoShapeAt(col: number, row: number): TileShape{
        const n = this.neighbourSolidEdges(col, row)
        return autoSlopeShape(n.top, n.right, n.bottom, n.left)
    }

    // The shape the AUTO HALF (half_auto) brush paints at a cell, derived from the
    // same neighbour-solidity as the auto slope: it hugs the side that has a wall.
    autoHalfShapeAt(col: number, row: number): TileShape{
        const n = this.neighbourSolidEdges(col, row)
        return autoHalfShape(n.top, n.right, n.bottom, n.left)
    }

    // Find the "palette index + 1" value for a {shape, key} pair, APPENDING a new
    // palette entry when no existing one matches. This is the heart of the
    // append-only palette: an existing entry is REUSED (its index never moves) and
    // a brand-new combination is pushed onto the END, so every tile VALUE already
    // stored in `tiles`, in an EditorHistory snapshot, or in a loaded map stays
    // valid forever. That stability is exactly why undo/redo and import can never
    // corrupt: a value n always still points at the same palette[n - 1]. Pure
    // w.r.t. existing entries; the only mutation is the append.
    paletteValueFor(shape: TileShape, key: string): number{
        for(let i = 0; i < this.palette.length; i++){
            const entry = this.palette[i]
            if(entry.shape === shape && entry.key === key) return i + 1
        }
        this.palette.push({ key, shape })
        return this.palette.length
    }

    // Recolour the EXISTING tile at a cell to the active material, keeping its
    // SHAPE. The "recolor" brush only ever recolours: an empty cell or a spawn is
    // left untouched (it never creates or erases a tile), and a deco tile keeps its
    // non-colliding tile_hidden key. Returns true only when the cell's value
    // actually changed, so a recolor stroke that hits nothing recolourable (or
    // re-applies the same colour) is one no-op and creates no undo step. Routed
    // through the SAME append-only paletteValueFor as painting, so a never-seen
    // {shape, key} grows the palette without touching any existing index.
    recolorCell(col: number, row: number, materialKey: string): boolean{
        // A spawn holds no tile, and an empty cell has nothing to recolour.
        if(this.hasSpawn(col, row)) return false
        const shape = this.shapeAt(col, row)
        if(typeof shape === "undefined") return false
        // Deco is non-colliding decoration: it keeps tile_hidden, never a material.
        const nextKey = shape === "deco" ? "tile_hidden" : materialKey
        const key = cellKey(col, row)
        const next = this.paletteValueFor(shape, nextKey)
        if(this.tiles.get(key) === next) return false
        this.tiles.set(key, next)
        return true
    }

    // Paint one brush into one cell at ANY coordinate, in the active MATERIAL
    // (colour). "empty" erases the tile, every shape brush writes a tile of that
    // shape in the given material (deco ignores the material and stays the
    // non-colliding "tile_hidden" key), and "spawn" toggles a spawn marker. The two
    // RESOLVING brushes resolve at paint time: "half_auto" picks a half-tile
    // orientation from neighbours (like "auto" does for slopes) and "recolor"
    // recolours the existing tile in place (keeping its shape, never creating or
    // erasing one). The {shape, materialKey} pair resolves to a palette value via
    // the APPEND-ONLY paletteValueFor, so a never-seen colour grows the palette
    // without touching any existing index. A cell can NEVER hold both a tile and a
    // spawn: painting a tile onto a cell that has a spawn removes the spawn, and
    // toggling a spawn onto a cell that has a tile removes the tile. Returns true
    // when something actually changed, so the view can skip redundant redraws while
    // dragging. The material defaults to DEFAULT_MATERIAL_KEY so call sites that do
    // not care about colour (tests, the eraser, spawns) keep working unchanged.
    setCell(col: number, row: number, brush: PaintBrush, materialKey: string = DEFAULT_MATERIAL_KEY): boolean{
        if(brush === "spawn"){
            return this.toggleSpawn(col, row)
        }

        // Recolour resolves to "change the existing tile's colour, nothing else".
        if(brush === "recolor"){
            return this.recolorCell(col, row, materialKey)
        }

        const key = cellKey(col, row)
        if(brush === "empty"){
            if(this.tiles.has(key) === false) return false
            this.tiles.delete(key)
            return true
        }

        // Resolve the concrete SHAPE + colour key. Auto slope / auto half resolve
        // their shape from the cell's neighbours; every other shape brush IS its
        // shape. The colour comes from the active material (deco forces tile_hidden
        // via materialKeyForBrush; the auto brushes carry no deco shape so they keep
        // the material).
        let shape: TileShape
        let colourKey: string
        if(brush === "auto"){
            shape = this.autoShapeAt(col, row)
            colourKey = materialKey
        } else if(brush === "half_auto"){
            shape = this.autoHalfShapeAt(col, row)
            colourKey = materialKey
        } else{
            shape = brush
            colourKey = materialKeyForBrush(brush, materialKey)
        }
        const next = this.paletteValueFor(shape, colourKey)
        const hadSpawn = this.removeSpawn(col, row)
        if(this.tiles.get(key) === next && hadSpawn === false) return false
        this.tiles.set(key, next)
        return true
    }

    // Add a spawn marker at a cell, or remove it if one is already there. A
    // spawn and a tile are MUTUALLY EXCLUSIVE: dropping a spawn onto a cell that
    // holds a tile erases that tile first, so a cell never carries both.
    toggleSpawn(col: number, row: number): boolean{
        const existing = this.spawns.findIndex(([c, r]) => c === col && r === row)
        if(existing === -1){
            this.tiles.delete(cellKey(col, row))
            this.spawns.push([col, row])
        } else{
            this.spawns.splice(existing, 1)
        }
        return true
    }

    // Remove any spawn marker on a cell, returning true if one was there. Used by
    // tile painting to keep tiles and spawns mutually exclusive.
    removeSpawn(col: number, row: number): boolean{
        const existing = this.spawns.findIndex(([c, r]) => c === col && r === row)
        if(existing === -1) return false
        this.spawns.splice(existing, 1)
        return true
    }

    // Clear every tile and spawn, keeping name/palette/cellSize. Used by the
    // view's "Clear" action.
    clear(){
        this.tiles = new Map<string, number>()
        this.spawns = []
    }

    // The inclusive bounding box of every painted tile + spawn, or an empty flag
    // when nothing is painted. Used at export to size the dense grid and to
    // translate cells so the bbox min maps to (0, 0).
    bounds(): EditorBounds{
        let minCol = Infinity
        let minRow = Infinity
        let maxCol = -Infinity
        let maxRow = -Infinity

        const include = (col: number, row: number) => {
            if(col < minCol) minCol = col
            if(col > maxCol) maxCol = col
            if(row < minRow) minRow = row
            if(row > maxRow) maxRow = row
        }

        for(const key of this.tiles.keys()){
            const [col, row] = parseCellKey(key)
            include(col, row)
        }
        for(const [col, row] of this.spawns){
            include(col, row)
        }

        if(minCol > maxCol || minRow > maxRow){
            return { empty: true, minCol: 0, minRow: 0, maxCol: 0, maxRow: 0 }
        }
        return { empty: false, minCol, minRow, maxCol, maxRow }
    }

    // The clamp rectangle a bounded flood fill seeded at `start` may visit: the
    // painted-content bbox expanded by `margin` on every side, but always grown
    // to include the seed cell so a click on an empty cell just outside the
    // current content still fills the bounded region around it (and a fill on a
    // totally blank canvas fills a small box around the click rather than
    // nothing). Routed through boundedFloodFill, which never visits a cell
    // outside this rectangle, so an open empty region can never fill forever.
    fillClamp(start: Cell, margin: number = FILL_BOUNDS_MARGIN): { minCol: number, minRow: number, maxCol: number, maxRow: number }{
        const box = this.bounds()
        if(box.empty){
            return {
                minCol: start[0] - margin,
                minRow: start[1] - margin,
                maxCol: start[0] + margin,
                maxRow: start[1] + margin,
            }
        }
        return {
            minCol: Math.min(box.minCol, start[0]) - margin,
            minRow: Math.min(box.minRow, start[1]) - margin,
            maxCol: Math.max(box.maxCol, start[0]) + margin,
            maxRow: Math.max(box.maxRow, start[1]) + margin,
        }
    }

    // Serialize to the exact GridMapData shape loadGridMap consumes. The canvas
    // is unbounded, so the exported cols/rows are the extent of the BOUNDING BOX
    // of everything painted; the dense row-major tiles array is offset so the
    // bbox min maps to (0, 0), and spawns are translated the same way.
    // originCol/originRow stay 0 (a fresh authored map loads at the world origin
    // and only needs to load via loadGridMap, which the round-trip asserts). An
    // EMPTY map exports a sane minimal 1x1 map. The map name is trimmed (falling
    // back to a default) so the export always carries a usable name.
    toGridMapData(): GridMapData{
        const box = this.bounds()
        const cols = box.empty ? 1 : box.maxCol - box.minCol + 1
        const rows = box.empty ? 1 : box.maxRow - box.minRow + 1

        const tiles = new Array(cols * rows).fill(0)
        if(box.empty === false){
            for(const [key, value] of this.tiles){
                const [col, row] = parseCellKey(key)
                const c = col - box.minCol
                const r = row - box.minRow
                tiles[r * cols + c] = value
            }
        }

        const spawns: [number, number][] = box.empty
            ? []
            : this.spawns.map(([c, r]) => [c - box.minCol, r - box.minRow] as [number, number])

        return {
            name: this.name.trim().length > 0 ? this.name.trim() : DEFAULT_MAP_NAME,
            cellSize: this.cellSize,
            cols,
            rows,
            tiles,
            spawns,
            palette: this.palette.map((entry) => ({ key: entry.key, shape: entry.shape })),
            originCol: 0,
            originRow: 0,
        }
    }

    // Rebuild an EditorMap from a GridMapData (e.g. an exported/imported JSON).
    // The dense cols*rows tiles array is unpacked into the sparse model (only
    // non-empty cells are stored), so an exported map imports back into an
    // equivalent sparse map. Anything missing or malformed is coerced to a sane
    // value so a hand-edited or partial file still loads instead of throwing.
    static fromGridMapData(data: GridMapData): EditorMap{
        const cols = Math.max(0, Math.floor(data.cols))
        const rows = Math.max(0, Math.floor(data.rows))
        const name = typeof data.name === "string" && data.name.length > 0 ? data.name : DEFAULT_MAP_NAME
        const cellSize = typeof data.cellSize === "number" && data.cellSize > 0 ? data.cellSize : TILE_SIZE

        const map = new EditorMap(name, cellSize)

        // Prefer the file's palette when present so imported values keep their
        // meaning; otherwise the constructor's editor palette is used.
        if(Array.isArray(data.palette) && data.palette.length > 0){
            map.palette = data.palette.map((entry) => ({ key: entry.key, shape: entry.shape }))
        }

        if(Array.isArray(data.tiles)){
            for(let row = 0; row < rows; row++){
                for(let col = 0; col < cols; col++){
                    const value = data.tiles[row * cols + col]
                    if(typeof value === "number" && value > 0){
                        map.tiles.set(cellKey(col, row), Math.floor(value))
                    }
                }
            }
        }

        if(Array.isArray(data.spawns)){
            map.spawns = data.spawns
                .filter((pair) => Array.isArray(pair) && pair.length === 2)
                .map(([c, r]) => [Math.floor(c), Math.floor(r)] as [number, number])
        }

        return map
    }
}

// The single blocking reason a map cannot be PLAYED yet, or null when it is
// playable. Pure + DOM-free so the editor view can show it live and it unit-tests
// cleanly. A map needs at least one spawn (players have nowhere to enter without
// one) and must fit the server's hard cell cap (the loader rejects anything over
// MAX_CUSTOM_CELLS, so warn here before the host ever tries to load it). The
// spawn check comes first since it is the common case.
export function editorMapIssue(map: EditorMap): string | null{
    if(map.spawns.length === 0){
        return "Add at least one spawn point to play."
    }
    const box = map.bounds()
    const cells = box.empty ? 0 : (box.maxCol - box.minCol + 1) * (box.maxRow - box.minRow + 1)
    if(cells > MAX_CUSTOM_CELLS){
        return `Map is too large to play (${cells} of ${MAX_CUSTOM_CELLS} cells).`
    }
    return null
}

// Which way to mirror the map: "horizontal" reflects left<->right (across a
// vertical centre line), "vertical" reflects top<->bottom.
export type MirrorAxis = "horizontal" | "vertical"

// The shape a tile becomes when reflected across the given axis. Full + deco are
// symmetric (unchanged). Diagonals swap the corner their right angle sits in, and
// half-tiles swap to the opposite half - but only the halves/diagonals that the
// reflection actually flips (e.g. a horizontal mirror leaves half_top/half_bottom
// alone). Pure + total over TileShape so it unit-tests cleanly.
export function mirrorShape(shape: TileShape, axis: MirrorAxis): TileShape{
    if(axis === "horizontal"){
        if(shape === "diag_tl") return "diag_tr"
        if(shape === "diag_tr") return "diag_tl"
        if(shape === "diag_bl") return "diag_br"
        if(shape === "diag_br") return "diag_bl"
        if(shape === "half_left") return "half_right"
        if(shape === "half_right") return "half_left"
        return shape
    }
    if(shape === "diag_tl") return "diag_bl"
    if(shape === "diag_bl") return "diag_tl"
    if(shape === "diag_tr") return "diag_br"
    if(shape === "diag_br") return "diag_tr"
    if(shape === "half_top") return "half_bottom"
    if(shape === "half_bottom") return "half_top"
    return shape
}

// Reflect every painted tile + spawn across the CENTRE of the current painted
// bounding box, flipping each shape's direction, so a half-painted layout becomes
// a SYMMETRIC arena in one action (great for balanced competitive maps). The
// reflection is a UNION: originals stay and their mirror images are added. A cell
// that lands on the centre line maps to itself and is skipped. Writes through
// setCell/toggleSpawn so the append-only palette + spawn/tile exclusion are
// respected. A mirror image is SKIPPED when its destination already holds the
// OPPOSITE content type (a tile vs a spawn): tiles and spawns are mutually
// exclusive per cell, so writing one would evict the other - and when a tile and a
// spawn mirror onto each other that would destroy BOTH originals. Such a cell just
// cannot be made symmetric; the original is kept. Returns true if anything changed.
export function mirrorMap(map: EditorMap, axis: MirrorAxis): boolean{
    const box = map.bounds()
    if(box.empty) return false
    // Snapshot the sources first so we never read half-mirrored state.
    const tiles: { col: number, row: number, shape: TileShape, key: string }[] = []
    for(const [k, value] of map.tiles){
        const [c, r] = parseCellKey(k)
        const entry = map.palette[value - 1]
        if(typeof entry === "undefined") continue
        tiles.push({ col: c, row: r, shape: entry.shape, key: entry.key })
    }
    const spawns: Cell[] = map.spawns.map(([c, r]) => [c, r])
    // Reflect across the box centre: minCol+maxCol - c (and likewise for rows). The
    // centre column/row of an odd-width box maps to itself.
    const span = axis === "horizontal" ? box.minCol + box.maxCol : box.minRow + box.maxRow
    const mirror = (c: number, r: number): Cell =>
        axis === "horizontal" ? [span - c, r] : [c, span - r]
    let changed = false
    for(const t of tiles){
        const [mc, mr] = mirror(t.col, t.row)
        if(mc === t.col && mr === t.row) continue
        // Do not overwrite an existing spawn with a mirrored tile: setCell would
        // evict it, destroying an original where a tile and a spawn mirror together.
        if(map.hasSpawn(mc, mr)) continue
        // mirrorShape never returns "auto"; TileShape is a subset of EditorBrush.
        if(map.setCell(mc, mr, mirrorShape(t.shape, axis), t.key)) changed = true
    }
    for(const [c, r] of spawns){
        const [mc, mr] = mirror(c, r)
        if(mc === c && mr === r) continue
        // Skip if the destination already holds a spawn OR a tile: writing a spawn
        // over a tile would evict that tile (the mirror image of the case above).
        if(map.hasSpawn(mc, mr)) continue
        if(map.tileAt(mc, mr) > 0) continue
        map.setCell(mc, mr, "spawn")
        changed = true
    }
    return changed
}

// SELECTION / TRANSFORM (Aseprite-style). A SELECTION is an inclusive rectangle
// of cells the author marqueed; lifting its content produces a FLOATING CLIP
// (the cells copied into clip-relative coordinates) that can be moved, rotated,
// flipped, copied/cut/pasted, then stamped back into the map. All of it lives in
// this PURE model so the region transforms unit-test independently of the view.

// An inclusive rectangle of cells in MAP coordinates. minCol..maxCol and
// minRow..maxRow are both inclusive, so a 1x1 selection has min == max. The view
// builds this from a marquee drag (any diagonal order) via normalizeRect.
export type CellRect = {
    minCol: number,
    minRow: number,
    maxCol: number,
    maxRow: number,
}

// Normalise two marquee corners (in any diagonal order) into an inclusive
// CellRect by taking the min/max of each axis, so (5,7)->(2,3) and (2,3)->(5,7)
// describe the same rectangle. Pure + unit-tested.
export function normalizeRect(a: Cell, b: Cell): CellRect{
    return {
        minCol: Math.min(a[0], b[0]),
        minRow: Math.min(a[1], b[1]),
        maxCol: Math.max(a[0], b[0]),
        maxRow: Math.max(a[1], b[1]),
    }
}

// A single tile inside a floating clip, in clip-RELATIVE coordinates (col/row are
// 0-based offsets from the clip's top-left). The shape + key are the resolved
// tile content (the same {shape, key} a palette entry holds), so a clip is
// self-contained and never depends on the source map's palette indices.
export type EditorClipTile = {
    col: number,
    row: number,
    shape: TileShape,
    key: string,
}

// A FLOATING CLIP: a rectangular region's content captured in clip-relative
// coordinates. `cols`/`rows` are the clip's dimensions; `tiles` holds only the
// non-empty cells (sparse), and `spawns` holds relative spawn coordinates. A clip
// is fully detached from any map: it stamps back via setCell/toggleSpawn so the
// destination map's append-only palette + spawn/tile exclusion always hold.
export type EditorClip = {
    cols: number,
    rows: number,
    tiles: EditorClipTile[],
    spawns: [number, number][],
}

// Copy the cells in an inclusive rect into a self-contained clip in clip-relative
// coordinates, WITHOUT mutating the map. Each painted tile resolves to its
// {shape, key} (so the clip carries no palette indices) and each spawn translates
// to clip-relative coords. An out-of-palette tile value is skipped (it cannot be
// reproduced). Pure + unit-tested.
export function extractClip(map: EditorMap, rect: CellRect): EditorClip{
    const cols = rect.maxCol - rect.minCol + 1
    const rows = rect.maxRow - rect.minRow + 1
    const tiles: EditorClipTile[] = []
    for(let row = rect.minRow; row <= rect.maxRow; row++){
        for(let col = rect.minCol; col <= rect.maxCol; col++){
            const value = map.tileAt(col, row)
            if(value <= 0) continue
            const entry = map.palette[value - 1]
            if(typeof entry === "undefined") continue
            tiles.push({ col: col - rect.minCol, row: row - rect.minRow, shape: entry.shape, key: entry.key })
        }
    }
    const spawns: [number, number][] = []
    for(const [c, r] of map.spawns){
        if(c < rect.minCol || c > rect.maxCol || r < rect.minRow || r > rect.maxRow) continue
        spawns.push([c - rect.minCol, r - rect.minRow])
    }
    return { cols, rows, tiles, spawns }
}

// Delete every tile + spawn inside an inclusive rect, returning true if anything
// changed. Used by Cut (after extracting) and Delete. Writes through the map's
// own containers so a later snapshot/undo captures exactly the cleared state.
export function clearRegion(map: EditorMap, rect: CellRect): boolean{
    let changed = false
    for(let row = rect.minRow; row <= rect.maxRow; row++){
        for(let col = rect.minCol; col <= rect.maxCol; col++){
            const key = cellKey(col, row)
            if(map.tiles.has(key)){
                map.tiles.delete(key)
                changed = true
            }
            if(map.removeSpawn(col, row)) changed = true
        }
    }
    return changed
}

// Write a clip into the map at an offset (atCol, atRow = where the clip's
// top-left lands), OVERWRITING the destination cells. Tiles route through setCell
// (which resolves the {shape, key} via the APPEND-ONLY paletteValueFor and evicts
// any spawn) and spawns route through a guarded toggleSpawn (only added when not
// already present, since toggleSpawn flips). A clip tile whose shape is "deco"
// keeps its tile_hidden key through setCell's materialKeyForBrush. Returns true
// if anything changed. Pure w.r.t. the clip; only the map is mutated.
export function stampClip(map: EditorMap, clip: EditorClip, atCol: number, atRow: number): boolean{
    let changed = false
    for(const tile of clip.tiles){
        const col = atCol + tile.col
        const row = atRow + tile.row
        // The tile's shape IS a valid brush (TileShape is a subset of EditorBrush);
        // its key is the material so the colour is preserved. setCell appends the
        // {shape, key} to the palette if new and evicts any spawn underneath.
        if(map.setCell(col, row, tile.shape, tile.key)) changed = true
    }
    for(const [c, r] of clip.spawns){
        const col = atCol + c
        const row = atRow + r
        // toggleSpawn flips, so guard: only add a spawn where there is not one
        // already (stamping twice on the same cell must not remove it).
        if(map.hasSpawn(col, row) === false){
            map.toggleSpawn(col, row)
            changed = true
        }
    }
    return changed
}

// Rotate a single tile SHAPE 90 degrees CLOCKWISE. Full + deco are
// rotationally symmetric (unchanged). A diagonal's right-angle corner walks one
// quarter-turn clockwise around the cell (tl -> tr -> br -> bl -> tl), and a
// half-tile's filled edge walks the same way (top -> right -> bottom -> left ->
// top). Applying this four times returns the original shape. Pure + unit-tested.
export function rotateShapeCW(shape: TileShape): TileShape{
    if(shape === "diag_tl") return "diag_tr"
    if(shape === "diag_tr") return "diag_br"
    if(shape === "diag_br") return "diag_bl"
    if(shape === "diag_bl") return "diag_tl"
    if(shape === "half_top") return "half_right"
    if(shape === "half_right") return "half_bottom"
    if(shape === "half_bottom") return "half_left"
    if(shape === "half_left") return "half_top"
    return shape
}

// Rotate a whole clip 90 degrees CLOCKWISE. The dimensions swap (an MxN clip
// becomes NxM), each cell (c, r) maps to (rows - 1 - r, c), and each tile's shape
// rotates via rotateShapeCW. Spawns map the same way. Pure: returns a new clip,
// leaving the input untouched. Applying it four times round-trips to the original
// clip (cells + shapes + spawns). Unit-tested.
export function rotateClipCW(clip: EditorClip): EditorClip{
    const tiles: EditorClipTile[] = clip.tiles.map((t) => ({
        col: clip.rows - 1 - t.row,
        row: t.col,
        shape: rotateShapeCW(t.shape),
        key: t.key,
    }))
    const spawns: [number, number][] = clip.spawns.map(([c, r]) => [clip.rows - 1 - r, c] as [number, number])
    return { cols: clip.rows, rows: clip.cols, tiles, spawns }
}

// Mirror a whole clip across the given axis: a horizontal flip reflects columns
// (c -> cols - 1 - c) and a vertical flip reflects rows (r -> rows - 1 - r), with
// each tile's shape reflected via the EXISTING mirrorShape. Spawns flip the same
// way. Pure: returns a new clip. Flipping twice on the same axis round-trips to
// the original (mirrorShape is an involution and the coordinate flip is too).
// Unit-tested.
export function flipClip(clip: EditorClip, axis: MirrorAxis): EditorClip{
    const tiles: EditorClipTile[] = clip.tiles.map((t) => ({
        col: axis === "horizontal" ? clip.cols - 1 - t.col : t.col,
        row: axis === "vertical" ? clip.rows - 1 - t.row : t.row,
        shape: mirrorShape(t.shape, axis),
        key: t.key,
    }))
    const spawns: [number, number][] = clip.spawns.map(([c, r]) => [
        axis === "horizontal" ? clip.cols - 1 - c : c,
        axis === "vertical" ? clip.rows - 1 - r : r,
    ] as [number, number])
    return { cols: clip.cols, rows: clip.rows, tiles, spawns }
}

// TRANSFORM HANDLES (free-transform a footprint, Photoshop/Figma style). When a
// region is selected the view draws 8 resize handles (4 corners + 4 edge
// midpoints) plus a ROTATE knob above the top edge; dragging a handle resizes the
// footprint, dragging the body translates it, and the knob rotates. Each name is
// what the hit test returns and the view dispatches on. "body" = inside the rect
// but not on a handle (drag-to-move); "none" = nothing under the pointer. All the
// geometry below is PURE + DOM-free so it unit-tests independently of the view.
export type TransformHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate" | "body" | "none"

// The inclusive width/height of a CellRect in cells: a 1x1 rect (min == max) is
// 1x1, not 0x0. Pure + unit-tested; the view sizes the footprint with this.
export function rectDims(rect: CellRect): { cols: number, rows: number }{
    return {
        cols: rect.maxCol - rect.minCol + 1,
        rows: rect.maxRow - rect.minRow + 1,
    }
}

// NEAREST-NEIGHBOUR resample of a clip to new cell dimensions. Every destination
// cell (dc, dr) maps back to the source cell (floor(dc * cols / newCols),
// floor(dr * rows / newRows)) and copies that source tile's {shape, key}
// VERBATIM: shapes are never geometrically altered (a diag_tl stays a diag_tl, it
// is only duplicated or dropped), so scaling keeps the authored look and only
// changes how many cells each tile spans. Spawns resample by the same ratio and
// are DE-DUPLICATED (two source spawns can collapse onto one destination cell).
// newCols/newRows are clamped to >= 1 so a zero/negative argument can never make
// an empty or inverted clip. Pure: returns a NEW clip, leaving the input
// untouched. Unit-tested.
export function scaleClip(clip: EditorClip, newCols: number, newRows: number): EditorClip{
    const cols = Math.max(1, Math.floor(newCols))
    const rows = Math.max(1, Math.floor(newRows))
    // Index the source by clip-relative key so each destination cell is a single
    // O(1) lookup of "is there a tile at the mapped-back source cell".
    const source = new Map<string, EditorClipTile>()
    for(const tile of clip.tiles){
        source.set(cellKey(tile.col, tile.row), tile)
    }
    const tiles: EditorClipTile[] = []
    for(let dr = 0; dr < rows; dr++){
        for(let dc = 0; dc < cols; dc++){
            const sc = Math.floor(dc * clip.cols / cols)
            const sr = Math.floor(dr * clip.rows / rows)
            const tile = source.get(cellKey(sc, sr))
            if(typeof tile === "undefined") continue
            // Copy shape + key verbatim; only the destination coordinate changes.
            tiles.push({ col: dc, row: dr, shape: tile.shape, key: tile.key })
        }
    }
    // Resample spawns by the same ratio and de-dup: scaling DOWN can map several
    // source spawns onto one destination cell, and a clip must not carry the same
    // spawn twice.
    const spawns: [number, number][] = []
    const seen = new Set<string>()
    for(const [c, r] of clip.spawns){
        const dc = Math.floor(c * cols / clip.cols)
        const dr = Math.floor(r * rows / clip.rows)
        const key = cellKey(dc, dr)
        if(seen.has(key)) continue
        seen.add(key)
        spawns.push([dc, dr])
    }
    return { cols, rows, tiles, spawns }
}

// Resize an inclusive CellRect by dragging `handle` (dCol, dRow) cells, anchoring
// the OPPOSITE edge/corner so the side under the pointer is the only one that
// moves: dragging "se" moves maxCol/maxRow (minCol/minRow fixed); "nw" moves the
// mins; an edge handle ("n"/"e"/"s"/"w") moves only that one edge; "body"
// translates the whole rect by (dCol, dRow). The dragged edge is CLAMPED so it
// never crosses the anchor: a rect stays at least 1x1 (min <= max). "rotate" and
// "none" leave the rect unchanged (rotation does not resize). Pure + unit-tested.
export function resizeRectByHandle(rect: CellRect, handle: TransformHandle, dCol: number, dRow: number): CellRect{
    let minCol = rect.minCol
    let minRow = rect.minRow
    let maxCol = rect.maxCol
    let maxRow = rect.maxRow
    if(handle === "body"){
        return {
            minCol: minCol + dCol,
            minRow: minRow + dRow,
            maxCol: maxCol + dCol,
            maxRow: maxRow + dRow,
        }
    }
    // Whether this handle touches the west / east / north / south edge.
    const movesWest = handle === "nw" || handle === "w" || handle === "sw"
    const movesEast = handle === "ne" || handle === "e" || handle === "se"
    const movesNorth = handle === "nw" || handle === "n" || handle === "ne"
    const movesSouth = handle === "sw" || handle === "s" || handle === "se"
    // Move each dragged edge, then clamp it to the anchor so it never inverts the
    // rect (the dragged min can rise at most to maxCol; the dragged max can fall at
    // most to minCol), keeping cols/rows >= 1.
    if(movesWest) minCol = Math.min(minCol + dCol, maxCol)
    if(movesEast) maxCol = Math.max(maxCol + dCol, minCol)
    if(movesNorth) minRow = Math.min(minRow + dRow, maxRow)
    if(movesSouth) maxRow = Math.max(maxRow + dRow, minRow)
    return { minCol, minRow, maxCol, maxRow }
}

// PURE screen-space hit test for the transform handles. (x, y, w, h) is the
// footprint's SCREEN rectangle in px; (px, py) is the pointer in px; `size` is the
// handle hit radius in px. The 8 resize handles sit at the rect's corners and edge
// midpoints, and the ROTATE knob floats `size * 2.5` above the top-centre. A
// pointer within EUCLIDEAN distance `size` of a handle point returns that handle;
// CORNERS take precedence over edges where their radii overlap. If no handle is
// hit but the pointer is inside the rect, it is a body drag ("body"); otherwise
// "none". Unit-tested.
export function handleHit(x: number, y: number, w: number, h: number, px: number, py: number, size: number): TransformHandle{
    const cx = x + w / 2
    const cy = y + h / 2
    const near = (hx: number, hy: number): boolean => {
        const ddx = px - hx
        const ddy = py - hy
        return ddx * ddx + ddy * ddy <= size * size
    }
    // The rotate knob floats above the top-centre.
    if(near(cx, y - size * 2.5)) return "rotate"
    // Corners FIRST so they win over an edge midpoint where the two overlap.
    if(near(x, y)) return "nw"
    if(near(x + w, y)) return "ne"
    if(near(x + w, y + h)) return "se"
    if(near(x, y + h)) return "sw"
    // Edge midpoints.
    if(near(cx, y)) return "n"
    if(near(x + w, cy)) return "e"
    if(near(cx, y + h)) return "s"
    if(near(x, cy)) return "w"
    // Not on a handle: inside the rect is a body drag, outside is nothing.
    if(px >= x && px <= x + w && py >= y && py <= y + h) return "body"
    return "none"
}

// The signed number of 90-degree QUARTER TURNS between two angles in RADIANS, for
// a rotate-knob drag that snaps to the nearest quarter turn: round((current -
// start) / (PI / 2)), so the rotation snaps at the +/-45-degree boundary. POSITIVE
// is clockwise (the direction rotateClipCW turns), so the view applies the result
// by calling rotateClipCW that many times (a negative count rotates the other way,
// i.e. CCW). Pure + unit-tested.
export function angleToQuarterTurns(startAngle: number, currentAngle: number): number{
    return Math.round((currentAngle - startAngle) / (Math.PI / 2))
}

// The brush that corresponds to a cell's CURRENT content, for the eyedropper /
// PICK tool: a single tap reads the cell back into the active brush so the author
// can re-select "the thing already painted there" without guessing. A spawn WINS
// (a cell can never hold both a tile and a spawn, but if a spawn is present it is
// what the eyedropper picks); otherwise a painted tile resolves to the brush whose
// shape matches its palette entry (full -> "full", each diagonal -> its brush,
// deco -> "deco"); an empty cell picks "empty" (the eraser). It NEVER returns
// "auto": auto is resolved to a concrete shape at paint time, so a painted cell
// always holds a concrete shape, and picking it yields that concrete shape's
// brush. Pure + DOM-free so the view can call it from a pointer handler and it
// unit-tests cleanly. Reading does not mutate the map (no spawn toggle, no tile
// write), so a pick creates no undo step.
export function brushAtCell(map: EditorMap, col: number, row: number): EditorBrush{
    if(map.hasSpawn(col, row)) return "spawn"
    const value = map.tileAt(col, row)
    if(value <= 0) return "empty"
    const entry = map.palette[value - 1]
    if(typeof entry === "undefined") return "empty"
    // Every concrete tile shape shares its name with the brush that paints it
    // (full/diag_*/half_*/deco), so the palette entry's shape IS the picked brush.
    // TileShape is a subset of EditorBrush, so returning it stays type-safe.
    return entry.shape
}

// The MATERIAL (colour key) of a cell's CURRENT tile, for the eyedropper so a
// pick adopts BOTH shape (via brushAtCell) AND colour: pick a blue slope, keep
// painting blue slopes. Returns null when the cell has no colourable tile (empty,
// a spawn, an out-of-palette value, or a deco tile whose tile_hidden key is not a
// pickable material), so the caller leaves the active material untouched in those
// cases. Pure + DOM-free + does NOT mutate the map, so a pick creates no undo
// step.
export function materialAtCell(map: EditorMap, col: number, row: number): string | null{
    if(map.hasSpawn(col, row)) return null
    const value = map.tileAt(col, row)
    if(value <= 0) return null
    const entry = map.palette[value - 1]
    if(typeof entry === "undefined") return null
    // Deco's tile_hidden key is decoration, not a colourable material, so picking
    // a deco tile keeps the current material rather than adopting tile_hidden.
    if(entry.shape === "deco") return null
    return entry.key
}

// An undoable snapshot of the editor's CANVAS CONTENT: the full sparse tile map
// and every spawn, captured by value so a later mutation of the live EditorMap
// can never reach back and corrupt a stored snapshot. `tiles` is a flat list of
// [key, value] entries (a copy of the Map's contents) and `spawns` is a deep
// copy of the [col, row] pairs (fresh tuples, not shared references). The map
// NAME is intentionally NOT captured: it is a text field and is not undoable.
export type EditorSnapshot = {
    tiles: [string, number][],
    spawns: [number, number][],
}

// Capture the current canvas content of a map as a self-contained snapshot.
// Copies every tile entry and deep-copies every spawn pair, so the snapshot is
// fully detached from the live map.
export function snapshotEditorMap(map: EditorMap): EditorSnapshot{
    return {
        tiles: Array.from(map.tiles.entries()).map(([key, value]) => [key, value] as [string, number]),
        spawns: map.spawns.map(([col, row]) => [col, row] as [number, number]),
    }
}

// Restore a snapshot back onto a map, replacing its tiles and spawns in place.
// Rebuilds fresh containers (new Map, fresh tuples) so the map never shares
// references with the snapshot it was restored from; restoring the same snapshot
// twice therefore stays safe. The map name/palette/cellSize are left untouched
// (only canvas content is undoable).
export function restoreEditorSnapshot(map: EditorMap, snapshot: EditorSnapshot): void{
    map.tiles = new Map(snapshot.tiles.map(([key, value]) => [key, value] as [string, number]))
    map.spawns = snapshot.spawns.map(([col, row]) => [col, row] as [number, number])
}

// Are two snapshots equal in canvas content? Used to drop no-op strokes (a
// gesture that painted nothing different) so they never create an empty history
// entry. Compares tile entries order-independently (via a key->value lookup) and
// spawns by their set of coordinates.
export function snapshotsEqual(a: EditorSnapshot, b: EditorSnapshot): boolean{
    if(a.tiles.length !== b.tiles.length) return false
    if(a.spawns.length !== b.spawns.length) return false
    const aTiles = new Map(a.tiles)
    for(const [key, value] of b.tiles){
        if(aTiles.get(key) !== value) return false
    }
    const aSpawns = new Set(a.spawns.map(([c, r]) => cellKey(c, r)))
    for(const [c, r] of b.spawns){
        if(aSpawns.has(cellKey(c, r)) === false) return false
    }
    return true
}

// The default cap on how many UNDO steps the history keeps. Bounded so a long
// session on a huge map never grows memory without limit; the oldest step is
// dropped once the cap is exceeded.
export const DEFAULT_HISTORY_LIMIT = 100

// Aseprite-style UNDO / REDO for the editor canvas. PURE and DOM-free so it
// unit-tests cleanly: it stores past/future snapshots of the canvas content and
// applies them back onto a live EditorMap. The model holds the current state
// implicitly (the live map); the past stack holds states BEFORE each committed
// edit and the future stack holds states undone but not yet re-applied.
//
// One history entry = one paint GESTURE, not one cell. The view snapshots at
// pointer-DOWN (begin) and commits at pointer-UP (commit); a tap, a drag that
// painted 40 cells, an erase stroke, and a spawn toggle are each ONE step.
// Standard semantics: committing a new edit clears the redo (future) stack, and
// the past stack is bounded to `limit` (oldest dropped beyond the cap).
export class EditorHistory{
    // States BEFORE each committed edit, oldest first. undo() pops the newest.
    private past: EditorSnapshot[] = []
    // States that were undone, newest-undone last. redo() pops the newest.
    private future: EditorSnapshot[] = []
    // The snapshot taken at the start of the in-progress gesture, or null when no
    // gesture is open. Held so commit() can decide whether the gesture changed
    // anything before pushing it as one entry.
    private pending: EditorSnapshot | null = null
    private readonly limit: number

    constructor(limit: number = DEFAULT_HISTORY_LIMIT){
        // A sane floor so a non-positive limit never makes undo impossible.
        this.limit = limit > 0 ? Math.floor(limit) : 1
    }

    // Open a gesture: snapshot the map's CURRENT content (the state to return to
    // if this gesture is undone). Call at pointer-down (or before a one-shot
    // edit). A second begin() without a commit replaces the pending snapshot, so
    // an interrupted gesture never strands a stale baseline.
    begin(map: EditorMap): void{
        this.pending = snapshotEditorMap(map)
    }

    // Close the gesture opened by begin(): if the map's content actually changed,
    // push the pre-gesture snapshot onto the past stack as ONE undo step and clear
    // the redo stack (a new edit invalidates any undone future). A gesture that
    // changed nothing pushes no entry. Returns true when an entry was committed.
    commit(map: EditorMap): boolean{
        const before = this.pending
        this.pending = null
        if(before === null) return false
        const after = snapshotEditorMap(map)
        if(snapshotsEqual(before, after)) return false
        this.past.push(before)
        if(this.past.length > this.limit){
            // Drop the oldest entry so memory stays bounded on a long session.
            this.past.shift()
        }
        this.future = []
        return true
    }

    // Drop any in-progress gesture without committing it (e.g. a cancelled
    // pointer interaction). The map is left as-is; no history entry is created.
    cancel(): void{
        this.pending = null
    }

    canUndo(): boolean{
        return this.past.length > 0
    }

    canRedo(): boolean{
        return this.future.length > 0
    }

    // Undo the most recent committed edit: snapshot the CURRENT state onto the
    // future (redo) stack, then restore the previous state onto the map. Returns
    // true when something was undone. Any in-progress gesture is dropped first so
    // undo never races a half-open stroke.
    undo(map: EditorMap): boolean{
        this.pending = null
        const previous = this.past.pop()
        if(typeof previous === "undefined") return false
        this.future.push(snapshotEditorMap(map))
        restoreEditorSnapshot(map, previous)
        return true
    }

    // Redo the most recently undone edit: snapshot the CURRENT state back onto the
    // past (undo) stack, then re-apply the undone state onto the map. Returns true
    // when something was redone.
    redo(map: EditorMap): boolean{
        this.pending = null
        const next = this.future.pop()
        if(typeof next === "undefined") return false
        this.past.push(snapshotEditorMap(map))
        restoreEditorSnapshot(map, next)
        return true
    }

    // Forget all history (used when the editor loads a fresh/imported map, so the
    // restored baseline is the new starting point rather than something undoable
    // back into the previous map).
    reset(): void{
        this.past = []
        this.future = []
        this.pending = null
    }
}

// The "palette index + 1" tiles value for a shape brush. The editor palette is
// fixed and shares its order with EditorMap.palette, so a brush's value is just
// its position in EDITOR_PALETTE plus one. Throws for non-shape brushes
// (empty/spawn) which never write a palette value.
export function paletteValueForBrush(brush: EditorBrush): number{
    const index = EDITOR_PALETTE.findIndex((entry) => entry.brush === brush)
    if(index === -1){
        throw new Error(`brush "${brush}" has no palette entry`)
    }
    return index + 1
}

// The "palette index + 1" tiles value for a concrete shape. The auto-slope tool
// resolves a cell to a TileShape (full or a diagonal) and writes it via this.
export function paletteValueForShape(shape: TileShape): number{
    const index = EDITOR_PALETTE.findIndex((entry) => entry.shape === shape)
    if(index === -1){
        throw new Error(`shape "${shape}" has no palette entry`)
    }
    return index + 1
}

// Parse an untrusted JSON string into a GridMapData, or throw a friendly error.
// Used by the view's "import" path (drag a previously exported file back in).
// We only assert the load-bearing fields exist and have the right primitive
// types; fromGridMapData then normalises everything else.
export function parseGridMapData(raw: string): GridMapData{
    let parsed: unknown
    try{
        parsed = JSON.parse(raw)
    } catch(e){
        throw new Error("File is not valid JSON")
    }
    if(typeof parsed !== "object" || parsed === null){
        throw new Error("File is not a map object")
    }
    const obj = parsed as Record<string, unknown>
    if(typeof obj.cols !== "number" || typeof obj.rows !== "number"){
        throw new Error("Map is missing cols/rows")
    }
    if(Array.isArray(obj.tiles) === false){
        throw new Error("Map is missing tiles")
    }
    return parsed as GridMapData
}

// Serialize a GridMapData to a pretty JSON string for download. Pretty-printed
// (2-space) so a curious author can read the file; loadGridMap does not care
// about whitespace.
export function serializeGridMapData(data: GridMapData): string{
    return JSON.stringify(data, null, 2)
}

// The localStorage key the editor autosaves its in-progress map under. A single
// slot: the editor restores whatever was last worked on so a reload or crash
// never loses progress. Kept here so the key is shared by save/load and tests.
export const EDITOR_STORAGE_KEY = "pip-pip:map-editor:draft"

// The minimal storage surface saveEditorMap/loadEditorMap need. window
// .localStorage satisfies it, and a test can pass a tiny fake object, so the
// persistence logic stays pure and unit-testable (no real DOM, no globals).
export interface EditorStorage{
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

// Persist a map's GridMapData to storage as JSON under EDITOR_STORAGE_KEY.
// Swallows quota/serialisation errors so a failed autosave never interrupts
// painting; the in-memory map is still the source of truth.
export function saveEditorMap(map: EditorMap, storage: EditorStorage): void{
    try{
        storage.setItem(EDITOR_STORAGE_KEY, serializeGridMapData(map.toGridMapData()))
    } catch(e){
        // Storage may be full or disabled (private mode); autosave is best-effort.
    }
}

// Restore a previously autosaved map from storage, or null when there is no
// saved draft or it is corrupt. Reuses the same parse + normalise path as
// import, so a partial/hand-edited draft still loads instead of throwing.
export function loadEditorMap(storage: EditorStorage): EditorMap | null{
    let raw: string | null
    try{
        raw = storage.getItem(EDITOR_STORAGE_KEY)
    } catch(e){
        return null
    }
    if(raw === null || raw.length === 0) return null
    try{
        return EditorMap.fromGridMapData(parseGridMapData(raw))
    } catch(e){
        return null
    }
}

// Forget the autosaved draft (used by "New"/"Clear to fresh") so the next mount
// starts from a blank map instead of restoring the cleared one.
export function clearEditorMap(storage: EditorStorage): void{
    try{
        storage.removeItem(EDITOR_STORAGE_KEY)
    } catch(e){
        // Best-effort: nothing to do if storage is unavailable.
    }
}

// The localStorage key the editor->play handoff uses. SEPARATE from the autosave
// draft: "Play this map" stashes the current exported GridMapData here and routes
// home, where MapSelect (host-only) offers a button to load it into the live
// match. A single stable slot, so only the most recent "Play this map" is queued.
export const PLAY_MAP_STORAGE_KEY = "pip-pip:play-map"

// Stash a map's GridMapData for the editor->play handoff. Swallows storage errors
// (quota / private mode) so a failed stash never blocks navigation; the worst
// case is MapSelect simply not surfacing the button.
export function stashPlayMap(data: GridMapData, storage: EditorStorage): void{
    try{
        storage.setItem(PLAY_MAP_STORAGE_KEY, serializeGridMapData(data))
    } catch(e){
        // Best-effort: nothing to do if storage is unavailable.
    }
}

// Read the stashed play-map, or null when none is queued or it is corrupt. Reuses
// the import parse path (same minimal field assertions) so a hand-edited stash
// still loads instead of throwing. MapSelect calls this to decide whether to show
// the "Use editor map" button and what name to label it with.
export function loadPlayMap(storage: EditorStorage): GridMapData | null{
    let raw: string | null
    try{
        raw = storage.getItem(PLAY_MAP_STORAGE_KEY)
    } catch(e){
        return null
    }
    if(raw === null || raw.length === 0) return null
    try{
        return parseGridMapData(raw)
    } catch(e){
        return null
    }
}

// Drop the stashed play-map. MapSelect clears it after a successful load so the
// button does not linger once the map is in the match (the host can re-stash from
// the editor any time).
export function clearPlayMap(storage: EditorStorage): void{
    try{
        storage.removeItem(PLAY_MAP_STORAGE_KEY)
    } catch(e){
        // Best-effort: nothing to do if storage is unavailable.
    }
}

// A filesystem-safe download filename derived from the map name, e.g.
// "My Map!" -> "my-map.map.json". Falls back to a default stem when the name
// has no usable characters.
export function mapFileName(name: string): string{
    const stem = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    const safe = stem.length > 0 ? stem : "map"
    return `${safe}.map.json`
}
