import { describe, expect, it } from "vitest"
import {
    EditorMap,
    EDITOR_PALETTE,
    MIN_GRID,
    MAX_GRID,
    clampGrid,
    paletteValueForBrush,
    parseGridMapData,
    serializeGridMapData,
    mapFileName,
} from "../../packages/client/src/game/mapEditor"
import { loadGridMap } from "../../packages/game/src/logic/grid-map"

describe("clampGrid", () => {
    it("clamps below/above the allowed range and floors fractions", () => {
        expect(clampGrid(1)).toBe(MIN_GRID)
        expect(clampGrid(9999)).toBe(MAX_GRID)
        expect(clampGrid(12.9)).toBe(12)
        expect(clampGrid(Number.NaN)).toBe(MIN_GRID)
    })
})

describe("paletteValueForBrush", () => {
    it("maps each shape brush to its palette index + 1", () => {
        expect(paletteValueForBrush("full")).toBe(1)
        // The value indexes palette[value - 1] back to the same shape.
        const map = new EditorMap()
        for(const entry of EDITOR_PALETTE){
            const value = paletteValueForBrush(entry.brush)
            expect(map.palette[value - 1].shape).toBe(entry.shape)
        }
    })

    it("throws for brushes that write no palette value", () => {
        expect(() => paletteValueForBrush("empty")).toThrow()
        expect(() => paletteValueForBrush("spawn")).toThrow()
    })
})

describe("EditorMap painting", () => {
    it("paints a tile and reports a change only when the value differs", () => {
        const map = new EditorMap(8, 8)
        expect(map.tileAt(2, 3)).toBe(0)
        expect(map.setCell(2, 3, "full")).toBe(true)
        expect(map.tileAt(2, 3)).toBe(paletteValueForBrush("full"))
        // Painting the same brush into the same cell is a no-op.
        expect(map.setCell(2, 3, "full")).toBe(false)
    })

    it("erases with the empty brush", () => {
        const map = new EditorMap(8, 8)
        map.setCell(1, 1, "diag_tl")
        expect(map.tileAt(1, 1)).not.toBe(0)
        expect(map.setCell(1, 1, "empty")).toBe(true)
        expect(map.tileAt(1, 1)).toBe(0)
    })

    it("ignores out-of-bounds paints", () => {
        const map = new EditorMap(4, 4)
        expect(map.setCell(-1, 0, "full")).toBe(false)
        expect(map.setCell(4, 0, "full")).toBe(false)
        expect(map.setCell(0, 99, "full")).toBe(false)
    })

    it("toggles spawn markers without touching the tile", () => {
        const map = new EditorMap(8, 8)
        map.setCell(3, 3, "full")
        expect(map.hasSpawn(3, 3)).toBe(false)
        map.setCell(3, 3, "spawn")
        expect(map.hasSpawn(3, 3)).toBe(true)
        // The tile survives under the spawn.
        expect(map.tileAt(3, 3)).toBe(paletteValueForBrush("full"))
        // Toggling again removes the spawn.
        map.setCell(3, 3, "spawn")
        expect(map.hasSpawn(3, 3)).toBe(false)
    })

    it("clears all tiles and spawns", () => {
        const map = new EditorMap(6, 6)
        map.setCell(0, 0, "full")
        map.setCell(1, 1, "spawn")
        map.clear()
        expect(map.tiles.every((v) => v === 0)).toBe(true)
        expect(map.spawns.length).toBe(0)
    })
})

describe("EditorMap resize", () => {
    it("preserves cells that still fit and drops the rest", () => {
        const map = new EditorMap(8, 8)
        map.setCell(1, 1, "full")
        map.setCell(7, 7, "full")
        map.setCell(7, 7, "spawn")
        map.resize(4, 4)
        expect(map.cols).toBe(4)
        expect(map.rows).toBe(4)
        // The in-range cell survives, the out-of-range one is gone.
        expect(map.tileAt(1, 1)).toBe(paletteValueForBrush("full"))
        expect(map.tileAt(7, 7)).toBe(0)
        // Out-of-range spawn is dropped.
        expect(map.spawns.length).toBe(0)
    })

    it("grows without losing existing cells and zero-pads the new area", () => {
        const map = new EditorMap(4, 4)
        map.setCell(3, 3, "full")
        map.resize(8, 8)
        expect(map.tiles.length).toBe(64)
        expect(map.tileAt(3, 3)).toBe(paletteValueForBrush("full"))
        expect(map.tileAt(5, 5)).toBe(0)
    })

    it("clamps both dimensions into range on resize", () => {
        const map = new EditorMap(8, 8)
        map.resize(1, 9999)
        expect(map.cols).toBe(MIN_GRID)
        expect(map.rows).toBe(MAX_GRID)
    })
})

describe("GridMapData round trip", () => {
    it("serializes then parses back to an equivalent editor map", () => {
        const map = new EditorMap(10, 6, "Round Trip")
        map.setCell(2, 2, "full")
        map.setCell(3, 2, "diag_tr")
        map.setCell(4, 4, "deco")
        map.setCell(0, 0, "spawn")
        map.setCell(9, 5, "spawn")

        const data = map.toGridMapData()
        const json = serializeGridMapData(data)
        const parsed = parseGridMapData(json)
        const rebuilt = EditorMap.fromGridMapData(parsed)

        expect(rebuilt.name).toBe("Round Trip")
        expect(rebuilt.cols).toBe(10)
        expect(rebuilt.rows).toBe(6)
        expect(rebuilt.tiles).toEqual(map.tiles)
        expect(rebuilt.spawns).toEqual(map.spawns)
        expect(rebuilt.palette).toEqual(map.palette)
    })

    it("trims the exported name and falls back to a default when blank", () => {
        const named = new EditorMap(4, 4, "  Padded  ")
        expect(named.toGridMapData().name).toBe("Padded")
        const blank = new EditorMap(4, 4, "   ")
        expect(blank.toGridMapData().name.length).toBeGreaterThan(0)
    })

    it("normalises a partial/oversized imported map", () => {
        // cols/rows out of range, a too-short tiles array, and an out-of-bounds
        // spawn: fromGridMapData should clamp, zero-pad, and drop respectively.
        const partial = {
            name: "Partial",
            cellSize: 72,
            cols: 2,
            rows: 2,
            tiles: [1],
            spawns: [[0, 0], [99, 99]],
            palette: EDITOR_PALETTE.map((e) => ({ key: e.key, shape: e.shape })),
        }
        const map = EditorMap.fromGridMapData(partial as never)
        expect(map.cols).toBe(MIN_GRID)
        expect(map.rows).toBe(MIN_GRID)
        expect(map.tiles.length).toBe(MIN_GRID * MIN_GRID)
        expect(map.tiles[0]).toBe(1)
        // Only the in-bounds spawn survives.
        expect(map.spawns).toEqual([[0, 0]])
    })
})

describe("GridMapData feeds loadGridMap", () => {
    it("produces a playable map with the painted spawns and walls", () => {
        const map = new EditorMap(6, 6, "Playable")
        // A solid floor row of full blocks and one diagonal, plus two spawns.
        for(let col = 0; col < 6; col++){
            map.setCell(col, 5, "full")
        }
        map.setCell(2, 4, "diag_tr")
        map.setCell(1, 0, "spawn")
        map.setCell(4, 0, "spawn")

        const playable = loadGridMap("editor-test", map.toGridMapData())

        // Two spawn points carried through.
        expect(playable.spawns.length).toBe(2)
        // The full-block floor row greedy-meshes into at least one rect wall.
        expect(playable.rectWalls.length).toBeGreaterThan(0)
        // The diagonal contributes a segment wall.
        expect(playable.segWalls.length).toBeGreaterThan(0)
        // Every painted cell (6 floor + 1 diagonal) becomes a render tile.
        expect(playable.tiles.length).toBe(7)
    })
})

describe("parseGridMapData", () => {
    it("rejects non-JSON, non-objects, and missing fields", () => {
        expect(() => parseGridMapData("not json")).toThrow()
        expect(() => parseGridMapData("123")).toThrow()
        expect(() => parseGridMapData(JSON.stringify({ cols: 4 }))).toThrow()
    })
})

describe("mapFileName", () => {
    it("slugifies the map name into a .map.json filename", () => {
        expect(mapFileName("My Cool Map!")).toBe("my-cool-map.map.json")
        expect(mapFileName("   ")).toBe("map.map.json")
        expect(mapFileName("___")).toBe("map.map.json")
    })
})
