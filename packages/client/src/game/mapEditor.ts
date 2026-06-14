// Pure, dependency-free model for the homepage MAP EDITOR. Everything here is
// framework-agnostic and DOM-free so it unit-tests cleanly (see
// tests/client/mapEditor.test.ts): the mutable grid model, painting a single
// brush into a cell, resizing the grid, and round-tripping to/from the
// GridMapData shape that @pip-pip/game/src/logic/grid-map.ts -> loadGridMap
// consumes. The React view (views/MapEditor.tsx) only renders this model and
// wires pointer events to setCell; it owns no map logic of its own.

import {
    GridMapData,
    TileShape,
    TilePaletteEntry,
} from "@pip-pip/game/src/logic/grid-map"
import { TILE_SIZE } from "@pip-pip/game/src/logic/constants"

// A brush is what a single click/drag paints. "empty" erases (writes 0). Every
// other brush writes a tile of the named shape; "spawn" is special-cased: it
// does not write into the tiles array at all but toggles a spawn marker at the
// cell. Keeping spawn in the same brush enum lets the palette UI present one
// uniform list of paintable things.
export type EditorBrush = "empty" | "full" | "diag_tl" | "diag_tr" | "diag_bl" | "diag_br" | "deco" | "spawn"

// Single-key keyboard shortcut for every tool, Aseprite-style: one letter
// selects one brush. Lower-cased keys map to brushes; the four slopes share the
// "Q W A S" cluster so they sit under the home row like a corner pad (top-left,
// top-right, bottom-left, bottom-right). Kept here (DOM-free) so the
// shortcut-key -> brush mapping is unit-testable without rendering the view.
export const BRUSH_SHORTCUTS: Record<string, EditorBrush> = {
    e: "empty",
    b: "full",
    d: "deco",
    g: "spawn",
    q: "diag_tl",
    w: "diag_tr",
    a: "diag_bl",
    s: "diag_br",
}

// Resolve a raw KeyboardEvent.key into the brush it selects, or null when the
// key is not a tool shortcut. Case-insensitive so Shift does not break it.
export function brushForKey(key: string): EditorBrush | null{
    const brush = BRUSH_SHORTCUTS[key.toLowerCase()]
    return typeof brush === "undefined" ? null : brush
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

// Editor-side bounds for the grid dimensions. The view clamps name/size inputs
// to these so a player cannot author a degenerate or absurdly large grid that
// would choke the live preview. Kept here (not in the view) so the clamp is
// testable.
export const MIN_GRID = 4
export const MAX_GRID = 64
export const DEFAULT_COLS = 24
export const DEFAULT_ROWS = 16
export const DEFAULT_MAP_NAME = "My Map"

// The editor's own working state. `tiles` is the SAME flat row-major "palette
// index + 1" encoding the on-disk GridMapData uses (0 empty, n>=1 references
// palette[n-1]), so serialize is almost a straight copy. `spawns` is a list of
// [col, row] cells. Held as a class so the view can mutate in place and re-read
// without rebuilding the whole grid each paint.
export class EditorMap{
    name: string
    cellSize: number
    cols: number
    rows: number
    tiles: number[]
    spawns: [number, number][]
    palette: TilePaletteEntry[]

    constructor(
        cols = DEFAULT_COLS,
        rows = DEFAULT_ROWS,
        name = DEFAULT_MAP_NAME,
        cellSize = TILE_SIZE,
    ){
        this.cols = clampGrid(cols)
        this.rows = clampGrid(rows)
        this.name = name
        this.cellSize = cellSize
        this.tiles = new Array(this.cols * this.rows).fill(0)
        this.spawns = []
        // Build a stable palette from the fixed editor palette so every shape
        // has a known index for the "index + 1" encoding. Index i here maps to
        // tiles value i + 1.
        this.palette = EDITOR_PALETTE.map((entry) => ({ key: entry.key, shape: entry.shape }))
    }

    // Is (col, row) inside the grid? Painting/erasing out of range is a no-op.
    inBounds(col: number, row: number): boolean{
        return col >= 0 && col < this.cols && row >= 0 && row < this.rows
    }

    // Flat index of a cell. Caller must have checked inBounds.
    index(col: number, row: number): number{
        return row * this.cols + col
    }

    // The tiles value (0 = empty, n>=1 = palette[n-1]) at a cell, or 0 if out of
    // range.
    tileAt(col: number, row: number): number{
        if(this.inBounds(col, row) === false) return 0
        return this.tiles[this.index(col, row)] ?? 0
    }

    // Is there a spawn marker on this cell?
    hasSpawn(col: number, row: number): boolean{
        return this.spawns.some(([c, r]) => c === col && r === row)
    }

    // Paint one brush into one cell. "empty" erases the tile, every shape brush
    // writes that shape's palette value, and "spawn" toggles a spawn marker
    // (leaving the tile untouched). Returns true when something actually
    // changed, so the view can skip redundant redraws while dragging.
    setCell(col: number, row: number, brush: EditorBrush): boolean{
        if(this.inBounds(col, row) === false) return false

        if(brush === "spawn"){
            return this.toggleSpawn(col, row)
        }

        const i = this.index(col, row)
        const next = brush === "empty" ? 0 : paletteValueForBrush(brush)
        if(this.tiles[i] === next) return false
        this.tiles[i] = next
        return true
    }

    // Add a spawn marker at a cell, or remove it if one is already there. A
    // spawn and a tile can coexist on a cell, matching loadGridMap (it reads
    // spawns and tiles independently).
    toggleSpawn(col: number, row: number): boolean{
        if(this.inBounds(col, row) === false) return false
        const existing = this.spawns.findIndex(([c, r]) => c === col && r === row)
        if(existing === -1){
            this.spawns.push([col, row])
        } else {
            this.spawns.splice(existing, 1)
        }
        return true
    }

    // Clear every tile and spawn, keeping size/name/palette. Used by the view's
    // "Clear" action.
    clear(){
        this.tiles = new Array(this.cols * this.rows).fill(0)
        this.spawns = []
    }

    // Resize the grid, preserving any cell that still fits inside the new
    // bounds. Spawns outside the new bounds are dropped. Both dimensions are
    // clamped to [MIN_GRID, MAX_GRID]. Mutates in place.
    resize(cols: number, rows: number){
        const nextCols = clampGrid(cols)
        const nextRows = clampGrid(rows)
        const next = new Array(nextCols * nextRows).fill(0)
        const copyCols = Math.min(this.cols, nextCols)
        const copyRows = Math.min(this.rows, nextRows)
        for(let row = 0; row < copyRows; row++){
            for(let col = 0; col < copyCols; col++){
                next[row * nextCols + col] = this.tiles[row * this.cols + col] ?? 0
            }
        }
        this.tiles = next
        this.spawns = this.spawns.filter(([c, r]) => c < nextCols && r < nextRows)
        this.cols = nextCols
        this.rows = nextRows
    }

    // Serialize to the exact GridMapData shape loadGridMap consumes. The tiles
    // array is copied so later edits don't mutate an exported object, and the
    // map name is trimmed (falling back to a default) so the export always
    // carries a usable name.
    toGridMapData(): GridMapData{
        return {
            name: this.name.trim().length > 0 ? this.name.trim() : DEFAULT_MAP_NAME,
            cellSize: this.cellSize,
            cols: this.cols,
            rows: this.rows,
            tiles: this.tiles.slice(),
            spawns: this.spawns.map(([c, r]) => [c, r] as [number, number]),
            palette: this.palette.map((entry) => ({ key: entry.key, shape: entry.shape })),
        }
    }

    // Rebuild an EditorMap from a GridMapData (e.g. an imported JSON). Anything
    // missing or malformed is coerced to a sane value so a hand-edited or
    // partial file still loads instead of throwing. The tiles array is length-
    // normalised to cols*rows (truncated or zero-padded) so the grid is always
    // consistent.
    static fromGridMapData(data: GridMapData): EditorMap{
        const cols = clampGrid(Math.floor(data.cols))
        const rows = clampGrid(Math.floor(data.rows))
        const name = typeof data.name === "string" && data.name.length > 0 ? data.name : DEFAULT_MAP_NAME
        const cellSize = typeof data.cellSize === "number" && data.cellSize > 0 ? data.cellSize : TILE_SIZE

        const map = new EditorMap(cols, rows, name, cellSize)

        // Prefer the file's palette when present so imported values keep their
        // meaning; otherwise the constructor's editor palette is used.
        if(Array.isArray(data.palette) && data.palette.length > 0){
            map.palette = data.palette.map((entry) => ({ key: entry.key, shape: entry.shape }))
        }

        const size = cols * rows
        const tiles = new Array(size).fill(0)
        if(Array.isArray(data.tiles)){
            for(let i = 0; i < size; i++){
                const value = data.tiles[i]
                tiles[i] = typeof value === "number" && value > 0 ? Math.floor(value) : 0
            }
        }
        map.tiles = tiles

        if(Array.isArray(data.spawns)){
            map.spawns = data.spawns
                .filter((pair) => Array.isArray(pair) && pair.length === 2)
                .map(([c, r]) => [Math.floor(c), Math.floor(r)] as [number, number])
                .filter(([c, r]) => c >= 0 && c < cols && r >= 0 && r < rows)
        }

        return map
    }
}

// Clamp a requested grid dimension into the editor's allowed range, flooring
// fractional values. Used by the constructor, resize, and the view's inputs.
export function clampGrid(value: number): number{
    if(Number.isFinite(value) === false) return MIN_GRID
    const floored = Math.floor(value)
    if(floored < MIN_GRID) return MIN_GRID
    if(floored > MAX_GRID) return MAX_GRID
    return floored
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
