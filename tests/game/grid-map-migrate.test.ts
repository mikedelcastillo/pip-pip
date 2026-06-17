import { describe, expect, it } from "vitest"
import { convertJSONMapToGrid } from "@pip-pip/game/src/logic/grid-map-migrate"
import { TILE_SIZE } from "@pip-pip/game/src/logic/constants"

// Every legacy *.map.json is loaded through this adapter, so its coordinate math
// is load-bearing. These pin the negative-origin shift (world position preserved),
// the deco-texture pick, and the empty-source box.
const empty = { wall_tiles: [], spawn_tiles: [], wall_segments: [], wall_segment_tiles: [] }

describe("convertJSONMapToGrid", () => {
    it("shifts negative coordinates to a 0-based grid and records the legacy origin", () => {
        const grid = convertJSONMapToGrid("neg", {
            ...empty,
            wall_tiles: [[-2, -3], [0, 0]],
            spawn_tiles: [[-1, -1]],
            wall_segments: [[-2, -3, 0, 0]],
        })
        // minCol=-2, minRow=-3 => cols = 0-(-2)+1 = 3, rows = 0-(-3)+1 = 4
        expect(grid.cols).toBe(3)
        expect(grid.rows).toBe(4)
        expect(grid.originCol).toBe(-2)
        expect(grid.originRow).toBe(-3)
        expect(grid.spawns).toEqual([[1, 2]])
        expect(grid.segments).toEqual([[0, 0, 2, 3]])
        expect(grid.cellSize).toBe(TILE_SIZE)
    })

    it("preserves world position: (col + originCol) * cellSize equals the legacy tile * TILE_SIZE", () => {
        const grid = convertJSONMapToGrid("pos", { ...empty, wall_tiles: [[5, 7]] })
        const worldX = (0 + (grid.originCol ?? 0)) * grid.cellSize
        const worldY = (0 + (grid.originRow ?? 0)) * grid.cellSize
        expect(worldX).toBe(5 * TILE_SIZE)
        expect(worldY).toBe(7 * TILE_SIZE)
    })

    it("tags a wall tile with a segment as the default texture, others as hidden", () => {
        const grid = convertJSONMapToGrid("deco", {
            ...empty,
            wall_tiles: [[0, 0], [1, 0]],
            wall_segment_tiles: [[0, 0]],
        })
        // tiles store paletteIndex + 1; default index 0 -> 1, hidden index 1 -> 2.
        expect(grid.tiles[0]).toBe(1)
        expect(grid.tiles[1]).toBe(2)
        expect(grid.palette.length).toBe(2)
    })

    it("returns a 1x1 box for a completely empty source", () => {
        const grid = convertJSONMapToGrid("empty", empty)
        expect(grid.cols).toBe(1)
        expect(grid.rows).toBe(1)
        expect(grid.tiles).toEqual([0])
        expect(grid.spawns).toEqual([])
        expect(grid.segments).toEqual([])
    })
})
