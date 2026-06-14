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
} from "@pip-pip/game/src/logic/grid-map"
import { TILE_SIZE } from "@pip-pip/game/src/logic/constants"

// A brush is what a single click/drag paints. "empty" erases (clears a cell).
// Every other brush writes a tile of the named shape; "spawn" is special-cased:
// it does not write a tile but toggles a spawn marker at the cell. Keeping spawn
// in the same brush enum lets the palette UI present one uniform list of
// paintable things.
export type EditorBrush = "empty" | "full" | "auto" | "diag_tl" | "diag_tr" | "diag_bl" | "diag_br" | "deco" | "spawn"

// The four explicit slope directions, tucked under the Auto slope tool.
export const SLOPE_BRUSHES: EditorBrush[] = ["diag_tl", "diag_tr", "diag_bl", "diag_br"]

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

// The fixed editor palette. The editor authors with a SINGLE shared texture key
// per shape (the renderer's defaults), so the exported palette is small and
// every painted cell of a given shape shares one palette entry. Order here is
// also the order the palette buttons render in.
export const EDITOR_PALETTE: { brush: EditorBrush, shape: TileShape, key: string, label: string }[] = [
    { brush: "full", shape: "full", key: "tile_default", label: "Block" },
    { brush: "diag_tl", shape: "diag_tl", key: "tile_default", label: "Slope TL" },
    { brush: "diag_tr", shape: "diag_tr", key: "tile_default", label: "Slope TR" },
    { brush: "diag_bl", shape: "diag_bl", key: "tile_default", label: "Slope BL" },
    { brush: "diag_br", shape: "diag_br", key: "tile_default", label: "Slope BR" },
    { brush: "deco", shape: "deco", key: "tile_hidden", label: "Deco" },
]

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

    // Is the cell a FULL (square wall) tile? The auto-slope tool reads which
    // orthogonal neighbours are walls to choose the slope direction.
    isFull(col: number, row: number): boolean{
        const value = this.tileAt(col, row)
        if(value <= 0) return false
        const entry = this.palette[value - 1]
        return typeof entry !== "undefined" && entry.shape === "full"
    }

    // The shape the AUTO brush paints at a cell, derived from its full neighbours.
    autoShapeAt(col: number, row: number): TileShape{
        return autoSlopeShape(
            this.isFull(col, row - 1),
            this.isFull(col + 1, row),
            this.isFull(col, row + 1),
            this.isFull(col - 1, row),
        )
    }

    // Paint one brush into one cell at ANY coordinate. "empty" erases the tile,
    // every shape brush writes that shape's palette value, and "spawn" toggles a
    // spawn marker. A cell can NEVER hold both a tile and a spawn: painting a
    // tile onto a cell that has a spawn removes the spawn, and toggling a spawn
    // onto a cell that has a tile removes the tile. Returns true when something
    // actually changed, so the view can skip redundant redraws while dragging.
    setCell(col: number, row: number, brush: EditorBrush): boolean{
        if(brush === "spawn"){
            return this.toggleSpawn(col, row)
        }

        const key = cellKey(col, row)
        if(brush === "empty"){
            if(this.tiles.has(key) === false) return false
            this.tiles.delete(key)
            return true
        }

        let next: number
        if(brush === "auto"){
            // Auto slope resolves to a concrete shape from the cell's neighbours.
            next = paletteValueForShape(this.autoShapeAt(col, row))
        } else{
            next = paletteValueForBrush(brush)
        }
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
    // (full/diag_*/deco), so the palette entry's shape IS the picked brush.
    return entry.shape
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
