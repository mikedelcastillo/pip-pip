import { describe, expect, it } from "vitest"
import {
    GridMapData,
    GridPipGameMap,
    loadGridMap,
    greedyMeshFullTiles,
    diagonalSegmentEndpoints,
    paletteEntryAt,
    tileAt,
    isDiagonalShape,
    GRID_TILE_DEFAULT_KEY,
    GRID_TILE_HIDDEN_KEY,
} from "@pip-pip/game/src/logic/grid-map"
import { convertJSONMapToGrid } from "@pip-pip/game/src/logic/grid-map-migrate"
import { JSONPipGameMap, type JSONMapSource } from "@pip-pip/game/src/logic/map"
import { TILE_SIZE } from "@pip-pip/game/src/logic/constants"
import { buildNavGrid } from "@pip-pip/game/src/logic/pathfinding"
import TEST_MAP from "@pip-pip/game/src/maps/test.map.json"
import CLASH_MAP from "@pip-pip/game/src/maps/clash.map.json"

// Build a small full-square palette index for terse fixtures: the tiles array
// stores palette index + 1, so a "1" here means palette[0]. These tests use a
// single full-tile palette entry unless they need diagonals.
const FULL = 1

// A tiny helper that lays out a rectangular block of full tiles plus an explicit
// empty border, so the greedy mesh has something interesting to merge.
function fullBlockMap(cols: number, rows: number, filled: (col: number, row: number) => boolean): GridMapData{
    const tiles: number[] = new Array(cols * rows).fill(0)
    for(let row = 0; row < rows; row++){
        for(let col = 0; col < cols; col++){
            if(filled(col, row)) tiles[row * cols + col] = FULL
        }
    }
    return {
        name: "fixture",
        cellSize: TILE_SIZE,
        cols,
        rows,
        tiles,
        spawns: [],
        palette: [{ key: "wall", shape: "full" }],
    }
}

describe("GridMapData parse / round-trip", () => {
    it("reads palette entries and cells through the index+1 encoding", () => {
        const data: GridMapData = {
            name: "rt",
            cellSize: TILE_SIZE,
            cols: 2,
            rows: 2,
            tiles: [0, 1, 2, 0],
            spawns: [[1, 1]],
            palette: [
                { key: "wall", shape: "full" },
                { key: "slope", shape: "diag_tl" },
            ],
        }

        // Cell (1,0) -> value 1 -> palette[0]; cell (0,1) -> value 2 -> palette[1].
        expect(tileAt(data, 1, 0)).toBe(1)
        expect(tileAt(data, 0, 1)).toBe(2)
        expect(paletteEntryAt(data, 1)?.shape).toBe("full")
        expect(paletteEntryAt(data, 2)?.shape).toBe("diag_tl")

        // 0 and out-of-range resolve to empty (undefined).
        expect(paletteEntryAt(data, 0)).toBeUndefined()
        expect(tileAt(data, 99, 0)).toBe(0)

        // A JSON round-trip preserves the structure exactly.
        const clone = JSON.parse(JSON.stringify(data)) as GridMapData
        expect(clone).toEqual(data)
    })
})

describe("greedy mesh of full tiles", () => {
    it("merges a solid rectangle into ONE rect and covers it exactly", () => {
        // A 5x4 solid block of full tiles.
        const cols = 5
        const rows = 4
        const data = fullBlockMap(cols, rows, () => true)

        const rects = greedyMeshFullTiles(data)
        expect(rects.length).toBe(1)
        expect(rects[0]).toEqual({ col: 0, row: 0, width: 5, height: 4 })
    })

    it("covers EXACTLY the full-tile set with no gaps and no overlaps", () => {
        // An irregular shape: an L plus a detached square.
        const cols = 8
        const rows = 6
        const filled = (col: number, row: number) => {
            const inL = (col < 4 && row < 2) || (col < 2 && row < 5)
            const inSquare = col >= 5 && col <= 6 && row >= 3 && row <= 4
            return inL || inSquare
        }
        const data = fullBlockMap(cols, rows, filled)

        const rects = greedyMeshFullTiles(data)

        // Reconstruct cell coverage from the rects and compare to the source set.
        const covered = new Array(cols * rows).fill(0)
        for(const rect of rects){
            for(let r = rect.row; r < rect.row + rect.height; r++){
                for(let c = rect.col; c < rect.col + rect.width; c++){
                    covered[r * cols + c]++
                }
            }
        }

        for(let row = 0; row < rows; row++){
            for(let col = 0; col < cols; col++){
                const want = filled(col, row) ? 1 : 0
                // Each full tile covered exactly once (no gap, no overlap); each
                // empty tile covered zero times.
                expect(covered[row * cols + col]).toBe(want)
            }
        }
    })

    it("uses far fewer rects than one-per-tile on a solid slab", () => {
        const cols = 10
        const rows = 10
        const data = fullBlockMap(cols, rows, () => true)
        const fullTileCount = cols * rows

        const rects = greedyMeshFullTiles(data)

        // A 10x10 solid slab is 100 tiles but a single merged rect.
        expect(rects.length).toBe(1)
        expect(rects.length).toBeLessThan(fullTileCount)
    })
})

describe("loader: full tiles -> merged rect walls", () => {
    it("turns a solid block into one rect wall sized + centred over the block", () => {
        // 3x2 solid block at the grid origin.
        const data = fullBlockMap(3, 2, () => true)
        const map = loadGridMap("blk", data)

        expect(map.rectWalls.length).toBe(1)
        const wall = map.rectWalls[0]
        // Cells (0,0)..(2,1) centre on (col*cell, row*cell). Block centre is the
        // mean of the corner cell centres.
        expect(wall.width).toBe(3 * TILE_SIZE)
        expect(wall.height).toBe(2 * TILE_SIZE)
        expect(wall.center.x).toBe(((0 + 2) / 2) * TILE_SIZE)
        expect(wall.center.y).toBe(((0 + 1) / 2) * TILE_SIZE)
    })

    it("emits a render tile for every non-empty cell", () => {
        const data = fullBlockMap(2, 2, () => true)
        const map = loadGridMap("tiles", data)
        expect(map.tiles.length).toBe(4)
    })

    it("carries the palette SHAPE and block key onto each render tile (Phase 2)", () => {
        // A mixed palette so the loader has both a square and a slope to tag.
        const data: GridMapData = {
            name: "shapes",
            cellSize: TILE_SIZE,
            cols: 2,
            rows: 1,
            tiles: [1, 2],
            spawns: [],
            palette: [
                { key: "wall", shape: "full" },
                { key: "slope", shape: "diag_tr" },
            ],
        }
        const map = loadGridMap("shapes", data)
        expect(map.tiles.length).toBe(2)

        // The renderer reads tile.shape + tile.block to draw slopes vs squares
        // and to vary block styling, so the loader must emit both from the palette.
        const full = map.tiles.find(t => t.shape === "full")
        const slope = map.tiles.find(t => t.shape === "diag_tr")
        expect(full).toBeDefined()
        expect(slope).toBeDefined()
        expect(full?.block).toBe("wall")
        expect(slope?.block).toBe("slope")
        // texture stays the palette key (legacy sprite path is unaffected).
        expect(full?.texture).toBe("wall")
        expect(slope?.texture).toBe("slope")
    })
})

describe("diagonal tiles", () => {
    it("places the hypotenuse at the two non-filled corners of the cell", () => {
        const cell = TILE_SIZE
        const col = 3
        const row = 2
        const half = cell / 2
        const cx = col * cell
        const cy = row * cell
        const left = cx - half
        const right = cx + half
        const top = cy - half
        const bottom = cy + half

        // diag_tl fills the top-left corner; the hypotenuse runs from the
        // top-right corner to the bottom-left corner.
        const ends = diagonalSegmentEndpoints("diag_tl", col, row, cell)
        expect(ends).toBeDefined()
        expect(ends).toEqual({ startX: right, startY: top, endX: left, endY: bottom })

        // The segment is a true 45-degree diagonal: equal |dx| and |dy|.
        const dx = Math.abs((ends as any).endX - (ends as any).startX)
        const dy = Math.abs((ends as any).endY - (ends as any).startY)
        expect(dx).toBe(dy)
        expect(dx).toBe(cell)
    })

    it("loads a diagonal tile into a single diagonal segWall and no rect wall", () => {
        const data: GridMapData = {
            name: "diag",
            cellSize: TILE_SIZE,
            cols: 1,
            rows: 1,
            tiles: [1],
            spawns: [],
            palette: [{ key: "slope", shape: "diag_br" }],
        }
        const map = loadGridMap("diag", data)

        // Diagonals never merge into rect walls.
        expect(map.rectWalls.length).toBe(0)
        expect(map.segWalls.length).toBe(1)

        const seg = map.segWalls[0]
        // Endpoints sit at the cell corners (a 45-degree run) with seg radius
        // half a cell, matching the legacy segment thickness.
        const dx = Math.abs(seg.end.x - seg.start.x)
        const dy = Math.abs(seg.end.y - seg.start.y)
        expect(dx).toBe(dy)
        expect(dx).toBe(TILE_SIZE)
        expect(seg.radius).toBe(TILE_SIZE / 2)
        expect(isDiagonalShape("diag_br")).toBe(true)
    })

    it("marks diagonal segWalls UNCAPPED so their endcap bump is removed", () => {
        // A diagonal tile's segWall resists along its span only (cappedEnds ===
        // false): the rounded endcap that caught ships / wedged bots at the tip is
        // gone, while the radius (collision thickness) is unchanged.
        const data: GridMapData = {
            name: "diag",
            cellSize: TILE_SIZE,
            cols: 1,
            rows: 1,
            tiles: [1],
            spawns: [],
            palette: [{ key: "slope", shape: "diag_tr" }],
        }
        const map = loadGridMap("diag", data)

        expect(map.segWalls.length).toBe(1)
        const seg = map.segWalls[0]
        expect(seg.cappedEnds).toBe(false)
        // Radius unchanged: still the legacy half-tile thickness.
        expect(seg.radius).toBe(TILE_SIZE / 2)
    })

    it("keeps legacy/explicit straight segments CAPPED (capsule) with unchanged radius", () => {
        // Explicit cell-space `segments` (how the migration carries legacy
        // wall_segments) must stay capped so converted maps are byte-identical.
        const data: GridMapData = {
            name: "segs",
            cellSize: TILE_SIZE,
            cols: 4,
            rows: 4,
            tiles: new Array(16).fill(0),
            spawns: [],
            palette: [],
            segments: [[0, 0, 3, 0]],
        }
        const map = loadGridMap("segs", data)

        expect(map.segWalls.length).toBe(1)
        const seg = map.segWalls[0]
        // Default capped behaviour (rounded endcaps) is preserved for straight
        // segments, and the radius is still the legacy half-tile thickness.
        expect(seg.cappedEnds).toBe(true)
        expect(seg.radius).toBe(TILE_SIZE / 2)
    })
})

describe("nav grid builds from a new-format map", () => {
    it("produces a non-empty occupancy grid with some blocked cells", () => {
        // A ring of full tiles around an open interior.
        const cols = 9
        const rows = 9
        const filled = (col: number, row: number) =>
            col === 0 || row === 0 || col === cols - 1 || row === rows - 1
        const data = fullBlockMap(cols, rows, filled)
        const map = loadGridMap("ring", data)

        const grid = buildNavGrid(map.bounds, map.rectWalls, map.segWalls)
        expect(grid.cols).toBeGreaterThan(0)
        expect(grid.rows).toBeGreaterThan(0)
        // The wall ring must block at least some cells, and the interior must
        // leave at least one open cell to route through.
        const blockedCount = grid.blocked.filter(b => b).length
        expect(blockedCount).toBeGreaterThan(0)
        expect(blockedCount).toBeLessThan(grid.blocked.length)
    })
})

describe("migration: legacy JSON -> grid map preserves geometry", () => {
    it("round-trips the legacy CLASH map with EQUIVALENT collision + spawns", () => {
        const legacy = new JSONPipGameMap("clash", CLASH_MAP as JSONMapSource)
        const grid = loadGridMap("clash", convertJSONMapToGrid("clash", CLASH_MAP as JSONMapSource))

        // The converter shifts every coordinate by (minCol, minRow) so the grid is
        // 0-based. The whole map (walls + spawns) moves together by the same world
        // offset, so collision is geometrically identical - we recover the offset
        // from any matching pair (here the spawn count + relative layout) and then
        // compare segment SHAPES (length + orientation), which are offset-invariant.

        // Same number of collision segments (legacy collision is all segWalls).
        expect(grid.segWalls.length).toBe(legacy.segWalls.length)

        // Same number of spawns.
        expect(grid.spawns.length).toBe(legacy.spawns.length)

        // The grid adds NO rect walls for a migrated map (legacy collision is
        // segment-only; wall tiles convert to render-only "deco" tiles).
        expect(grid.rectWalls.length).toBe(0)

        // Compare the multiset of segment SHAPES (dx, dy, length), which are
        // translation invariant, so the absolute origin shift does not matter.
        const shapeKey = (sx: number, sy: number, ex: number, ey: number) => {
            const dx = ex - sx
            const dy = ey - sy
            return dx + ":" + dy
        }
        const legacyShapes = legacy.segWalls.map(s => shapeKey(s.start.x, s.start.y, s.end.x, s.end.y)).sort()
        const gridShapes = grid.segWalls.map(s => shapeKey(s.start.x, s.start.y, s.end.x, s.end.y)).sort()
        expect(gridShapes).toEqual(legacyShapes)

        // Spot-check: every legacy segment, translated by the constant world
        // offset, has an exact twin in the grid map (same endpoints).
        const offsetX = grid.segWalls[0].start.x - legacy.segWalls[0].start.x
        const offsetY = grid.segWalls[0].start.y - legacy.segWalls[0].start.y
        const gridSet = new Set(
            grid.segWalls.map(s => s.start.x + "," + s.start.y + "," + s.end.x + "," + s.end.y),
        )
        for(const s of legacy.segWalls){
            const key = (s.start.x + offsetX) + "," + (s.start.y + offsetY) + "," +
                (s.end.x + offsetX) + "," + (s.end.y + offsetY)
            expect(gridSet.has(key)).toBe(true)
        }

        // Every grid seg keeps the legacy half-tile radius.
        for(const s of grid.segWalls){
            expect(s.radius).toBe(TILE_SIZE / 2)
        }

        // Spawns line up under the same offset.
        const gridSpawnSet = new Set(grid.spawns.map(s => s.x + "," + s.y))
        for(const s of legacy.spawns){
            expect(gridSpawnSet.has((s.x + offsetX) + "," + (s.y + offsetY))).toBe(true)
        }
    })

    it("tags migrated wall tiles default vs hidden like the legacy loader", () => {
        const legacy = new JSONPipGameMap("test", TEST_MAP as JSONMapSource)
        const grid = loadGridMap("test", convertJSONMapToGrid("test", TEST_MAP as JSONMapSource))

        // Legacy chose tile_default when a wall tile also carried a segment, else
        // tile_hidden. The migrated map must reproduce the SAME texture counts.
        const countTex = (textures: string[]) => {
            let def = 0
            let hid = 0
            for(const t of textures){
                if(t === GRID_TILE_DEFAULT_KEY) def++
                if(t === GRID_TILE_HIDDEN_KEY) hid++
            }
            return { def, hid }
        }
        const legacyCounts = countTex(legacy.tiles.map(t => t.texture))
        const gridCounts = countTex(grid.tiles.map(t => t.texture))
        expect(gridCounts).toEqual(legacyCounts)
        // And the same total tile count.
        expect(grid.tiles.length).toBe(legacy.tiles.length)
    })

    it("keeps migrated tiles as deco SQUARES so old maps look unchanged (Phase 2)", () => {
        const grid = loadGridMap("test", convertJSONMapToGrid("test", TEST_MAP as JSONMapSource))
        // Every migrated tile is a render-only "deco" square: the renderer draws
        // deco (and full) as a square, so legacy maps keep today's blocky look and
        // no tile becomes a slope by accident.
        expect(grid.tiles.length).toBeGreaterThan(0)
        for(const t of grid.tiles){
            expect(t.shape).toBe("deco")
        }
    })

    it("builds a nav grid from a migrated legacy map", () => {
        const grid = loadGridMap("test", convertJSONMapToGrid("test", TEST_MAP as JSONMapSource))
        const nav = buildNavGrid(grid.bounds, grid.rectWalls, grid.segWalls)
        expect(nav.cols).toBeGreaterThan(0)
        expect(nav.rows).toBeGreaterThan(0)
        // A real map has both blocked perimeter cells and open interior cells.
        const blocked = nav.blocked.filter(b => b).length
        expect(blocked).toBeGreaterThan(0)
        expect(blocked).toBeLessThan(nav.blocked.length)
    })
})

describe("GridPipGameMap bounds", () => {
    it("falls back to a sane box for a fully empty grid", () => {
        const data: GridMapData = {
            name: "empty",
            cellSize: TILE_SIZE,
            cols: 3,
            rows: 3,
            tiles: [0, 0, 0, 0, 0, 0, 0, 0, 0],
            spawns: [],
            palette: [],
        }
        const map = new GridPipGameMap("empty", data)
        const { min, max } = map.bounds
        expect(Number.isFinite(min.x)).toBe(true)
        expect(Number.isFinite(max.x)).toBe(true)
        expect(min.x).toBeLessThan(max.x)
        expect(min.y).toBeLessThan(max.y)
    })
})
