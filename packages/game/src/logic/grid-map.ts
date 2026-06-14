import { PointPhysicsRectWall, PointPhysicsSegmentWall } from "@pip-pip/core/src/physics"
import { TILE_SIZE, SPAWN_DIAMETER } from "@pip-pip/game/src/logic/constants"
import { PipGameMap, PipGameTile, PointRadius, PIP_MAP_DEFAULT_BOUNDS } from "@pip-pip/game/src/logic/map"

// GRID MAP ENGINE (Phase 1): a compact, scalable map format plus a loader that
// turns it into the SAME PipGameMap wall arrays the rest of the game already
// consumes (rectWalls / segWalls / spawns / tiles). No rendering or editor work
// lives here - this phase is purely the data model, the loader (greedy mesh for
// full tiles, diagonal segWalls for half tiles), and a converter from the legacy
// wall_tiles/wall_segments format so every existing map keeps playing exactly as
// before. See map.ts for the legacy JSONPipGameMap it sits beside.

// The shape a palette entry can take.
// - "full": fills the whole cell and contributes a rect wall (greedy-meshed).
// - "diag_*": a 45-degree half-tile whose right angle sits in the named corner
//   (tl = top-left, tr = top-right, bl = bottom-left, br = bottom-right). The
//   hypotenuse of that triangle is the surface a ship glides along, so a run of
//   diagonals reads as one smooth slope instead of a catching staircase.
// - "deco": renders a tile but contributes NO collision of its own. The
//   migration uses it for legacy wall tiles whose collision is already carried
//   by explicit `segments`, so the converted map keeps the exact same walls.
export type TileShape = "full" | "diag_tl" | "diag_tr" | "diag_bl" | "diag_br" | "deco"

// A palette entry pairs a material/texture key (used later for rendering) with a
// collision shape. Maps reference palette entries by index, so a big map only
// stores small integers per cell, not a string per cell.
export type TilePaletteEntry = {
    key: string,
    shape: TileShape,
}

// An explicit segment wall in CELL coordinates [startCol, startRow, endCol,
// endRow]. The loader scales each component by cellSize and emits a
// PointPhysicsSegmentWall with radius cellSize/2, reproducing the legacy
// wall_segments verbatim. This is how the migration carries an existing map's
// authored collision through unchanged; new hand-authored maps can lean on full
// + diagonal tiles instead and may leave `segments` empty.
export type GridSegment = [number, number, number, number]

// The on-disk / in-memory grid map. `tiles` is a flat row-major array of length
// cols*rows: 0 means empty, and any value n >= 1 references palette[n - 1]. This
// "palette index + 1" encoding keeps the common empty cell as a plain 0 so large
// sparse maps compress well. `spawns` are [col, row] cell coordinates.
// `segments` (optional) are explicit cell-space segment walls, used by the
// migration to preserve legacy collision exactly.
export type GridMapData = {
    name: string,
    cellSize: number,
    cols: number,
    rows: number,
    tiles: number[],
    spawns: [number, number][],
    palette: TilePaletteEntry[],
    segments?: GridSegment[],
    // Optional cell-space origin: cell (col, row) loads at world position
    // ((col + originCol) * cellSize, (row + originRow) * cellSize). The migration
    // sets these to the legacy map's min tile coords so converted maps sit at the
    // EXACT world position they always did. Hand-authored (editor) maps omit them
    // and default to 0.
    originCol?: number,
    originRow?: number,
}

// The diagonal palette shapes, for quick membership tests.
const DIAGONAL_SHAPES: TileShape[] = ["diag_tl", "diag_tr", "diag_bl", "diag_br"]

export function isDiagonalShape(shape: TileShape): boolean{
    return DIAGONAL_SHAPES.indexOf(shape) !== -1
}

// Resolve a flat-array cell value to its palette entry, or undefined for empty
// (0) and out-of-palette indices. Centralised so the loader and any consumer
// read the "index + 1" encoding the same way.
export function paletteEntryAt(data: GridMapData, value: number): TilePaletteEntry | undefined{
    if(value <= 0) return undefined
    const entry = data.palette[value - 1]
    if(typeof entry === "undefined") return undefined
    return entry
}

// Read the flat tiles array at (col, row) with bounds checking; out-of-range is
// treated as empty (0).
export function tileAt(data: GridMapData, col: number, row: number): number{
    if(col < 0 || col >= data.cols) return 0
    if(row < 0 || row >= data.rows) return 0
    return data.tiles[row * data.cols + col] ?? 0
}

// A merged rectangle of full tiles, in CELL coordinates (col/row top-left plus a
// width/height in cells). Produced by greedyMeshFullTiles and turned into one
// PointPhysicsRectWall each by the loader, so a long wall becomes a single wall
// instead of one-per-tile.
export type GridRect = {
    col: number,
    row: number,
    width: number,
    height: number,
}

// Is this cell a FULL (square) tile? Diagonals and empties are not merged into
// rect walls - only solid squares can be losslessly covered by axis-aligned
// rectangles.
function isFullCell(data: GridMapData, col: number, row: number): boolean{
    const entry = paletteEntryAt(data, tileAt(data, col, row))
    if(typeof entry === "undefined") return false
    return entry.shape === "full"
}

// GREEDY MESH: cover every full tile with as few axis-aligned rectangles as
// possible. We grow each rectangle right along a row as far as the run of unused
// full tiles continues, then grow it DOWN as long as every cell in the candidate
// row below is also full and unused. The result is a small set of large rects
// that EXACTLY tiles the full-cell set with no gaps and no overlaps (asserted in
// tests). This is the key scale win: a 100-cell wall slab becomes one rect, not
// 100. Pure: depends only on the grid data.
export function greedyMeshFullTiles(data: GridMapData): GridRect[]{
    const used: boolean[] = new Array(data.cols * data.rows).fill(false)
    const rects: GridRect[] = []

    const index = (col: number, row: number) => row * data.cols + col

    for(let row = 0; row < data.rows; row++){
        for(let col = 0; col < data.cols; col++){
            if(used[index(col, row)]) continue
            if(isFullCell(data, col, row) === false) continue

            // Grow right while the next cell is an unused full tile.
            let width = 1
            while(
                col + width < data.cols &&
                used[index(col + width, row)] === false &&
                isFullCell(data, col + width, row)
            ){
                width++
            }

            // Grow down while EVERY cell in the next row across [col, col+width)
            // is an unused full tile. The moment a row cannot fully extend, stop.
            let height = 1
            while(row + height < data.rows){
                let rowFits = true
                for(let c = col; c < col + width; c++){
                    if(used[index(c, row + height)] || isFullCell(data, c, row + height) === false){
                        rowFits = false
                        break
                    }
                }
                if(rowFits === false) break
                height++
            }

            // Claim the whole block so it is not visited again.
            for(let r = row; r < row + height; r++){
                for(let c = col; c < col + width; c++){
                    used[index(c, r)] = true
                }
            }

            rects.push({ col, row, width, height })
        }
    }

    return rects
}

// The world-space diagonal segment (the hypotenuse) for a diagonal tile at
// (col, row). The right angle sits in the named corner; the hypotenuse runs
// between the two OTHER corners of the cell. Coordinates are cell CENTRES *
// cellSize, matching how the legacy loader scales tiles (tile (c,r) centres at
// c*cellSize, r*cellSize), so the new engine lines up with existing geometry.
export function diagonalSegmentEndpoints(
    shape: TileShape,
    col: number,
    row: number,
    cellSize: number,
): { startX: number, startY: number, endX: number, endY: number } | undefined{
    if(isDiagonalShape(shape) === false) return undefined

    // The four cell corners in world space. The cell at (col,row) is centred on
    // (col*cellSize, row*cellSize), so its corners sit half a cell out.
    const half = cellSize / 2
    const cx = col * cellSize
    const cy = row * cellSize
    const left = cx - half
    const right = cx + half
    const top = cy - half
    const bottom = cy + half

    // For each filled corner, the hypotenuse joins the two adjacent corners.
    // diag_tl fills the top-left corner -> hypotenuse from top-right to bottom-left.
    if(shape === "diag_tl") return { startX: right, startY: top, endX: left, endY: bottom }
    // diag_tr fills the top-right corner -> hypotenuse from top-left to bottom-right.
    if(shape === "diag_tr") return { startX: left, startY: top, endX: right, endY: bottom }
    // diag_bl fills the bottom-left corner -> hypotenuse from top-left to bottom-right.
    if(shape === "diag_bl") return { startX: left, startY: top, endX: right, endY: bottom }
    // diag_br fills the bottom-right corner -> hypotenuse from top-right to bottom-left.
    return { startX: right, startY: top, endX: left, endY: bottom }
}

// A loaded grid map: a PipGameMap (so it drops straight into setMap, the
// renderer, pathfinding, etc) plus the source data it was built from for
// debugging / later phases.
export class GridPipGameMap extends PipGameMap{
    source: GridMapData

    constructor(id: string, source: GridMapData){
        super(id)
        this.source = source

        const cellSize = source.cellSize

        // World-origin offset (world units). Migrated maps carry their original
        // (possibly negative) cell origin so the loaded map sits at the EXACT same
        // world coordinates the legacy loader produced: the migration is then a
        // true positional no-op, so a client running an older map build still
        // agrees with the server on where walls + spawns are (avoiding ships that
        // look like they spawned outside the map). New hand-authored maps omit it
        // and default to 0.
        const ox = (source.originCol ?? 0) * cellSize
        const oy = (source.originRow ?? 0) * cellSize

        let minX = Infinity
        let maxX = -Infinity
        let minY = Infinity
        let maxY = -Infinity

        const compare = (x: number, y: number) => {
            if(x < minX) minX = x
            if(x > maxX) maxX = x
            if(y < minY) minY = y
            if(y > maxY) maxY = y
        }

        // SPAWNS: cell coordinates -> world spawn points (mirrors the legacy
        // loader, which scales tile coords by TILE_SIZE and uses SPAWN_DIAMETER).
        for(const [col, row] of source.spawns){
            const x = col * cellSize + ox
            const y = row * cellSize + oy
            this.spawns.push(new PointRadius(x, y, SPAWN_DIAMETER / 2))
            compare(x, y)
        }

        // FULL TILES: greedy-mesh into a few large rect walls. Each merged rect
        // spans cells [col, col+width) x [row, row+height); its world centre and
        // size follow from the cell centres at the block's corners.
        const rects = greedyMeshFullTiles(source)
        for(const rect of rects){
            const wall = new PointPhysicsRectWall()
            // Cell (c,r) is centred on (c*cellSize, r*cellSize). The block spans
            // columns [col, col+width-1]; its centre column is col + (width-1)/2.
            wall.center.x = (rect.col + (rect.width - 1) / 2) * cellSize + ox
            wall.center.y = (rect.row + (rect.height - 1) / 2) * cellSize + oy
            wall.width = rect.width * cellSize
            wall.height = rect.height * cellSize
            this.rectWalls.push(wall)
            compare(wall.center.x - wall.width / 2, wall.center.y - wall.height / 2)
            compare(wall.center.x + wall.width / 2, wall.center.y + wall.height / 2)
        }

        // Emit tiles for rendering + diagonal segWalls for collision/nav. We walk
        // every non-empty cell: full tiles already became rect walls but still
        // need a render tile; diagonal tiles need a render tile AND a segWall.
        for(let row = 0; row < source.rows; row++){
            for(let col = 0; col < source.cols; col++){
                const value = tileAt(source, col, row)
                const entry = paletteEntryAt(source, value)
                if(typeof entry === "undefined") continue

                const x = col * cellSize + ox
                const y = row * cellSize + oy
                // Carry the palette SHAPE and block key onto the render tile so
                // the renderer can draw a slope as a triangle (matching its
                // segWall) and vary block styling. texture stays the key for the
                // legacy sprite path; block is the same key, kept separate so a
                // later phase can split material from texture without churn.
                const tile: PipGameTile = {
                    x, y,
                    texture: entry.key,
                    shape: entry.shape,
                    block: entry.key,
                }
                this.tiles.push(tile)
                compare(x, y)

                if(isDiagonalShape(entry.shape)){
                    const ends = diagonalSegmentEndpoints(entry.shape, col, row, cellSize)
                    if(typeof ends !== "undefined"){
                        const seg = new PointPhysicsSegmentWall(
                            undefined,
                            ends.startX + ox, ends.startY + oy, ends.endX + ox, ends.endY + oy,
                        )
                        // Match the legacy seg radius so diagonals collide with the
                        // same half-tile thickness the old segment walls used.
                        seg.radius = cellSize / 2
                        // Diagonals resist along their SPAN only (no rounded
                        // endcap). The capsule endcap otherwise pokes radius
                        // (= cellSize/2) past each tip, an invisible bump where a
                        // diagonal meets a flat wall or another diagonal that
                        // catches ships and wedges bots. The span itself is still
                        // a solid barrier, so the slope face stays impassable; in
                        // the common chamfer case the adjacent full tiles' rect
                        // walls seal the tip. Only the legacy/explicit straight
                        // `segments` below keep the default capped behaviour, so
                        // migrated maps are completely unchanged.
                        seg.cappedEnds = false
                        this.segWalls.push(seg)
                        compare(ends.startX + ox, ends.startY + oy)
                        compare(ends.endX + ox, ends.endY + oy)
                    }
                }
            }
        }

        // EXPLICIT SEGMENTS: emit each cell-space segment verbatim. The migration
        // uses these to reproduce the legacy wall_segments (each with radius
        // cellSize/2) so a converted map collides exactly as it did before.
        if(typeof source.segments !== "undefined"){
            for(const [sc, sr, ec, er] of source.segments){
                const seg = new PointPhysicsSegmentWall(
                    undefined,
                    sc * cellSize + ox, sr * cellSize + oy, ec * cellSize + ox, er * cellSize + oy,
                )
                seg.radius = cellSize / 2
                this.segWalls.push(seg)
                compare(sc * cellSize + ox, sr * cellSize + oy)
                compare(ec * cellSize + ox, er * cellSize + oy)
            }
        }

        // Same empty-map fallback as the legacy loader: an all-empty grid leaves
        // the extents inverted, so clamp to a sane default box centred on origin.
        if(minX > maxX || minY > maxY){
            minX = -PIP_MAP_DEFAULT_BOUNDS
            minY = -PIP_MAP_DEFAULT_BOUNDS
            maxX = PIP_MAP_DEFAULT_BOUNDS
            maxY = PIP_MAP_DEFAULT_BOUNDS
        }

        this.bounds.min.x = minX - cellSize / 2
        this.bounds.max.x = maxX + cellSize / 2
        this.bounds.min.y = minY - cellSize / 2
        this.bounds.max.y = maxY + cellSize / 2
    }
}

// Build a GridPipGameMap from grid data. Thin alias so call sites read as a
// loader, mirroring `new JSONPipGameMap(...)` for the legacy format.
export function loadGridMap(id: string, source: GridMapData): GridPipGameMap{
    return new GridPipGameMap(id, source)
}

// The texture key the renderer expects for a solid wall tile. The legacy loader
// tagged tiles that also carried a wall segment as "tile_default" and the rest
// as "tile_hidden"; the converter preserves that distinction via the palette.
export const GRID_TILE_DEFAULT_KEY = "tile_default"
export const GRID_TILE_HIDDEN_KEY = "tile_hidden"

// Reference TILE_SIZE so a converter that omits an explicit cell size has the
// engine default to the same world scale the legacy maps used.
export const GRID_DEFAULT_CELL_SIZE = TILE_SIZE

// HARD CAP on cols*rows for a CUSTOM (uploaded / editor) map. The loader builds
// one render tile per non-empty cell, greedy-meshes rect walls and walks every
// cell, and the renderer draws each tile, so an enormous grid could exhaust
// physics/render memory and CPU on every client. 250*250 = 62500 cells is far
// larger than any hand-authored map yet bounds a hostile or accidental giant
// upload to a sane ceiling. Shared so logic, the wire and the UI agree on it.
export const MAX_CUSTOM_CELLS = 250 * 250

// The valid palette shapes, for a defensive membership test in the validator.
const VALID_TILE_SHAPES: TileShape[] = ["full", "diag_tl", "diag_tr", "diag_bl", "diag_br", "deco"]

// True for a finite integer (rejects NaN, Infinity and fractional values).
function isInteger(value: unknown): value is number{
    return typeof value === "number" && Number.isFinite(value) && Math.floor(value) === value
}

// Validate an UNTRUSTED value as GridMapData. Returns the value typed as
// GridMapData when every field is well-formed, or null on ANY failure (never
// throws on bad input - callers treat null as "ignore this upload"). This is the
// single gate every custom-map source passes through: the editor upload control,
// the host->server customMap packet and the server itself all run it, so a
// malformed or oversized map can never reach loadGridMap / the physics world.
//
// Checks: name is a string; cellSize is a positive finite number; cols/rows are
// positive integers; tiles is a number[] of length EXACTLY cols*rows with each
// entry a finite int >= 0; spawns is an array of [col,row] integer pairs; palette
// is an array of {key:string, shape:valid}; optional originCol/originRow are
// integers and optional segments are 4-int tuples. cols*rows is capped at
// MAX_CUSTOM_CELLS so an enormous grid cannot exhaust physics/render.
export function validateGridMapData(x: unknown): GridMapData | null{
    if(typeof x !== "object" || x === null) return null
    const data = x as Record<string, unknown>

    if(typeof data.name !== "string") return null

    if(typeof data.cellSize !== "number" || !Number.isFinite(data.cellSize) || data.cellSize <= 0) return null

    if(!isInteger(data.cols) || data.cols <= 0) return null
    if(!isInteger(data.rows) || data.rows <= 0) return null

    // Cap the cell count BEFORE walking tiles so a hostile cols*rows can never
    // even reach the length check on a huge array.
    const cellCount = data.cols * data.rows
    if(cellCount > MAX_CUSTOM_CELLS) return null

    if(!Array.isArray(data.tiles)) return null
    if(data.tiles.length !== cellCount) return null
    for(const tile of data.tiles){
        if(!isInteger(tile) || tile < 0) return null
    }

    if(!Array.isArray(data.spawns)) return null
    for(const spawn of data.spawns){
        if(!Array.isArray(spawn) || spawn.length !== 2) return null
        if(!isInteger(spawn[0]) || !isInteger(spawn[1])) return null
    }

    if(!Array.isArray(data.palette)) return null
    for(const entry of data.palette){
        if(typeof entry !== "object" || entry === null) return null
        const e = entry as Record<string, unknown>
        if(typeof e.key !== "string") return null
        if(typeof e.shape !== "string" || VALID_TILE_SHAPES.indexOf(e.shape as TileShape) === -1) return null
    }

    if(typeof data.originCol !== "undefined" && !isInteger(data.originCol)) return null
    if(typeof data.originRow !== "undefined" && !isInteger(data.originRow)) return null

    if(typeof data.segments !== "undefined"){
        if(!Array.isArray(data.segments)) return null
        for(const seg of data.segments){
            if(!Array.isArray(seg) || seg.length !== 4) return null
            for(const c of seg){
                if(!isInteger(c)) return null
            }
        }
    }

    // Every field checked: the value is structurally a GridMapData. The cast is
    // safe because each branch above narrowed the corresponding field.
    return x as GridMapData
}
