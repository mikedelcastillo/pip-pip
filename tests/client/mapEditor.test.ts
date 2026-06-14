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
