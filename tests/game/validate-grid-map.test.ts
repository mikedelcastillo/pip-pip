import { describe, expect, it } from "vitest"
import {
    GridMapData,
    validateGridMapData,
    MAX_CUSTOM_CELLS,
} from "@pip-pip/game/src/logic/grid-map"

// A minimal, structurally-valid GridMapData. Helpers below clone + mutate it to
// exercise each malformed case in isolation.
function validMap(): GridMapData{
    return {
        name: "Tiny",
        cellSize: 64,
        cols: 2,
        rows: 2,
        // length 4 == cols*rows; 0 = empty, 1 = palette[0]
        tiles: [1, 0, 0, 1],
        spawns: [[0, 0], [1, 1]],
        palette: [{ key: "tile_default", shape: "full" }],
        originCol: -1,
        originRow: 3,
        segments: [[0, 0, 1, 1]],
    }
}

describe("validateGridMapData", () => {
    it("accepts a well-formed map and returns it", () => {
        const map = validMap()
        const result = validateGridMapData(map)
        expect(result).not.toBeNull()
        // Returns the SAME object (no copy), typed as GridMapData.
        expect(result).toBe(map)
    })

    it("accepts a map without the optional fields", () => {
        const map = validMap()
        delete map.originCol
        delete map.originRow
        delete map.segments
        expect(validateGridMapData(map)).not.toBeNull()
    })

    it("rejects non-object input without throwing", () => {
        expect(validateGridMapData(null)).toBeNull()
        expect(validateGridMapData(undefined)).toBeNull()
        expect(validateGridMapData("a string")).toBeNull()
        expect(validateGridMapData(42)).toBeNull()
        expect(validateGridMapData([])).toBeNull()
    })

    it("rejects a non-string name", () => {
        const map = validMap() as Record<string, unknown>
        map.name = 123
        expect(validateGridMapData(map)).toBeNull()
    })

    it("rejects a non-positive or non-finite cellSize", () => {
        for(const bad of [0, -5, NaN, Infinity, "64"]){
            const map = validMap() as Record<string, unknown>
            map.cellSize = bad
            expect(validateGridMapData(map)).toBeNull()
        }
    })

    it("rejects non-positive-integer cols/rows", () => {
        for(const bad of [0, -1, 2.5, NaN, "2"]){
            const a = validMap() as Record<string, unknown>
            a.cols = bad
            expect(validateGridMapData(a)).toBeNull()
            const b = validMap() as Record<string, unknown>
            b.rows = bad
            expect(validateGridMapData(b)).toBeNull()
        }
    })

    it("rejects tiles whose length is not exactly cols*rows", () => {
        const map = validMap()
        map.tiles = [1, 0, 0] // 3 != 4
        expect(validateGridMapData(map)).toBeNull()
    })

    it("rejects tiles with a negative or non-integer entry", () => {
        const a = validMap()
        a.tiles = [1, -1, 0, 1]
        expect(validateGridMapData(a)).toBeNull()
        const b = validMap()
        b.tiles = [1, 0.5, 0, 1]
        expect(validateGridMapData(b)).toBeNull()
    })

    it("rejects malformed spawns", () => {
        const a = validMap() as Record<string, unknown>
        a.spawns = [[0]] // wrong arity
        expect(validateGridMapData(a)).toBeNull()
        const b = validMap() as Record<string, unknown>
        b.spawns = [[0, 1.5]] // non-integer
        expect(validateGridMapData(b)).toBeNull()
        const c = validMap() as Record<string, unknown>
        c.spawns = "nope"
        expect(validateGridMapData(c)).toBeNull()
    })

    it("rejects a malformed palette entry", () => {
        const a = validMap() as Record<string, unknown>
        a.palette = [{ key: "x" }] // missing shape
        expect(validateGridMapData(a)).toBeNull()
        const b = validMap() as Record<string, unknown>
        b.palette = [{ key: "x", shape: "octagon" }] // invalid shape
        expect(validateGridMapData(b)).toBeNull()
        const c = validMap() as Record<string, unknown>
        c.palette = [{ shape: "full" }] // missing key
        expect(validateGridMapData(c)).toBeNull()
    })

    it("rejects malformed optional originCol/originRow", () => {
        const a = validMap() as Record<string, unknown>
        a.originCol = 1.5
        expect(validateGridMapData(a)).toBeNull()
        const b = validMap() as Record<string, unknown>
        b.originRow = "0"
        expect(validateGridMapData(b)).toBeNull()
    })

    it("rejects malformed optional segments", () => {
        const a = validMap() as Record<string, unknown>
        a.segments = [[0, 0, 1]] // wrong arity
        expect(validateGridMapData(a)).toBeNull()
        const b = validMap() as Record<string, unknown>
        b.segments = [[0, 0, 1, 1.5]] // non-integer
        expect(validateGridMapData(b)).toBeNull()
    })

    it("rejects an oversized map (cols*rows over MAX_CUSTOM_CELLS)", () => {
        // Build dimensions that exceed the cap but keep the tiles array short, so
        // the cap is what rejects it (not the length mismatch). The validator caps
        // BEFORE walking tiles, so it returns null without allocating a huge array.
        const side = Math.ceil(Math.sqrt(MAX_CUSTOM_CELLS)) + 5
        const map = validMap() as Record<string, unknown>
        map.cols = side
        map.rows = side
        map.tiles = [1] // intentionally short; the cap fires first
        expect(side * side).toBeGreaterThan(MAX_CUSTOM_CELLS)
        expect(validateGridMapData(map)).toBeNull()
    })

    it("accepts a map exactly at the cell cap", () => {
        // A 250 x 250 square is exactly at the cap (62500 cells). cellSize is kept
        // small so the world extent still fits the position quant range (a 1 x
        // 62500 strip would hit the cap but span millions of units, see below).
        const side = Math.sqrt(MAX_CUSTOM_CELLS) // 250
        const map: GridMapData = {
            name: "Cap",
            cellSize: 32, // 250 * 32 = 8000 units, within WORLD_QUANT_RANGE
            cols: side,
            rows: side,
            tiles: new Array(side * side).fill(0),
            spawns: [],
            palette: [{ key: "tile_default", shape: "full" }],
        }
        expect(side * side).toBe(MAX_CUSTOM_CELLS)
        expect(validateGridMapData(map)).not.toBeNull()
    })

    it("rejects a map whose world extent exceeds the position quant range", () => {
        // 200 x 200 cells is within the cell cap (40000 <= 62500), but at this cell
        // size it spans ~14400 world units, past WORLD_QUANT_RANGE (~8192) - so a
        // position out there would saturate on the wire and desync server vs client.
        const map = validMap()
        map.cols = 200
        map.rows = 200
        map.cellSize = 72
        map.originCol = 0
        map.originRow = 0
        map.tiles = new Array(200 * 200).fill(0)
        expect(map.cols * map.rows).toBeLessThanOrEqual(MAX_CUSTOM_CELLS)
        expect(validateGridMapData(map)).toBeNull()
    })

    it("rejects a tiny grid pushed out of range by its origin offset", () => {
        // Only 4 cells, but the origin shifts them tens of thousands of units away.
        const map = validMap()
        map.cols = 2
        map.rows = 2
        map.cellSize = 64
        map.tiles = [0, 0, 0, 0]
        map.originCol = 1000 // 1000 * 64 = 64000 world units, far past the range
        map.originRow = 0
        expect(validateGridMapData(map)).toBeNull()
    })

    it("accepts a large map that stays within the quant range", () => {
        const map = validMap()
        map.cols = 100
        map.rows = 100
        map.cellSize = 64 // 100 * 64 = 6400 < 8192
        map.originCol = 0
        map.originRow = 0
        map.tiles = new Array(100 * 100).fill(0)
        expect(validateGridMapData(map)).not.toBeNull()
    })
})
