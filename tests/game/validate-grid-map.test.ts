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
        // A 1 x MAX_CUSTOM_CELLS strip is exactly at the cap and must be accepted.
        const cols = MAX_CUSTOM_CELLS
        const map: GridMapData = {
            name: "Cap",
            cellSize: 64,
            cols,
            rows: 1,
            tiles: new Array(cols).fill(0),
            spawns: [],
            palette: [{ key: "tile_default", shape: "full" }],
        }
        expect(validateGridMapData(map)).not.toBeNull()
    })
})
