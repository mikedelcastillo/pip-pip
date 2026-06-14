import { describe, expect, it } from "vitest"
import {
    EditorMap,
    EditorStorage,
    EDITOR_PALETTE,
    EDITOR_STORAGE_KEY,
    cellKey,
    parseCellKey,
    paletteValueForBrush,
    paletteValueForShape,
    autoSlopeShape,
    parseGridMapData,
    serializeGridMapData,
    mapFileName,
    brushForKey,
    saveEditorMap,
    loadEditorMap,
    clearEditorMap,
} from "../../packages/client/src/game/mapEditor"
import { loadGridMap } from "../../packages/game/src/logic/grid-map"

// A tiny in-memory EditorStorage so the autosave round-trip is exercised without
// a real DOM/localStorage. Matches the getItem/setItem/removeItem surface the
// pure persistence helpers depend on.
function fakeStorage(): EditorStorage & { map: Map<string, string> }{
    const map = new Map<string, string>()
    return {
        map,
        getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
        setItem: (key, value) => { map.set(key, value) },
        removeItem: (key) => { map.delete(key) },
    }
}

describe("cellKey / parseCellKey", () => {
    it("round-trips arbitrary (including negative and far) coordinates", () => {
        expect(parseCellKey(cellKey(0, 0))).toEqual([0, 0])
        expect(parseCellKey(cellKey(-7, 3))).toEqual([-7, 3])
        expect(parseCellKey(cellKey(1000, -2000))).toEqual([1000, -2000])
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

describe("EditorMap painting (unbounded, sparse)", () => {
    it("paints a tile and reports a change only when the value differs", () => {
        const map = new EditorMap()
        expect(map.tileAt(2, 3)).toBe(0)
        expect(map.setCell(2, 3, "full")).toBe(true)
        expect(map.tileAt(2, 3)).toBe(paletteValueForBrush("full"))
        // Painting the same brush into the same cell is a no-op.
        expect(map.setCell(2, 3, "full")).toBe(false)
    })

    it("erases with the empty brush", () => {
        const map = new EditorMap()
        map.setCell(1, 1, "diag_tl")
        expect(map.tileAt(1, 1)).not.toBe(0)
        expect(map.setCell(1, 1, "empty")).toBe(true)
        expect(map.tileAt(1, 1)).toBe(0)
        // Erasing an already-empty cell is a no-op.
        expect(map.setCell(1, 1, "empty")).toBe(false)
    })

    it("paints at ANY coordinate, including negative and very far cells", () => {
        const map = new EditorMap()
        expect(map.setCell(-5, -9, "full")).toBe(true)
        expect(map.setCell(0, 0, "full")).toBe(true)
        expect(map.setCell(1000, 1000, "deco")).toBe(true)
        expect(map.tileAt(-5, -9)).toBe(paletteValueForBrush("full"))
        expect(map.tileAt(1000, 1000)).toBe(paletteValueForBrush("deco"))
        // Only the three painted cells exist in the sparse model.
        expect(map.tiles.size).toBe(3)
    })

    it("toggles spawn markers on an empty cell", () => {
        const map = new EditorMap()
        expect(map.hasSpawn(3, 3)).toBe(false)
        map.setCell(3, 3, "spawn")
        expect(map.hasSpawn(3, 3)).toBe(true)
        // Toggling again removes the spawn.
        map.setCell(3, 3, "spawn")
        expect(map.hasSpawn(3, 3)).toBe(false)
    })

    it("clears all tiles and spawns", () => {
        const map = new EditorMap()
        map.setCell(0, 0, "full")
        map.setCell(1, 1, "spawn")
        map.clear()
        expect(map.tiles.size).toBe(0)
        expect(map.spawns.length).toBe(0)
    })
})

describe("EditorMap spawn / tile mutual exclusion", () => {
    it("painting a tile onto a spawn cell removes the spawn", () => {
        const map = new EditorMap()
        map.setCell(4, 4, "spawn")
        expect(map.hasSpawn(4, 4)).toBe(true)
        // Painting a full block over the spawn evicts the spawn.
        expect(map.setCell(4, 4, "full")).toBe(true)
        expect(map.tileAt(4, 4)).toBe(paletteValueForBrush("full"))
        expect(map.hasSpawn(4, 4)).toBe(false)
        expect(map.spawns.length).toBe(0)
    })

    it("toggling a spawn onto a tile cell removes the tile", () => {
        const map = new EditorMap()
        map.setCell(2, 5, "diag_tr")
        expect(map.tileAt(2, 5)).not.toBe(0)
        // Dropping a spawn over the tile evicts the tile.
        map.setCell(2, 5, "spawn")
        expect(map.hasSpawn(2, 5)).toBe(true)
        expect(map.tileAt(2, 5)).toBe(0)
    })

    it("every shape brush (full/slope/deco/auto) evicts a spawn", () => {
        for(const brush of ["full", "diag_bl", "deco", "auto"] as const){
            const map = new EditorMap()
            map.setCell(1, 1, "spawn")
            map.setCell(1, 1, brush)
            expect(map.hasSpawn(1, 1)).toBe(false)
            expect(map.tileAt(1, 1)).not.toBe(0)
        }
    })

    it("reports a change when a tile is repainted only because a spawn was evicted", () => {
        const map = new EditorMap()
        map.setCell(0, 0, "full")
        map.setCell(0, 0, "spawn")
        // The spawn replaced the tile, so the cell is now empty + spawned.
        expect(map.tileAt(0, 0)).toBe(0)
        // Re-painting full both writes the tile AND evicts the spawn: a change.
        expect(map.setCell(0, 0, "full")).toBe(true)
        expect(map.hasSpawn(0, 0)).toBe(false)
        expect(map.tileAt(0, 0)).toBe(paletteValueForBrush("full"))
    })
})

describe("EditorMap export bounding box", () => {
    it("computes cols/rows from the bbox and offsets the dense tiles to (0,0)", () => {
        const map = new EditorMap("Offset")
        // Paint a 2x2 block of cells offset from the origin.
        map.setCell(5, 7, "full")
        map.setCell(6, 7, "full")
        map.setCell(5, 8, "diag_tl")
        map.setCell(6, 8, "deco")

        const data = map.toGridMapData()
        // bbox is cols [5,6], rows [7,8] -> 2x2.
        expect(data.cols).toBe(2)
        expect(data.rows).toBe(2)
        expect(data.tiles.length).toBe(4)
        // The min-corner cell (5,7) maps to dense (0,0).
        expect(data.tiles[0]).toBe(paletteValueForBrush("full"))
        expect(data.tiles[1]).toBe(paletteValueForBrush("full"))
        expect(data.tiles[2]).toBe(paletteValueForShape("diag_tl"))
        expect(data.tiles[3]).toBe(paletteValueForBrush("deco"))
        // Fresh authored map loads at the origin.
        expect(data.originCol).toBe(0)
        expect(data.originRow).toBe(0)
    })

    it("includes far / negative cells AND spawns in the bbox, translating spawns too", () => {
        const map = new EditorMap("Far")
        map.setCell(-3, -4, "full")
        map.setCell(10, 20, "full")
        map.setCell(0, 0, "spawn")

        const data = map.toGridMapData()
        // cols span [-3,10] = 14, rows span [-4,20] = 25.
        expect(data.cols).toBe(14)
        expect(data.rows).toBe(25)
        // The spawn at (0,0) translates by the bbox min (-3,-4) -> (3,4).
        expect(data.spawns).toEqual([[3, 4]])
        // The min corner tile sits at dense (0,0).
        expect(data.tiles[0]).toBe(paletteValueForBrush("full"))
    })

    it("exports a sane minimal map when nothing is painted", () => {
        const map = new EditorMap("Empty")
        const data = map.toGridMapData()
        expect(data.cols).toBe(1)
        expect(data.rows).toBe(1)
        expect(data.tiles).toEqual([0])
        expect(data.spawns).toEqual([])
        // An empty map still loads (bounds fall back to the default box).
        expect(() => loadGridMap("empty", data)).not.toThrow()
    })
})

describe("GridMapData round trip", () => {
    it("serializes then parses back to an equivalent editor map", () => {
        const map = new EditorMap("Round Trip")
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
        expect(rebuilt.palette).toEqual(map.palette)

        // Re-exporting the rebuilt map yields the same dense GridMapData: the
        // sparse offset round-trips through the bbox. (The sparse keys differ
        // because import re-anchors the bbox min to (0,0), which is exactly the
        // unbounded contract: only the loaded geometry must hold.)
        const reexported = rebuilt.toGridMapData()
        expect(reexported.cols).toBe(data.cols)
        expect(reexported.rows).toBe(data.rows)
        expect(reexported.tiles).toEqual(data.tiles)
        expect(reexported.spawns).toEqual(data.spawns)
    })

    it("trims the exported name and falls back to a default when blank", () => {
        const named = new EditorMap("  Padded  ")
        expect(named.toGridMapData().name).toBe("Padded")
        const blank = new EditorMap("   ")
        expect(blank.toGridMapData().name.length).toBeGreaterThan(0)
    })

    it("imports an exported map back into the sparse model", () => {
        const data = {
            name: "Imported",
            cellSize: 72,
            cols: 2,
            rows: 2,
            tiles: [1, 0, 0, paletteValueForBrush("deco")],
            spawns: [[1, 0]],
            palette: EDITOR_PALETTE.map((e) => ({ key: e.key, shape: e.shape })),
        }
        const map = EditorMap.fromGridMapData(data as never)
        // Only the two non-empty dense cells populate the sparse map.
        expect(map.tiles.size).toBe(2)
        expect(map.tileAt(0, 0)).toBe(1)
        expect(map.tileAt(1, 1)).toBe(paletteValueForBrush("deco"))
        expect(map.spawns).toEqual([[1, 0]])
    })
})

describe("export feeds loadGridMap (offset map loads at the right geometry)", () => {
    it("produces a playable map with the painted spawns and walls, offset to (0,0)", () => {
        const map = new EditorMap("Playable")
        // A solid floor row of full blocks offset from the origin, plus a
        // diagonal and two spawns, all at arbitrary coordinates.
        for(let col = 30; col < 36; col++){
            map.setCell(col, 25, "full")
        }
        map.setCell(32, 24, "diag_tr")
        map.setCell(31, 20, "spawn")
        map.setCell(34, 20, "spawn")

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

describe("autoSlopeShape (neighbour-aware auto slope)", () => {
    it("picks the diagonal whose right angle is the corner of two perpendicular walls", () => {
        // (top, right, bottom, left)
        expect(autoSlopeShape(true, false, false, true)).toBe("diag_tl")
        expect(autoSlopeShape(true, true, false, false)).toBe("diag_tr")
        expect(autoSlopeShape(false, false, true, true)).toBe("diag_bl")
        expect(autoSlopeShape(false, true, true, false)).toBe("diag_br")
    })

    it("falls back to a full block when there is no clean two-wall corner", () => {
        expect(autoSlopeShape(false, false, false, false)).toBe("full") // isolated
        expect(autoSlopeShape(true, false, false, false)).toBe("full") // single wall
        expect(autoSlopeShape(true, false, true, false)).toBe("full") // opposite walls
        expect(autoSlopeShape(true, true, true, false)).toBe("full") // three walls
        expect(autoSlopeShape(true, true, true, true)).toBe("full") // surrounded
    })
})

describe("EditorMap auto-slope brush", () => {
    it("paints the corner-matching slope from full neighbours", () => {
        const map = new EditorMap()
        // Walls above and to the left of (2,2) -> top-left corner -> diag_tl.
        map.setCell(2, 1, "full")
        map.setCell(1, 2, "full")
        const changed = map.setCell(2, 2, "auto")
        expect(changed).toBe(true)
        expect(map.tileAt(2, 2)).toBe(paletteValueForShape("diag_tl"))
    })

    it("paints a full block when neighbours do not form a corner", () => {
        const map = new EditorMap()
        // No solid neighbours -> auto resolves to a full block.
        expect(map.setCell(2, 2, "auto")).toBe(true)
        expect(map.tileAt(2, 2)).toBe(paletteValueForShape("full"))
    })
})

describe("brushForKey shortcut mapping", () => {
    it("maps each single key to the brush its tool selects", () => {
        expect(brushForKey("e")).toBe("empty")
        expect(brushForKey("b")).toBe("full")
        expect(brushForKey("d")).toBe("deco")
        expect(brushForKey("g")).toBe("spawn")
        // S is the primary SLOPE tool = Auto slope.
        expect(brushForKey("s")).toBe("auto")
        // The explicit directions keep the Q/W/A/X corner cluster (tucked in the
        // Auto-slope dropdown).
        expect(brushForKey("q")).toBe("diag_tl")
        expect(brushForKey("w")).toBe("diag_tr")
        expect(brushForKey("a")).toBe("diag_bl")
        expect(brushForKey("x")).toBe("diag_br")
    })

    it("is case-insensitive so Shift does not break a shortcut", () => {
        expect(brushForKey("B")).toBe("full")
        expect(brushForKey("Q")).toBe("diag_tl")
    })

    it("returns null for keys that are not tool shortcuts", () => {
        expect(brushForKey("z")).toBe(null)
        expect(brushForKey("1")).toBe(null)
        expect(brushForKey("Enter")).toBe(null)
        expect(brushForKey(" ")).toBe(null)
    })

    it("only maps keys to brushes that exist on an EditorMap", () => {
        // Every mapped SHAPE brush must round-trip to a palette entry; empty,
        // spawn and auto are valid brushes EditorMap.setCell accepts even without
        // a static palette entry (auto resolves to a shape from neighbours).
        const map = new EditorMap()
        for(const key of ["b", "d", "q", "w", "a", "x"]){
            const brush = brushForKey(key)
            expect(brush).not.toBe(null)
            const value = paletteValueForBrush(brush as never)
            expect(map.palette[value - 1]).toBeDefined()
        }
    })
})

describe("localStorage autosave round-trip", () => {
    it("saves a map and restores an equivalent one from a fake storage", () => {
        const storage = fakeStorage()
        const map = new EditorMap("Saved Map")
        map.setCell(1, 1, "full")
        map.setCell(2, 1, "diag_br")
        map.setCell(5, 5, "deco")
        map.setCell(0, 0, "spawn")

        saveEditorMap(map, storage)
        // It actually wrote JSON under the shared key.
        expect(storage.map.has(EDITOR_STORAGE_KEY)).toBe(true)

        const restored = loadEditorMap(storage)
        expect(restored).not.toBe(null)
        const safe = restored as EditorMap
        expect(safe.name).toBe("Saved Map")
        // The restored map re-exports to the same dense GridMapData.
        expect(safe.toGridMapData().tiles).toEqual(map.toGridMapData().tiles)
        expect(safe.toGridMapData().spawns).toEqual(map.toGridMapData().spawns)
    })

    it("returns null when there is no saved draft", () => {
        const storage = fakeStorage()
        expect(loadEditorMap(storage)).toBe(null)
    })

    it("returns null (instead of throwing) on a corrupt draft", () => {
        const storage = fakeStorage()
        storage.setItem(EDITOR_STORAGE_KEY, "{ not valid json")
        expect(loadEditorMap(storage)).toBe(null)
    })

    it("clearEditorMap forgets the draft so the next load is blank", () => {
        const storage = fakeStorage()
        const temp = new EditorMap("Temp")
        temp.setCell(0, 0, "full")
        saveEditorMap(temp, storage)
        expect(loadEditorMap(storage)).not.toBe(null)
        clearEditorMap(storage)
        expect(storage.map.has(EDITOR_STORAGE_KEY)).toBe(false)
        expect(loadEditorMap(storage)).toBe(null)
    })
})
