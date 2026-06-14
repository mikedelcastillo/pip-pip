import { describe, expect, it } from "vitest"
import {
    EditorMap,
    EditorHistory,
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
    snapshotEditorMap,
    restoreEditorSnapshot,
    snapshotsEqual,
    mapFileName,
    brushForKey,
    saveEditorMap,
    loadEditorMap,
    clearEditorMap,
    PLAY_MAP_STORAGE_KEY,
    stashPlayMap,
    loadPlayMap,
    clearPlayMap,
    rectCells,
    lineCells,
    boundedFloodFill,
    brushAtCell,
    DRAW_MODES,
    FILL_BOUNDS_MARGIN,
    FILL_CELL_CAP,
    Cell,
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

describe("editor -> play handoff", () => {
    it("stashes the current map under the play-map key, separate from the draft", () => {
        const storage = fakeStorage()
        const map = new EditorMap("Played Map")
        map.setCell(0, 0, "full")
        map.setCell(1, 0, "diag_tr")
        map.setCell(0, 1, "spawn")

        stashPlayMap(map.toGridMapData(), storage)
        // It wrote under the play-map key, NOT the autosave-draft key.
        expect(storage.map.has(PLAY_MAP_STORAGE_KEY)).toBe(true)
        expect(storage.map.has(EDITOR_STORAGE_KEY)).toBe(false)

        const loaded = loadPlayMap(storage)
        expect(loaded).not.toBe(null)
        expect(loaded?.name).toBe("Played Map")
        // The loaded data round-trips back to the same exported geometry.
        expect(loaded?.tiles).toEqual(map.toGridMapData().tiles)
        expect(loaded?.spawns).toEqual(map.toGridMapData().spawns)
    })

    it("loadPlayMap returns null when nothing is stashed", () => {
        const storage = fakeStorage()
        expect(loadPlayMap(storage)).toBe(null)
    })

    it("loadPlayMap returns null (instead of throwing) on a corrupt stash", () => {
        const storage = fakeStorage()
        storage.setItem(PLAY_MAP_STORAGE_KEY, "{ not json")
        expect(loadPlayMap(storage)).toBe(null)
    })

    it("clearPlayMap drops the stash so the button stops surfacing", () => {
        const storage = fakeStorage()
        const map = new EditorMap("Temp")
        map.setCell(0, 0, "full")
        stashPlayMap(map.toGridMapData(), storage)
        expect(loadPlayMap(storage)).not.toBe(null)
        clearPlayMap(storage)
        expect(storage.map.has(PLAY_MAP_STORAGE_KEY)).toBe(false)
        expect(loadPlayMap(storage)).toBe(null)
    })
})

// Compare a map's sparse content to a flat description, order-independently, so a
// test reads as "the canvas holds exactly these tiles + spawns" regardless of the
// insertion order the sparse Map happens to keep.
function tileEntries(map: EditorMap): [string, number][]{
    return Array.from(map.tiles.entries()).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}
function spawnKeys(map: EditorMap): string[]{
    return map.spawns.map(([c, r]) => cellKey(c, r)).sort()
}

describe("snapshotEditorMap / restoreEditorSnapshot (deep copy)", () => {
    it("captures tiles + spawns by value, not by reference", () => {
        const map = new EditorMap()
        map.setCell(1, 1, "full")
        map.setCell(2, 2, "spawn")
        const snap = snapshotEditorMap(map)

        // Mutating the LIVE map after the snapshot must not change the snapshot.
        map.setCell(1, 1, "empty")
        map.setCell(5, 5, "deco")
        map.setCell(2, 2, "spawn") // remove the spawn

        expect(snap.tiles).toContainEqual([cellKey(1, 1), paletteValueForBrush("full")])
        expect(snap.tiles.length).toBe(1)
        expect(snap.spawns).toEqual([[2, 2]])
    })

    it("restores a snapshot without sharing references with it", () => {
        const map = new EditorMap()
        map.setCell(3, 4, "full")
        map.setCell(0, 0, "spawn")
        const snap = snapshotEditorMap(map)

        // Scribble all over the map, then restore.
        map.clear()
        map.setCell(9, 9, "deco")
        restoreEditorSnapshot(map, snap)
        expect(tileEntries(map)).toEqual([[cellKey(3, 4), paletteValueForBrush("full")]])
        expect(spawnKeys(map)).toEqual([cellKey(0, 0)])

        // Mutating the restored map must not corrupt the snapshot it came from
        // (the restore rebuilt fresh containers + tuples).
        map.spawns[0][0] = 999
        expect(snap.spawns).toEqual([[0, 0]])
    })
})

describe("snapshotsEqual", () => {
    it("is true for equal content regardless of insertion order", () => {
        const a = new EditorMap()
        a.setCell(1, 1, "full")
        a.setCell(2, 2, "deco")
        a.setCell(0, 0, "spawn")
        const b = new EditorMap()
        b.setCell(2, 2, "deco")
        b.setCell(0, 0, "spawn")
        b.setCell(1, 1, "full")
        expect(snapshotsEqual(snapshotEditorMap(a), snapshotEditorMap(b))).toBe(true)
    })

    it("is false when a tile value, a tile cell, or a spawn differs", () => {
        const base = new EditorMap()
        base.setCell(1, 1, "full")
        const baseSnap = snapshotEditorMap(base)

        const diffValue = new EditorMap()
        diffValue.setCell(1, 1, "deco")
        expect(snapshotsEqual(baseSnap, snapshotEditorMap(diffValue))).toBe(false)

        const diffCell = new EditorMap()
        diffCell.setCell(2, 1, "full")
        expect(snapshotsEqual(baseSnap, snapshotEditorMap(diffCell))).toBe(false)

        const extraSpawn = new EditorMap()
        extraSpawn.setCell(1, 1, "full")
        extraSpawn.setCell(3, 3, "spawn")
        expect(snapshotsEqual(baseSnap, snapshotEditorMap(extraSpawn))).toBe(false)
    })
})

describe("EditorHistory (Aseprite-style undo / redo)", () => {
    it("push/undo/redo round-trips the sparse tiles + spawns", () => {
        const map = new EditorMap()
        const history = new EditorHistory()
        expect(history.canUndo()).toBe(false)
        expect(history.canRedo()).toBe(false)

        // One committed edit (a tap).
        history.begin(map)
        map.setCell(2, 3, "full")
        expect(history.commit(map)).toBe(true)
        expect(history.canUndo()).toBe(true)
        expect(history.canRedo()).toBe(false)

        // Undo returns to the empty canvas.
        expect(history.undo(map)).toBe(true)
        expect(map.tiles.size).toBe(0)
        expect(history.canUndo()).toBe(false)
        expect(history.canRedo()).toBe(true)

        // Redo re-applies it, and the sparse model round-trips: the export shows
        // the restored tile.
        expect(history.redo(map)).toBe(true)
        expect(map.tileAt(2, 3)).toBe(paletteValueForBrush("full"))
        const data = map.toGridMapData()
        expect(data.tiles.some((v) => v === paletteValueForBrush("full"))).toBe(true)
    })

    it("treats a multi-cell stroke as ONE undo step", () => {
        const map = new EditorMap()
        const history = new EditorHistory()

        // One gesture: pointer-down begins, the drag paints 40 cells, pointer-up
        // commits.
        history.begin(map)
        for(let col = 0; col < 40; col++){
            map.setCell(col, 5, "full")
        }
        expect(map.tiles.size).toBe(40)
        expect(history.commit(map)).toBe(true)

        // A single undo wipes the WHOLE stroke (not one cell).
        expect(history.undo(map)).toBe(true)
        expect(map.tiles.size).toBe(0)
        expect(history.canUndo()).toBe(false)
        // And a single redo restores all 40 cells at once.
        expect(history.redo(map)).toBe(true)
        expect(map.tiles.size).toBe(40)
    })

    it("undoes a spawn toggle as one step", () => {
        const map = new EditorMap()
        const history = new EditorHistory()
        history.begin(map)
        map.setCell(4, 4, "spawn")
        expect(history.commit(map)).toBe(true)
        expect(map.hasSpawn(4, 4)).toBe(true)

        expect(history.undo(map)).toBe(true)
        expect(map.hasSpawn(4, 4)).toBe(false)
        expect(history.redo(map)).toBe(true)
        expect(map.hasSpawn(4, 4)).toBe(true)
    })

    it("a new edit after an undo CLEARS the redo stack", () => {
        const map = new EditorMap()
        const history = new EditorHistory()

        history.begin(map); map.setCell(0, 0, "full"); history.commit(map)
        history.begin(map); map.setCell(1, 0, "full"); history.commit(map)

        // Undo the second edit, then make a different edit: the redo of the
        // undone second edit must be gone.
        expect(history.undo(map)).toBe(true)
        expect(history.canRedo()).toBe(true)
        history.begin(map); map.setCell(0, 1, "deco"); history.commit(map)
        expect(history.canRedo()).toBe(false)

        // Undo now walks back through the NEW edit, then the first edit.
        expect(history.undo(map)).toBe(true)
        expect(map.tileAt(0, 1)).toBe(0)
        expect(map.tileAt(0, 0)).toBe(paletteValueForBrush("full"))
        expect(history.undo(map)).toBe(true)
        expect(map.tiles.size).toBe(0)
    })

    it("commits no entry for a stroke that changed nothing", () => {
        const map = new EditorMap()
        map.setCell(0, 0, "full")
        const history = new EditorHistory()

        // A gesture that re-paints the same brush onto the same cell is a no-op.
        history.begin(map)
        map.setCell(0, 0, "full")
        expect(history.commit(map)).toBe(false)
        expect(history.canUndo()).toBe(false)
    })

    it("bounded cap drops the oldest step beyond the limit", () => {
        const map = new EditorMap()
        const history = new EditorHistory(3)

        // Five distinct committed edits, cap is 3.
        for(let i = 0; i < 5; i++){
            history.begin(map)
            map.setCell(i, 0, "full")
            expect(history.commit(map)).toBe(true)
        }
        // Only the most recent 3 edits are undoable; the older 2 fell off.
        let undos = 0
        while(history.undo(map)){
            undos++
        }
        expect(undos).toBe(3)
        // The two oldest cells (0,0) and (1,0) survive the bounded undo because
        // their CREATING edits were dropped; cells (2..4, 0) were undone away.
        expect(map.tileAt(0, 0)).toBe(paletteValueForBrush("full"))
        expect(map.tileAt(1, 0)).toBe(paletteValueForBrush("full"))
        expect(map.tileAt(2, 0)).toBe(0)
        expect(map.tileAt(4, 0)).toBe(0)
    })

    it("canUndo / canRedo track the stacks correctly", () => {
        const map = new EditorMap()
        const history = new EditorHistory()
        expect(history.canUndo()).toBe(false)
        expect(history.canRedo()).toBe(false)

        history.begin(map); map.setCell(0, 0, "full"); history.commit(map)
        expect(history.canUndo()).toBe(true)
        expect(history.canRedo()).toBe(false)

        history.undo(map)
        expect(history.canUndo()).toBe(false)
        expect(history.canRedo()).toBe(true)

        history.redo(map)
        expect(history.canUndo()).toBe(true)
        expect(history.canRedo()).toBe(false)
    })

    it("undo/redo are no-ops (return false) on empty stacks", () => {
        const map = new EditorMap()
        const history = new EditorHistory()
        expect(history.undo(map)).toBe(false)
        expect(history.redo(map)).toBe(false)
    })

    it("history is fully isolated: undoing does not corrupt later snapshots", () => {
        const map = new EditorMap()
        const history = new EditorHistory()

        history.begin(map); map.setCell(0, 0, "full"); history.commit(map)
        history.begin(map); map.setCell(1, 1, "deco"); history.commit(map)

        // Undo twice back to empty, then mutate the live map heavily.
        history.undo(map)
        history.undo(map)
        expect(map.tiles.size).toBe(0)
        map.setCell(7, 7, "spawn")
        map.setCell(8, 8, "full")

        // Redoing the first edit must restore EXACTLY that edit's state (empty +
        // one full at 0,0), unpolluted by the live scribbles above.
        expect(history.redo(map)).toBe(true)
        expect(tileEntries(map)).toEqual([[cellKey(0, 0), paletteValueForBrush("full")]])
        expect(map.spawns.length).toBe(0)
    })

    it("reset forgets all history", () => {
        const map = new EditorMap()
        const history = new EditorHistory()
        history.begin(map); map.setCell(0, 0, "full"); history.commit(map)
        history.undo(map)
        expect(history.canUndo() || history.canRedo()).toBe(true)
        history.reset()
        expect(history.canUndo()).toBe(false)
        expect(history.canRedo()).toBe(false)
    })

    it("cancel drops an in-progress gesture without a history entry", () => {
        const map = new EditorMap()
        const history = new EditorHistory()
        history.begin(map)
        map.setCell(0, 0, "full")
        history.cancel()
        // The paint stands on the live map, but nothing was committed to history.
        expect(map.tileAt(0, 0)).toBe(paletteValueForBrush("full"))
        expect(history.canUndo()).toBe(false)
        // A fresh commit with no pending baseline is also a no-op.
        expect(history.commit(map)).toBe(false)
    })
})

// Compare a cell list to an expected set order-independently, so a test reads as
// "these exact cells" regardless of the enumeration order the helper happens to
// return them in.
function sortedCellKeys(cells: Cell[]): string[]{
    return cells.map(([c, r]) => cellKey(c, r)).sort()
}

describe("rectCells (filled bounding box)", () => {
    it("enumerates the inclusive bounding box", () => {
        const cells = rectCells([1, 1], [3, 2])
        // cols [1..3] x rows [1..2] = 6 cells.
        expect(cells.length).toBe(6)
        expect(sortedCellKeys(cells)).toEqual(sortedCellKeys([
            [1, 1], [2, 1], [3, 1],
            [1, 2], [2, 2], [3, 2],
        ]))
    })

    it("is order-independent: start > end gives the same box", () => {
        const forward = rectCells([2, 3], [5, 7])
        const reverse = rectCells([5, 7], [2, 3])
        expect(sortedCellKeys(forward)).toEqual(sortedCellKeys(reverse))
        // 4 cols x 5 rows = 20 cells.
        expect(forward.length).toBe(20)
    })

    it("a single cell (start == end) yields exactly that one cell", () => {
        const cells = rectCells([4, 9], [4, 9])
        expect(cells).toEqual([[4, 9]])
    })

    it("handles negative coordinates", () => {
        const cells = rectCells([-2, -2], [-1, -1])
        expect(sortedCellKeys(cells)).toEqual(sortedCellKeys([
            [-2, -2], [-1, -2], [-2, -1], [-1, -1],
        ]))
    })
})

describe("lineCells (8-connected Bresenham pixel line)", () => {
    // Every pair of consecutive cells in a line must TOUCH (Chebyshev distance 1),
    // so the line has no gaps a brush would skip over.
    function isGapFree(cells: Cell[]): boolean{
        for(let i = 1; i < cells.length; i++){
            const dx = Math.abs(cells[i][0] - cells[i - 1][0])
            const dy = Math.abs(cells[i][1] - cells[i - 1][1])
            if(Math.max(dx, dy) !== 1) return false
        }
        return true
    }

    it("a single cell (start == end) yields exactly that one cell", () => {
        expect(lineCells([3, 3], [3, 3])).toEqual([[3, 3]])
    })

    it("draws a horizontal line, gap-free, both endpoints included", () => {
        const cells = lineCells([0, 5], [4, 5])
        expect(cells.length).toBe(5)
        expect(cells[0]).toEqual([0, 5])
        expect(cells[cells.length - 1]).toEqual([4, 5])
        expect(cells.every(([, r]) => r === 5)).toBe(true)
        expect(isGapFree(cells)).toBe(true)
    })

    it("draws a vertical line, gap-free", () => {
        const cells = lineCells([2, 0], [2, 6])
        expect(cells.length).toBe(7)
        expect(cells.every(([c]) => c === 2)).toBe(true)
        expect(isGapFree(cells)).toBe(true)
    })

    it("draws a 45-degree diagonal, one cell per step, gap-free", () => {
        const cells = lineCells([0, 0], [4, 4])
        expect(cells).toEqual([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]])
        expect(isGapFree(cells)).toBe(true)
    })

    it("draws an arbitrary-slope line gap-free, including both endpoints", () => {
        const cells = lineCells([0, 0], [6, 2])
        expect(cells[0]).toEqual([0, 0])
        expect(cells[cells.length - 1]).toEqual([6, 2])
        expect(isGapFree(cells)).toBe(true)
        // A shallow line spans the longer axis (cols), so 7 cells.
        expect(cells.length).toBe(7)
    })

    it("works for a line drawn in the negative direction", () => {
        const cells = lineCells([5, 5], [1, 3])
        expect(cells[0]).toEqual([5, 5])
        expect(cells[cells.length - 1]).toEqual([1, 3])
        expect(isGapFree(cells)).toBe(true)
    })
})

describe("DRAW_MODES", () => {
    it("lists the four modes with freehand first (the default)", () => {
        expect(DRAW_MODES).toEqual(["freehand", "rect", "line", "fill"])
    })
})

describe("brushAtCell (eyedropper / pick)", () => {
    it("picks 'empty' over an empty cell (the eraser)", () => {
        const map = new EditorMap()
        expect(brushAtCell(map, 0, 0)).toBe("empty")
        // A far / negative empty cell is still empty.
        expect(brushAtCell(map, -50, 999)).toBe("empty")
    })

    it("picks 'full' over a painted full block", () => {
        const map = new EditorMap()
        map.setCell(3, 4, "full")
        expect(brushAtCell(map, 3, 4)).toBe("full")
    })

    it("picks each diagonal shape's brush over a painted slope", () => {
        const map = new EditorMap()
        map.setCell(0, 0, "diag_tl")
        map.setCell(1, 0, "diag_tr")
        map.setCell(0, 1, "diag_bl")
        map.setCell(1, 1, "diag_br")
        expect(brushAtCell(map, 0, 0)).toBe("diag_tl")
        expect(brushAtCell(map, 1, 0)).toBe("diag_tr")
        expect(brushAtCell(map, 0, 1)).toBe("diag_bl")
        expect(brushAtCell(map, 1, 1)).toBe("diag_br")
    })

    it("picks 'deco' over a painted deco tile", () => {
        const map = new EditorMap()
        map.setCell(7, 7, "deco")
        expect(brushAtCell(map, 7, 7)).toBe("deco")
    })

    it("picks 'spawn' over a spawn cell", () => {
        const map = new EditorMap()
        map.setCell(2, 2, "spawn")
        expect(brushAtCell(map, 2, 2)).toBe("spawn")
    })

    it("never returns 'auto': an auto-painted cell holds a concrete shape, so it picks that shape", () => {
        const map = new EditorMap()
        // Walls above and to the left of (2,2) -> auto resolves to diag_tl, which is
        // the concrete shape stored; picking it yields diag_tl, never "auto".
        map.setCell(2, 1, "full")
        map.setCell(1, 2, "full")
        map.setCell(2, 2, "auto")
        const picked = brushAtCell(map, 2, 2)
        expect(picked).toBe("diag_tl")
        expect(picked).not.toBe("auto")
    })

    it("a spawn wins when a cell would otherwise be empty (mutual exclusion: spawn is what is there)", () => {
        const map = new EditorMap()
        // Dropping a spawn over a tile evicts the tile (mutual exclusion), so the
        // cell holds only the spawn and the pick is 'spawn'.
        map.setCell(5, 5, "full")
        map.setCell(5, 5, "spawn")
        expect(map.hasSpawn(5, 5)).toBe(true)
        expect(map.tileAt(5, 5)).toBe(0)
        expect(brushAtCell(map, 5, 5)).toBe("spawn")
    })

    it("does NOT mutate the map (no paint, no spawn toggle, no undo step)", () => {
        const map = new EditorMap()
        map.setCell(1, 1, "full")
        map.setCell(2, 2, "spawn")
        const tilesBefore = map.tiles.size
        const spawnsBefore = map.spawns.length
        brushAtCell(map, 1, 1)
        brushAtCell(map, 2, 2)
        brushAtCell(map, 9, 9)
        expect(map.tiles.size).toBe(tilesBefore)
        expect(map.spawns.length).toBe(spawnsBefore)
        expect(map.tileAt(1, 1)).toBe(paletteValueForBrush("full"))
        expect(map.hasSpawn(2, 2)).toBe(true)
    })
})

describe("boundedFloodFill (safe flood fill on an infinite sparse canvas)", () => {
    // A tile reader over a sparse Map<cellKey, value>, matching EditorMap.tileAt's
    // contract (missing cell = 0 = empty).
    function readerFor(tiles: Map<string, number>): (col: number, row: number) => number{
        return (col, row) => tiles.get(cellKey(col, row)) ?? 0
    }

    it("fills exactly the enclosed interior of a walled room (4-connected)", () => {
        // A 5x5 ring of walls (value 1) with a hollow 3x3 interior.
        const tiles = new Map<string, number>()
        for(let c = 0; c < 5; c++){
            for(let r = 0; r < 5; r++){
                if(c === 0 || c === 4 || r === 0 || r === 4){
                    tiles.set(cellKey(c, r), 1)
                }
            }
        }
        // Clamp generously around the room; a click inside fills only the interior.
        const clamp = { minCol: -2, minRow: -2, maxCol: 6, maxRow: 6 }
        const cells = boundedFloodFill([2, 2], readerFor(tiles), clamp)
        // The hollow 3x3 interior is exactly the empty connected region.
        expect(cells.length).toBe(9)
        const keys = new Set(sortedCellKeys(cells))
        for(let c = 1; c <= 3; c++){
            for(let r = 1; r <= 3; r++){
                expect(keys.has(cellKey(c, r))).toBe(true)
            }
        }
        // No wall cell and no cell outside the ring was visited.
        expect(keys.has(cellKey(0, 0))).toBe(false)
        expect(keys.has(cellKey(2, 0))).toBe(false)
        expect(keys.has(cellKey(5, 5))).toBe(false)
    })

    it("an OPEN empty region terminates within the clamp (never loops forever)", () => {
        // A totally empty map: a naive flood fill would walk to infinity. The
        // clamp bounds it to a finite rectangle, which it must fill fully and stop.
        const tiles = new Map<string, number>()
        const clamp = { minCol: 0, minRow: 0, maxCol: 9, maxRow: 9 }
        const cells = boundedFloodFill([5, 5], readerFor(tiles), clamp)
        // Exactly the 10x10 clamped rectangle, no more.
        expect(cells.length).toBe(100)
        // Every returned cell lies inside the clamp.
        for(const [c, r] of cells){
            expect(c).toBeGreaterThanOrEqual(0)
            expect(c).toBeLessThanOrEqual(9)
            expect(r).toBeGreaterThanOrEqual(0)
            expect(r).toBeLessThanOrEqual(9)
        }
    })

    it("respects the hard cell cap, stopping cleanly with a partial fill", () => {
        // A large empty clamp with a tiny cap: the fill stops at the cap, partial.
        const tiles = new Map<string, number>()
        const clamp = { minCol: 0, minRow: 0, maxCol: 99, maxRow: 99 }
        const cells = boundedFloodFill([0, 0], readerFor(tiles), clamp, 50)
        expect(cells.length).toBe(50)
    })

    it("replaces only the connected same-value region, not other equal-valued cells", () => {
        // Two SEPARATE blobs of value 1, divided by a column of empty cells. A
        // fill seeded in the left blob must not jump the gap to the right blob.
        const tiles = new Map<string, number>()
        tiles.set(cellKey(0, 0), 1)
        tiles.set(cellKey(1, 0), 1)
        tiles.set(cellKey(0, 1), 1)
        // gap at col 2
        tiles.set(cellKey(4, 0), 1)
        tiles.set(cellKey(5, 0), 1)
        const clamp = { minCol: -1, minRow: -1, maxCol: 6, maxRow: 2 }
        const cells = boundedFloodFill([0, 0], readerFor(tiles), clamp)
        const keys = new Set(sortedCellKeys(cells))
        // The left connected blob of value-1 cells, nothing from the right blob.
        expect(keys.has(cellKey(0, 0))).toBe(true)
        expect(keys.has(cellKey(1, 0))).toBe(true)
        expect(keys.has(cellKey(0, 1))).toBe(true)
        expect(keys.has(cellKey(4, 0))).toBe(false)
        expect(keys.has(cellKey(5, 0))).toBe(false)
    })

    it("returns nothing when the seed is outside the clamp", () => {
        const tiles = new Map<string, number>()
        const clamp = { minCol: 0, minRow: 0, maxCol: 4, maxRow: 4 }
        expect(boundedFloodFill([10, 10], readerFor(tiles), clamp)).toEqual([])
    })

    it("clicking a cell already equal to the surrounding value fills that region (idempotent repaint)", () => {
        // The semantics: a fill always returns the connected same-value region,
        // even if the brush would paint the same value back. Here every cell is
        // value 1; the whole connected blob is returned and a caller repainting
        // value 1 over it is a harmless no-op per cell.
        const tiles = new Map<string, number>()
        for(let c = 0; c < 3; c++){
            for(let r = 0; r < 3; r++){
                tiles.set(cellKey(c, r), 1)
            }
        }
        const clamp = { minCol: -1, minRow: -1, maxCol: 3, maxRow: 3 }
        const cells = boundedFloodFill([1, 1], readerFor(tiles), clamp)
        // All 9 connected value-1 cells (the surrounding empty margin differs in
        // value, so it is not part of the region).
        expect(cells.length).toBe(9)
    })
})

describe("EditorMap.fillClamp (bbox + margin clamp for flood fill)", () => {
    it("on an empty map, clamps to a small box around the seed", () => {
        const map = new EditorMap()
        const clamp = map.fillClamp([0, 0])
        expect(clamp).toEqual({
            minCol: -FILL_BOUNDS_MARGIN,
            minRow: -FILL_BOUNDS_MARGIN,
            maxCol: FILL_BOUNDS_MARGIN,
            maxRow: FILL_BOUNDS_MARGIN,
        })
    })

    it("expands the painted bbox by the margin and always includes the seed", () => {
        const map = new EditorMap()
        map.setCell(0, 0, "full")
        map.setCell(4, 4, "full")
        // A seed well outside the bbox grows the clamp to include it.
        const clamp = map.fillClamp([10, -3])
        expect(clamp.minCol).toBe(0 - FILL_BOUNDS_MARGIN)
        expect(clamp.minRow).toBe(-3 - FILL_BOUNDS_MARGIN)
        expect(clamp.maxCol).toBe(10 + FILL_BOUNDS_MARGIN)
        expect(clamp.maxRow).toBe(4 + FILL_BOUNDS_MARGIN)
    })
})

describe("shape application integrates with one undo step", () => {
    // Mirrors how the view applies a shape: begin a history step, paint each cell
    // of the shape's cell set via setCell, commit ONCE. The whole shape must undo
    // as a single step back to the prior canvas state.
    it("applies a rectangle as ONE undo step restoring the prior state", () => {
        const map = new EditorMap()
        // Seed the canvas with one tile so the prior state is non-empty.
        map.setCell(0, 0, "full")
        const history = new EditorHistory()

        history.begin(map)
        for(const [col, row] of rectCells([2, 2], [4, 4])){
            map.setCell(col, row, "full")
        }
        expect(history.commit(map)).toBe(true)
        // 1 seed + 9 rect cells.
        expect(map.tiles.size).toBe(10)

        // A single undo restores the canvas to exactly the seed tile.
        expect(history.undo(map)).toBe(true)
        expect(map.tiles.size).toBe(1)
        expect(map.tileAt(0, 0)).toBe(paletteValueForBrush("full"))
        // And a single redo re-applies the whole rectangle at once.
        expect(history.redo(map)).toBe(true)
        expect(map.tiles.size).toBe(10)
    })

    it("applies a bounded fill as ONE undo step", () => {
        // A walled room; fill the interior with deco, then undo it in one step.
        const map = new EditorMap()
        for(let c = 0; c < 5; c++){
            for(let r = 0; r < 5; r++){
                if(c === 0 || c === 4 || r === 0 || r === 4){
                    map.setCell(c, r, "full")
                }
            }
        }
        const before = map.tiles.size // 16 wall cells
        const history = new EditorHistory()

        history.begin(map)
        const cells = boundedFloodFill([2, 2], (c, r) => map.tileAt(c, r), map.fillClamp([2, 2]))
        for(const [col, row] of cells){
            map.setCell(col, row, "deco")
        }
        expect(history.commit(map)).toBe(true)
        // The 3x3 interior is now deco on top of the 16 walls.
        expect(map.tiles.size).toBe(before + 9)

        expect(history.undo(map)).toBe(true)
        expect(map.tiles.size).toBe(before)
        expect(history.redo(map)).toBe(true)
        expect(map.tiles.size).toBe(before + 9)
    })

    it("the cap constant is the documented backstop", () => {
        expect(FILL_CELL_CAP).toBe(20000)
    })
})
