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
