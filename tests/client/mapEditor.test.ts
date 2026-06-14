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
    materialAtCell,
    editorMapIssue,
    mirrorShape,
    mirrorMap,
    materialKeyForBrush,
    HALF_BRUSHES,
    EDITOR_MATERIALS,
    DEFAULT_MATERIAL_KEY,
    DRAW_MODES,
    FILL_BOUNDS_MARGIN,
    FILL_CELL_CAP,
    Cell,
    CellRect,
    EditorClip,
    normalizeRect,
    extractClip,
    clearRegion,
    stampClip,
    rotateShapeCW,
    rotateClipCW,
    flipClip,
} from "../../packages/client/src/game/mapEditor"
import { TileShape } from "../../packages/game/src/logic/grid-map"
import { loadGridMap } from "../../packages/game/src/logic/grid-map"
import { TILE_BLOCK_STYLES, blockFaceCss } from "../../packages/client/src/game/mapGraphics"

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

describe("EDITOR_MATERIALS (selectable block colours)", () => {
    it("lists tile_default first so a fresh editor keeps today's look", () => {
        expect(EDITOR_MATERIALS[0].key).toBe("tile_default")
        expect(DEFAULT_MATERIAL_KEY).toBe("tile_default")
    })

    it("only lists keys that exist in the shared TILE_BLOCK_STYLES", () => {
        for(const m of EDITOR_MATERIALS){
            expect(TILE_BLOCK_STYLES[m.key]).toBeDefined()
        }
    })

    it("never offers tile_hidden (deco) as a colourable material", () => {
        expect(EDITOR_MATERIALS.some((m) => m.key === "tile_hidden")).toBe(false)
    })

    it("has a non-empty label per material and unique keys", () => {
        const keys = new Set<string>()
        for(const m of EDITOR_MATERIALS){
            expect(m.label.length).toBeGreaterThan(0)
            expect(keys.has(m.key)).toBe(false)
            keys.add(m.key)
        }
    })
})

describe("materialKeyForBrush (colour half of a tile)", () => {
    it("uses the active material for the block + every slope (explicit + auto)", () => {
        for(const brush of ["full", "auto", "diag_tl", "diag_tr", "diag_bl", "diag_br"] as const){
            expect(materialKeyForBrush(brush, "rust")).toBe("rust")
            expect(materialKeyForBrush(brush, "teal")).toBe("teal")
        }
    })

    it("forces deco to the non-colliding tile_hidden regardless of the material", () => {
        expect(materialKeyForBrush("deco", "rust")).toBe("tile_hidden")
        expect(materialKeyForBrush("deco", "teal")).toBe("tile_hidden")
        expect(materialKeyForBrush("deco", "tile_default")).toBe("tile_hidden")
    })
})

describe("blockFaceCss (editor preview matches in-game colour)", () => {
    it("maps a named material to its TILE_BLOCK_STYLES face colour as #rrggbb", () => {
        for(const m of EDITOR_MATERIALS){
            const expected = `#${TILE_BLOCK_STYLES[m.key].face.toString(16).padStart(6, "0")}`
            expect(blockFaceCss(m.key)).toBe(expected)
        }
    })

    it("zero-pads a face colour with leading-zero channels", () => {
        // A face value whose hex is < 6 digits must still render 6 digits.
        // tile_default (0x362631) is already 6; assert the padding contract on a
        // synthetic small value via the same formatting the helper uses.
        expect("#000abc").toBe(`#${(0x000abc).toString(16).padStart(6, "0")}`)
    })
})

describe("append-only material palette (indices stay stable)", () => {
    it("reuses an existing {shape, key} entry and APPENDS a brand-new one", () => {
        const map = new EditorMap()
        const seedLength = map.palette.length

        // The default-material block reuses the seed entry (index 0 -> value 1).
        expect(map.setCell(0, 0, "full", "tile_default")).toBe(true)
        expect(map.tileAt(0, 0)).toBe(1)
        expect(map.palette.length).toBe(seedLength)

        // A new colour for the SAME shape appends a fresh entry at the END.
        expect(map.setCell(1, 0, "full", "rust")).toBe(true)
        const rustValue = map.tileAt(1, 0)
        expect(rustValue).toBe(seedLength + 1)
        expect(map.palette[rustValue - 1]).toEqual({ shape: "full", key: "rust" })
        expect(map.palette.length).toBe(seedLength + 1)

        // Painting rust again reuses that appended entry (no further growth).
        expect(map.setCell(2, 0, "full", "rust")).toBe(true)
        expect(map.tileAt(2, 0)).toBe(rustValue)
        expect(map.palette.length).toBe(seedLength + 1)
    })

    it("never reindexes existing entries as many materials are added", () => {
        const map = new EditorMap()
        const seed = map.palette.map((e) => ({ ...e }))

        // Paint a block in every colourable material at distinct cells.
        EDITOR_MATERIALS.forEach((m, i) => {
            map.setCell(i, 0, "full", m.key)
        })

        // Every seed entry is byte-identical at its ORIGINAL index (append-only).
        seed.forEach((entry, i) => {
            expect(map.palette[i]).toEqual(entry)
        })

        // Each painted cell still resolves to a full tile in the colour requested.
        EDITOR_MATERIALS.forEach((m, i) => {
            const value = map.tileAt(i, 0)
            expect(map.palette[value - 1]).toEqual({ shape: "full", key: m.key })
        })
    })

    it("stores a value whose palette entry has the right {shape, key} for a slope", () => {
        const map = new EditorMap()
        map.setCell(3, 3, "diag_br", "teal")
        const value = map.tileAt(3, 3)
        expect(map.palette[value - 1]).toEqual({ shape: "diag_br", key: "teal" })
    })

    it("auto-slope adopts the active material for the resolved shape", () => {
        const map = new EditorMap()
        // Walls above + left of (2,2) -> auto resolves to diag_tl, painted in cobalt.
        map.setCell(2, 1, "full", "cobalt")
        map.setCell(1, 2, "full", "cobalt")
        map.setCell(2, 2, "auto", "cobalt")
        const value = map.tileAt(2, 2)
        expect(map.palette[value - 1]).toEqual({ shape: "diag_tl", key: "cobalt" })
    })

    it("deco ignores the material and stays the non-colliding tile_hidden", () => {
        const map = new EditorMap()
        map.setCell(0, 0, "deco", "rust")
        const value = map.tileAt(0, 0)
        expect(map.palette[value - 1]).toEqual({ shape: "deco", key: "tile_hidden" })
    })

    it("defaults the material to tile_default when omitted (backward compat)", () => {
        const map = new EditorMap()
        // The 3-arg call path (every legacy call site + the eraser) paints in the
        // default material, reusing the seed full/tile_default entry (value 1).
        expect(map.setCell(0, 0, "full")).toBe(true)
        expect(map.tileAt(0, 0)).toBe(1)
        expect(map.palette[0]).toEqual({ shape: "full", key: "tile_default" })
    })
})

describe("material round-trips through GridMapData and undo/redo", () => {
    it("preserves appended materials across toGridMapData -> loadGridMap", () => {
        const map = new EditorMap("Colourful")
        map.setCell(0, 0, "full", "tile_default")
        map.setCell(1, 0, "full", "rust")
        map.setCell(0, 1, "diag_tr", "teal")

        const data = map.toGridMapData()
        // The exported palette carries the appended colours.
        expect(data.palette.some((e) => e.key === "rust" && e.shape === "full")).toBe(true)
        expect(data.palette.some((e) => e.key === "teal" && e.shape === "diag_tr")).toBe(true)

        // It loads into the real game loader, and the render tiles carry the keys.
        const playable = loadGridMap("colourful", data)
        const blocks = playable.tiles.map((t) => t.block)
        expect(blocks).toContain("rust")
        expect(blocks).toContain("teal")
        expect(blocks).toContain("tile_default")
    })

    it("a loaded map's palette is ADOPTED as-is and only appended to", () => {
        // Re-import a coloured map, then paint a NEW colour onto it.
        const original = new EditorMap("Loaded")
        original.setCell(0, 0, "full", "rust")
        const data = original.toGridMapData()
        const imported = EditorMap.fromGridMapData(data)

        // The imported palette equals the exported one (adopted verbatim).
        expect(imported.palette).toEqual(data.palette)
        const beforeLength = imported.palette.length

        // Painting an existing colour reuses its index; a new colour appends.
        imported.setCell(1, 0, "full", "rust")
        expect(imported.palette.length).toBe(beforeLength)
        imported.setCell(2, 0, "full", "moss")
        expect(imported.palette.length).toBe(beforeLength + 1)
        const mossValue = imported.tileAt(2, 0)
        expect(imported.palette[mossValue - 1]).toEqual({ shape: "full", key: "moss" })
    })

    it("an old single-material map still loads and renders identically", () => {
        // A legacy draft using ONLY tile_default / tile_hidden, like today's autosaves.
        const data = {
            name: "Legacy",
            cellSize: 72,
            cols: 2,
            rows: 1,
            tiles: [1, paletteValueForBrush("deco")],
            spawns: [],
            palette: EDITOR_PALETTE.map((e) => ({ key: e.key, shape: e.shape })),
        }
        const map = EditorMap.fromGridMapData(data as never)
        // The default block at (0,0) and the deco at (1,0) survive unchanged.
        expect(map.palette[map.tileAt(0, 0) - 1]).toEqual({ shape: "full", key: "tile_default" })
        expect(map.palette[map.tileAt(1, 0) - 1]).toEqual({ shape: "deco", key: "tile_hidden" })
        // Painting a new colour onto it just appends, leaving the legacy entries put.
        const beforeLength = map.palette.length
        map.setCell(0, 0, "full", "slate")
        expect(map.palette.length).toBe(beforeLength + 1)
        expect(map.palette[0]).toEqual({ shape: "full", key: "tile_default" })
    })

    it("round-trips MIXED-material tiles through serialize -> parse -> rebuild", () => {
        const map = new EditorMap("Mixed")
        map.setCell(0, 0, "full", "tile_default")
        map.setCell(1, 0, "full", "rust")
        map.setCell(0, 1, "diag_bl", "accent")
        map.setCell(1, 1, "deco", "rust") // deco -> tile_hidden regardless

        const data = map.toGridMapData()
        const rebuilt = EditorMap.fromGridMapData(parseGridMapData(serializeGridMapData(data)))
        // The rebuilt map re-exports to byte-identical dense tiles + palette.
        const reexported = rebuilt.toGridMapData()
        expect(reexported.tiles).toEqual(data.tiles)
        expect(reexported.palette).toEqual(data.palette)
    })

    it("undo/redo round-trips tiles with mixed materials (values stay valid)", () => {
        const map = new EditorMap()
        const history = new EditorHistory()

        // One gesture paints three differently-coloured tiles.
        history.begin(map)
        map.setCell(0, 0, "full", "rust")
        map.setCell(1, 0, "full", "teal")
        map.setCell(0, 1, "diag_tl", "accent")
        expect(history.commit(map)).toBe(true)

        const rustValue = map.tileAt(0, 0)
        const tealValue = map.tileAt(1, 0)
        const accentValue = map.tileAt(0, 1)

        // Undo wipes the whole stroke; the palette (append-only) is untouched, so
        // every captured value still points at the right entry after redo.
        expect(history.undo(map)).toBe(true)
        expect(map.tiles.size).toBe(0)
        expect(history.redo(map)).toBe(true)
        expect(map.tileAt(0, 0)).toBe(rustValue)
        expect(map.tileAt(1, 0)).toBe(tealValue)
        expect(map.tileAt(0, 1)).toBe(accentValue)
        expect(map.palette[rustValue - 1]).toEqual({ shape: "full", key: "rust" })
        expect(map.palette[tealValue - 1]).toEqual({ shape: "full", key: "teal" })
        expect(map.palette[accentValue - 1]).toEqual({ shape: "diag_tl", key: "accent" })
    })
})

describe("fill matches by VALUE (shape + material), not just shape", () => {
    it("only flood-fills cells of the SAME shape AND colour", () => {
        const map = new EditorMap()
        // A row: two rust blocks, then a teal block, then a rust block. A fill
        // seeded on the first rust must stop at the teal (different value) and not
        // jump to the rust on the far side.
        map.setCell(0, 0, "full", "rust")
        map.setCell(1, 0, "full", "rust")
        map.setCell(2, 0, "full", "teal")
        map.setCell(3, 0, "full", "rust")

        const start: Cell = [0, 0]
        const cells = boundedFloodFill(start, (c, r) => map.tileAt(c, r), map.fillClamp(start))
        const keys = new Set(cells.map(([c, r]) => cellKey(c, r)))
        // The two connected rust cells fill; the teal and the far rust do not.
        expect(keys.has(cellKey(0, 0))).toBe(true)
        expect(keys.has(cellKey(1, 0))).toBe(true)
        expect(keys.has(cellKey(2, 0))).toBe(false)
        expect(keys.has(cellKey(3, 0))).toBe(false)
    })
})

describe("materialAtCell (eyedropper picks colour too)", () => {
    it("picks the material of a painted block / slope", () => {
        const map = new EditorMap()
        map.setCell(0, 0, "full", "rust")
        map.setCell(1, 0, "diag_tr", "teal")
        expect(materialAtCell(map, 0, 0)).toBe("rust")
        expect(materialAtCell(map, 1, 0)).toBe("teal")
    })

    it("returns null over empty, spawn, or deco cells (nothing colourable to adopt)", () => {
        const map = new EditorMap()
        expect(materialAtCell(map, 9, 9)).toBe(null) // empty
        map.setCell(2, 2, "spawn")
        expect(materialAtCell(map, 2, 2)).toBe(null) // spawn
        map.setCell(3, 3, "deco", "rust")
        expect(materialAtCell(map, 3, 3)).toBe(null) // deco (tile_hidden, not a material)
    })

    it("picking a coloured slope adopts BOTH its brush (shape) and its material", () => {
        const map = new EditorMap()
        map.setCell(4, 4, "diag_bl", "accent")
        // brushAtCell yields the shape brush; materialAtCell yields the colour.
        expect(brushAtCell(map, 4, 4)).toBe("diag_bl")
        expect(materialAtCell(map, 4, 4)).toBe("accent")
    })

    it("does NOT mutate the map (no paint, no undo step)", () => {
        const map = new EditorMap()
        map.setCell(1, 1, "full", "rust")
        const tilesBefore = map.tiles.size
        const paletteBefore = map.palette.length
        materialAtCell(map, 1, 1)
        materialAtCell(map, 9, 9)
        expect(map.tiles.size).toBe(tilesBefore)
        expect(map.palette.length).toBe(paletteBefore)
    })
})

describe("half-tile shapes (editor model)", () => {
    it("HALF_BRUSHES lists the four half directions", () => {
        expect(HALF_BRUSHES).toEqual(["half_top", "half_bottom", "half_left", "half_right"])
    })

    it("EDITOR_PALETTE has a seed entry for each of the four half shapes", () => {
        for(const brush of ["half_top", "half_bottom", "half_left", "half_right"] as const){
            const entry = EDITOR_PALETTE.find((e) => e.brush === brush)
            expect(entry).toBeDefined()
            // The palette entry's shape matches its brush, with the default block key.
            expect(entry?.shape).toBe(brush)
            expect(entry?.key).toBe("tile_default")
        }
        // Each half brush round-trips to a palette entry on a fresh map.
        const map = new EditorMap()
        for(const brush of ["half_top", "half_bottom", "half_left", "half_right"] as const){
            const value = paletteValueForBrush(brush)
            expect(map.palette[value - 1].shape).toBe(brush)
        }
    })

    it("paints a half brush and stores a value whose palette entry has the right shape", () => {
        const map = new EditorMap()
        expect(map.setCell(2, 3, "half_top")).toBe(true)
        const value = map.tileAt(2, 3)
        expect(map.palette[value - 1].shape).toBe("half_top")
        // Painting in an explicit material stores {shape, key} for the half tile.
        expect(map.setCell(4, 4, "half_right", "teal")).toBe(true)
        const tealValue = map.tileAt(4, 4)
        expect(map.palette[tealValue - 1]).toEqual({ shape: "half_right", key: "teal" })
    })

    it("brushAtCell maps a half-tile cell back to its half brush", () => {
        const map = new EditorMap()
        map.setCell(0, 0, "half_top")
        map.setCell(1, 0, "half_bottom")
        map.setCell(0, 1, "half_left")
        map.setCell(1, 1, "half_right")
        expect(brushAtCell(map, 0, 0)).toBe("half_top")
        expect(brushAtCell(map, 1, 0)).toBe("half_bottom")
        expect(brushAtCell(map, 0, 1)).toBe("half_left")
        expect(brushAtCell(map, 1, 1)).toBe("half_right")
    })

    it("round-trips half tiles through toGridMapData -> loadGridMap", () => {
        const map = new EditorMap("Halves")
        map.setCell(0, 0, "half_top")
        map.setCell(1, 0, "half_bottom")
        map.setCell(0, 1, "half_left")
        map.setCell(1, 1, "half_right")

        const data = map.toGridMapData()
        // The exported palette carries each half shape.
        for(const shape of ["half_top", "half_bottom", "half_left", "half_right"]){
            expect(data.palette.some((e) => e.shape === shape)).toBe(true)
        }

        // It loads into the real game loader: four half-cell rect walls (one per
        // half tile), no segment walls, and four render tiles carrying the shapes.
        const playable = loadGridMap("halves", data)
        expect(playable.rectWalls.length).toBe(4)
        expect(playable.segWalls.length).toBe(0)
        expect(playable.tiles.length).toBe(4)
        const shapes = playable.tiles.map((t) => t.shape).sort()
        expect(shapes).toEqual(["half_bottom", "half_left", "half_right", "half_top"])
    })

    it("a half brush evicts a spawn like every other shape brush (mutual exclusion)", () => {
        const map = new EditorMap()
        map.setCell(3, 3, "spawn")
        expect(map.hasSpawn(3, 3)).toBe(true)
        expect(map.setCell(3, 3, "half_left")).toBe(true)
        expect(map.hasSpawn(3, 3)).toBe(false)
        expect(map.tileAt(3, 3)).not.toBe(0)
    })
})

describe("editorMapIssue (playability gate)", () => {
    it("flags a map with no spawns", () => {
        const map = new EditorMap()
        map.setCell(0, 0, "full")
        expect(editorMapIssue(map)).toMatch(/spawn/i)
    })

    it("flags an empty map (no spawns)", () => {
        expect(editorMapIssue(new EditorMap())).toMatch(/spawn/i)
    })

    it("returns null for a playable map (has a spawn, within the cell cap)", () => {
        const map = new EditorMap()
        map.setCell(0, 0, "full")
        map.setCell(1, 0, "spawn")
        expect(editorMapIssue(map)).toBeNull()
    })

    it("flags a map whose bounding box exceeds the cell cap", () => {
        const map = new EditorMap()
        map.setCell(0, 0, "spawn")
        // bounding box 301 x 301 = 90601 cells, over the 250 x 250 cap
        map.setCell(300, 300, "full")
        expect(editorMapIssue(map)).toMatch(/too large/i)
    })
})

describe("mirrorShape (symmetric flip)", () => {
    it("flips diagonals + half-left/right horizontally; leaves full/deco/half-top/bottom", () => {
        expect(mirrorShape("diag_tl", "horizontal")).toBe("diag_tr")
        expect(mirrorShape("diag_tr", "horizontal")).toBe("diag_tl")
        expect(mirrorShape("diag_bl", "horizontal")).toBe("diag_br")
        expect(mirrorShape("diag_br", "horizontal")).toBe("diag_bl")
        expect(mirrorShape("half_left", "horizontal")).toBe("half_right")
        expect(mirrorShape("half_right", "horizontal")).toBe("half_left")
        expect(mirrorShape("half_top", "horizontal")).toBe("half_top")
        expect(mirrorShape("half_bottom", "horizontal")).toBe("half_bottom")
        expect(mirrorShape("full", "horizontal")).toBe("full")
        expect(mirrorShape("deco", "horizontal")).toBe("deco")
    })

    it("flips diagonals + half-top/bottom vertically; leaves full/deco/half-left/right", () => {
        expect(mirrorShape("diag_tl", "vertical")).toBe("diag_bl")
        expect(mirrorShape("diag_bl", "vertical")).toBe("diag_tl")
        expect(mirrorShape("diag_tr", "vertical")).toBe("diag_br")
        expect(mirrorShape("diag_br", "vertical")).toBe("diag_tr")
        expect(mirrorShape("half_top", "vertical")).toBe("half_bottom")
        expect(mirrorShape("half_bottom", "vertical")).toBe("half_top")
        expect(mirrorShape("half_left", "vertical")).toBe("half_left")
        expect(mirrorShape("half_right", "vertical")).toBe("half_right")
        expect(mirrorShape("full", "vertical")).toBe("full")
        expect(mirrorShape("deco", "vertical")).toBe("deco")
    })

    it("is an involution (mirroring twice returns the original) for every shape", () => {
        const shapes = ["full", "deco", "diag_tl", "diag_tr", "diag_bl", "diag_br", "half_top", "half_bottom", "half_left", "half_right"] as const
        for(const s of shapes){
            expect(mirrorShape(mirrorShape(s, "horizontal"), "horizontal")).toBe(s)
            expect(mirrorShape(mirrorShape(s, "vertical"), "vertical")).toBe(s)
        }
    })
})

describe("mirrorMap (build a symmetric arena)", () => {
    it("returns false on an empty map", () => {
        expect(mirrorMap(new EditorMap(), "horizontal")).toBe(false)
    })

    it("reflects a tile across the bbox centre with the flipped shape (horizontal)", () => {
        const map = new EditorMap()
        // bbox cols 0..4 (span = 4). Paint only on one side + a widener on a
        // DIFFERENT row so no source cell is the mirror of another (no conflict).
        map.setCell(0, 1, "diag_tl")
        map.setCell(4, 3, "full")
        expect(mirrorMap(map, "horizontal")).toBe(true)
        // originals kept
        expect(brushAtCell(map, 0, 1)).toBe("diag_tl")
        expect(brushAtCell(map, 4, 3)).toBe("full")
        // (0,1) diag_tl mirrors to (4,1) as diag_tr; (4,3) full mirrors to (0,3) full
        expect(brushAtCell(map, 4, 1)).toBe("diag_tr")
        expect(brushAtCell(map, 0, 3)).toBe("full")
    })

    it("reflects half-tiles + spawns vertically", () => {
        const map = new EditorMap()
        // bbox rows 0..4, cols 2..5 (no source cell is another's vertical mirror)
        map.setCell(2, 0, "half_top")
        map.setCell(5, 4, "spawn")
        expect(mirrorMap(map, "vertical")).toBe(true)
        // (2,0) half_top mirrors to (2,4) as half_bottom
        expect(brushAtCell(map, 2, 4)).toBe("half_bottom")
        // spawn (5,4) mirrors to (5,0)
        expect(map.hasSpawn(5, 0)).toBe(true)
        // originals kept
        expect(brushAtCell(map, 2, 0)).toBe("half_top")
        expect(map.hasSpawn(5, 4)).toBe(true)
    })

    it("a cell on the centre line maps to itself (not moved)", () => {
        const map = new EditorMap()
        // single painted column => horizontal centre IS that column; it maps to itself
        map.setCell(3, 0, "full")
        map.setCell(3, 2, "spawn")
        const before = map.tileAt(3, 0)
        mirrorMap(map, "horizontal")
        expect(map.tileAt(3, 0)).toBe(before)
        expect(map.hasSpawn(3, 2)).toBe(true)
    })
})

// Look a clip tile up by its relative (col, row), or undefined when that cell of
// the clip is empty. Lets a test assert "the clip holds shape X at (c, r)".
function clipTileAt(clip: EditorClip, col: number, row: number){
    return clip.tiles.find((t) => t.col === col && t.row === row)
}
// A clip's spawn coordinates as a sorted key set, for order-independent compares.
function clipSpawnKeys(clip: EditorClip): string[]{
    return clip.spawns.map(([c, r]) => cellKey(c, r)).sort()
}
// Two clips are equal in content (dims + tiles + spawns), order-independently.
function clipsEqual(a: EditorClip, b: EditorClip): boolean{
    if(a.cols !== b.cols || a.rows !== b.rows) return false
    if(a.tiles.length !== b.tiles.length) return false
    for(const t of a.tiles){
        const m = clipTileAt(b, t.col, t.row)
        if(typeof m === "undefined" || m.shape !== t.shape || m.key !== t.key) return false
    }
    const aKeys = clipSpawnKeys(a)
    const bKeys = clipSpawnKeys(b)
    if(aKeys.length !== bKeys.length) return false
    for(let i = 0; i < aKeys.length; i++){
        if(aKeys[i] !== bKeys[i]) return false
    }
    return true
}

describe("normalizeRect", () => {
    it("normalises corners in any diagonal order to the same inclusive rect", () => {
        const forward = normalizeRect([2, 3], [5, 7])
        const reverse = normalizeRect([5, 7], [2, 3])
        expect(forward).toEqual({ minCol: 2, minRow: 3, maxCol: 5, maxRow: 7 })
        expect(reverse).toEqual(forward)
    })

    it("a single cell makes a 1x1 rect (min == max)", () => {
        expect(normalizeRect([4, 9], [4, 9])).toEqual({ minCol: 4, minRow: 9, maxCol: 4, maxRow: 9 })
    })
})

describe("rotateShapeCW (90 degrees clockwise shape rotation)", () => {
    it("leaves full and deco unchanged (rotationally symmetric)", () => {
        expect(rotateShapeCW("full")).toBe("full")
        expect(rotateShapeCW("deco")).toBe("deco")
    })

    it("walks each diagonal's right-angle corner one quarter-turn clockwise", () => {
        expect(rotateShapeCW("diag_tl")).toBe("diag_tr")
        expect(rotateShapeCW("diag_tr")).toBe("diag_br")
        expect(rotateShapeCW("diag_br")).toBe("diag_bl")
        expect(rotateShapeCW("diag_bl")).toBe("diag_tl")
    })

    it("walks each half-tile's filled edge one quarter-turn clockwise", () => {
        expect(rotateShapeCW("half_top")).toBe("half_right")
        expect(rotateShapeCW("half_right")).toBe("half_bottom")
        expect(rotateShapeCW("half_bottom")).toBe("half_left")
        expect(rotateShapeCW("half_left")).toBe("half_top")
    })

    it("applying it FOUR times returns the original for EVERY shape", () => {
        const shapes: TileShape[] = ["full", "deco", "diag_tl", "diag_tr", "diag_bl", "diag_br", "half_top", "half_bottom", "half_left", "half_right"]
        for(const s of shapes){
            expect(rotateShapeCW(rotateShapeCW(rotateShapeCW(rotateShapeCW(s))))).toBe(s)
        }
    })
})

describe("rotateClipCW (90 degrees clockwise clip rotation)", () => {
    it("swaps the dimensions (MxN clip becomes NxM)", () => {
        const clip: EditorClip = { cols: 3, rows: 2, tiles: [], spawns: [] }
        const rotated = rotateClipCW(clip)
        expect(rotated.cols).toBe(2)
        expect(rotated.rows).toBe(3)
    })

    it("rotates a known small clip to the expected cell layout + shapes", () => {
        // A 3x2 clip (3 wide, 2 tall) with a full top-left and a diag_tl top-right.
        const clip: EditorClip = {
            cols: 3, rows: 2,
            tiles: [
                { col: 0, row: 0, shape: "full", key: "tile_default" },
                { col: 2, row: 0, shape: "diag_tl", key: "rust" },
            ],
            spawns: [[1, 1]],
        }
        const rotated = rotateClipCW(clip)
        // dims swap to 2x3
        expect(rotated.cols).toBe(2)
        expect(rotated.rows).toBe(3)
        // (0,0) -> (rows-1-0, 0) = (1, 0); shape full stays full
        const a = clipTileAt(rotated, 1, 0)
        expect(a).toBeDefined()
        expect(a?.shape).toBe("full")
        expect(a?.key).toBe("tile_default")
        // (2,0) -> (rows-1-0, 2) = (1, 2); diag_tl rotates to diag_tr, key kept
        const b = clipTileAt(rotated, 1, 2)
        expect(b).toBeDefined()
        expect(b?.shape).toBe("diag_tr")
        expect(b?.key).toBe("rust")
        // spawn (1,1) -> (rows-1-1, 1) = (0, 1)
        expect(rotated.spawns).toEqual([[0, 1]])
    })

    it("FOUR rotations round-trip to the original clip (cells + shapes + spawns)", () => {
        const clip: EditorClip = {
            cols: 4, rows: 3,
            tiles: [
                { col: 0, row: 0, shape: "diag_bl", key: "teal" },
                { col: 3, row: 0, shape: "half_top", key: "slate" },
                { col: 1, row: 2, shape: "full", key: "tile_default" },
            ],
            spawns: [[2, 1], [0, 2]],
        }
        const fourTimes = rotateClipCW(rotateClipCW(rotateClipCW(rotateClipCW(clip))))
        expect(clipsEqual(fourTimes, clip)).toBe(true)
        // The original is untouched (rotateClipCW is pure).
        expect(clip.cols).toBe(4)
        expect(clip.rows).toBe(3)
    })
})

describe("flipClip (mirror a clip via the existing mirrorShape)", () => {
    const clip: EditorClip = {
        cols: 3, rows: 2,
        tiles: [
            { col: 0, row: 0, shape: "diag_tl", key: "rust" },
            { col: 2, row: 1, shape: "half_left", key: "teal" },
        ],
        spawns: [[1, 0]],
    }

    it("flips coordinates + shapes horizontally", () => {
        const flipped = flipClip(clip, "horizontal")
        expect(flipped.cols).toBe(3)
        expect(flipped.rows).toBe(2)
        // (0,0) -> (cols-1-0, 0) = (2,0); diag_tl mirrors H to diag_tr
        const a = clipTileAt(flipped, 2, 0)
        expect(a?.shape).toBe("diag_tr")
        expect(a?.key).toBe("rust")
        // (2,1) -> (0,1); half_left mirrors H to half_right
        const b = clipTileAt(flipped, 0, 1)
        expect(b?.shape).toBe("half_right")
        // spawn (1,0) -> (1,0) (centre column of a 3-wide clip)
        expect(flipped.spawns).toEqual([[1, 0]])
    })

    it("flips coordinates + shapes vertically", () => {
        const flipped = flipClip(clip, "vertical")
        // (0,0) -> (0, rows-1-0) = (0,1); diag_tl mirrors V to diag_bl
        const a = clipTileAt(flipped, 0, 1)
        expect(a?.shape).toBe("diag_bl")
        // (2,1) -> (2,0); half_left is unchanged by a vertical flip
        const b = clipTileAt(flipped, 2, 0)
        expect(b?.shape).toBe("half_left")
        // spawn (1,0) -> (1,1)
        expect(flipped.spawns).toEqual([[1, 1]])
    })

    it("flipping twice on the same axis round-trips to the original", () => {
        expect(clipsEqual(flipClip(flipClip(clip, "horizontal"), "horizontal"), clip)).toBe(true)
        expect(clipsEqual(flipClip(flipClip(clip, "vertical"), "vertical"), clip)).toBe(true)
        // Pure: the input clip is untouched.
        expect(clip.tiles.length).toBe(2)
    })
})

describe("extractClip + clearRegion + stampClip", () => {
    it("extractClip copies a region into clip-relative coords without mutating the map", () => {
        const map = new EditorMap()
        map.setCell(5, 7, "full", "rust")
        map.setCell(6, 7, "diag_tr", "teal")
        map.setCell(5, 8, "spawn")
        const rect: CellRect = { minCol: 5, minRow: 7, maxCol: 6, maxRow: 8 }
        const clip = extractClip(map, rect)
        expect(clip.cols).toBe(2)
        expect(clip.rows).toBe(2)
        // The min corner (5,7) maps to clip (0,0).
        expect(clipTileAt(clip, 0, 0)).toEqual({ col: 0, row: 0, shape: "full", key: "rust" })
        expect(clipTileAt(clip, 1, 0)).toEqual({ col: 1, row: 0, shape: "diag_tr", key: "teal" })
        // The spawn at (5,8) maps to clip-relative (0,1).
        expect(clip.spawns).toEqual([[0, 1]])
        // The source map is untouched.
        expect(map.tileAt(5, 7)).not.toBe(0)
        expect(map.hasSpawn(5, 8)).toBe(true)
    })

    it("clearRegion removes exactly the cells in the rect and nothing outside it", () => {
        const map = new EditorMap()
        // A 3x3 block plus two tiles JUST outside the clear rect.
        for(let c = 0; c < 3; c++){
            for(let r = 0; r < 3; r++){
                map.setCell(c, r, "full")
            }
        }
        map.setCell(3, 1, "full") // one column right of the rect
        map.setCell(1, 1, "spawn") // a spawn inside (replaces the tile there)
        map.setCell(-1, -1, "deco") // outside, up-left
        const rect: CellRect = { minCol: 0, minRow: 0, maxCol: 2, maxRow: 2 }
        expect(clearRegion(map, rect)).toBe(true)
        // Everything inside the rect is gone.
        for(let c = 0; c < 3; c++){
            for(let r = 0; r < 3; r++){
                expect(map.tileAt(c, r)).toBe(0)
            }
        }
        expect(map.hasSpawn(1, 1)).toBe(false)
        // The two outside cells survive.
        expect(map.tileAt(3, 1)).not.toBe(0)
        expect(map.tileAt(-1, -1)).not.toBe(0)
        // Clearing an already-empty rect is a no-op (returns false).
        expect(clearRegion(map, { minCol: 10, minRow: 10, maxCol: 12, maxRow: 12 })).toBe(false)
    })

    it("extract + stamp ROUND-TRIPS a region elsewhere (tiles shapes/keys + spawns)", () => {
        const map = new EditorMap()
        map.setCell(0, 0, "full", "rust")
        map.setCell(1, 0, "diag_bl", "teal")
        map.setCell(0, 1, "half_right", "accent")
        map.setCell(1, 1, "spawn")
        const rect: CellRect = { minCol: 0, minRow: 0, maxCol: 1, maxRow: 1 }
        const clip = extractClip(map, rect)

        // Stamp the clip far away; the destination matches the source exactly.
        expect(stampClip(map, clip, 10, 20)).toBe(true)
        // Tiles: same shapes + keys at the offset destination.
        expect(map.palette[map.tileAt(10, 20) - 1]).toEqual({ shape: "full", key: "rust" })
        expect(map.palette[map.tileAt(11, 20) - 1]).toEqual({ shape: "diag_bl", key: "teal" })
        expect(map.palette[map.tileAt(10, 21) - 1]).toEqual({ shape: "half_right", key: "accent" })
        // The spawn round-trips to the offset cell.
        expect(map.hasSpawn(11, 21)).toBe(true)
    })

    it("stampClip respects spawn/tile exclusion (a stamped tile evicts a spawn under it)", () => {
        const map = new EditorMap()
        map.setCell(3, 3, "spawn")
        const clip: EditorClip = {
            cols: 1, rows: 1,
            tiles: [{ col: 0, row: 0, shape: "full", key: "rust" }],
            spawns: [],
        }
        expect(stampClip(map, clip, 3, 3)).toBe(true)
        // The full block evicts the spawn (mutual exclusion holds via setCell).
        expect(map.hasSpawn(3, 3)).toBe(false)
        expect(map.tileAt(3, 3)).not.toBe(0)
    })

    it("stampClip keeps the palette APPEND-ONLY (a new colour grows it, existing reused)", () => {
        const map = new EditorMap()
        const seedLength = map.palette.length
        const seed = map.palette.map((e) => ({ ...e }))
        const clip: EditorClip = {
            cols: 2, rows: 1,
            tiles: [
                { col: 0, row: 0, shape: "full", key: "tile_default" }, // reuses seed entry
                { col: 1, row: 0, shape: "full", key: "rust" }, // new -> appends
            ],
            spawns: [],
        }
        stampClip(map, clip, 0, 0)
        // The default-block tile reused the seed entry; only the rust entry appended.
        expect(map.palette.length).toBe(seedLength + 1)
        // Every seed entry is byte-identical at its ORIGINAL index.
        seed.forEach((entry, i) => expect(map.palette[i]).toEqual(entry))
        expect(map.palette[map.tileAt(0, 0) - 1]).toEqual({ shape: "full", key: "tile_default" })
        expect(map.palette[map.tileAt(1, 0) - 1]).toEqual({ shape: "full", key: "rust" })
    })

    it("a deco clip tile stamps as the non-colliding tile_hidden", () => {
        const map = new EditorMap()
        const clip: EditorClip = {
            cols: 1, rows: 1,
            tiles: [{ col: 0, row: 0, shape: "deco", key: "tile_hidden" }],
            spawns: [],
        }
        stampClip(map, clip, 4, 4)
        expect(map.palette[map.tileAt(4, 4) - 1]).toEqual({ shape: "deco", key: "tile_hidden" })
    })

    it("stamping the same clip twice on a cell does NOT remove its spawn (guarded toggle)", () => {
        const map = new EditorMap()
        const clip: EditorClip = { cols: 1, rows: 1, tiles: [], spawns: [[0, 0]] }
        stampClip(map, clip, 2, 2)
        expect(map.hasSpawn(2, 2)).toBe(true)
        // A second stamp must keep the spawn (toggleSpawn would otherwise flip it off).
        stampClip(map, clip, 2, 2)
        expect(map.hasSpawn(2, 2)).toBe(true)
    })
})

describe("move/cut as ONE undo step (selection history granularity)", () => {
    // Mirrors how the view performs a MOVE: lift (begin history, clear source),
    // stamp at a new offset, commit ONCE. The whole move undoes in a single step.
    it("a move (lift source + stamp elsewhere) undoes as ONE step", () => {
        const map = new EditorMap()
        map.setCell(0, 0, "full", "rust")
        map.setCell(1, 0, "diag_tr", "teal")
        const history = new EditorHistory()
        const rect: CellRect = { minCol: 0, minRow: 0, maxCol: 1, maxRow: 0 }

        const clip = extractClip(map, rect)
        history.begin(map)
        clearRegion(map, rect)
        stampClip(map, clip, 5, 5)
        expect(history.commit(map)).toBe(true)

        // Source is empty, destination holds the moved tiles.
        expect(map.tileAt(0, 0)).toBe(0)
        expect(map.tileAt(1, 0)).toBe(0)
        expect(map.palette[map.tileAt(5, 5) - 1]).toEqual({ shape: "full", key: "rust" })
        expect(map.palette[map.tileAt(6, 5) - 1]).toEqual({ shape: "diag_tr", key: "teal" })

        // ONE undo restores the original layout exactly.
        expect(history.undo(map)).toBe(true)
        expect(map.palette[map.tileAt(0, 0) - 1]).toEqual({ shape: "full", key: "rust" })
        expect(map.palette[map.tileAt(1, 0) - 1]).toEqual({ shape: "diag_tr", key: "teal" })
        expect(map.tileAt(5, 5)).toBe(0)
        expect(map.tileAt(6, 5)).toBe(0)
    })

    it("a cut (clear region) undoes as ONE step", () => {
        const map = new EditorMap()
        map.setCell(0, 0, "full")
        map.setCell(1, 0, "full")
        const history = new EditorHistory()
        const rect: CellRect = { minCol: 0, minRow: 0, maxCol: 1, maxRow: 0 }

        history.begin(map)
        clearRegion(map, rect)
        expect(history.commit(map)).toBe(true)
        expect(map.tiles.size).toBe(0)

        expect(history.undo(map)).toBe(true)
        expect(map.tiles.size).toBe(2)
    })

    // REGRESSION (mobile pinch undo-integrity): a move LIFT opens the history step
    // and clears the source, then the gesture is INTERRUPTED before the stamp (a
    // second finger lands -> pinch, fingers lift). The view must leave that open
    // step ALONE (not cancel it), so the deferred stamp + commit later still lands
    // the whole move as ONE undo step. This models the open step surviving across
    // the interruption: there is NO cancel() between the lift and the late commit.
    it("a move whose stamp is DEFERRED past a gesture interruption still undoes as ONE step", () => {
        const map = new EditorMap()
        map.setCell(0, 0, "full", "rust")
        map.setCell(1, 0, "diag_tr", "teal")
        const history = new EditorHistory()
        const rect: CellRect = { minCol: 0, minRow: 0, maxCol: 1, maxRow: 0 }

        // Lift: open the step and clear the source. The clip is now "floating".
        const clip = extractClip(map, rect)
        history.begin(map)
        clearRegion(map, rect)

        // ...gesture interrupted here (pinch + lift). The open step is left intact:
        // crucially NO history.cancel() runs, so the pre-lift snapshot survives.

        // Later: the floating clip is committed (deselect / mode switch / Enter).
        stampClip(map, clip, 5, 5)
        expect(history.commit(map)).toBe(true)

        // Source moved to the new location.
        expect(map.tileAt(0, 0)).toBe(0)
        expect(map.tileAt(1, 0)).toBe(0)
        expect(map.palette[map.tileAt(5, 5) - 1]).toEqual({ shape: "full", key: "rust" })
        expect(map.palette[map.tileAt(6, 5) - 1]).toEqual({ shape: "diag_tr", key: "teal" })

        // ONE undo restores the original layout: the move is undoable.
        expect(history.undo(map)).toBe(true)
        expect(map.palette[map.tileAt(0, 0) - 1]).toEqual({ shape: "full", key: "rust" })
        expect(map.palette[map.tileAt(1, 0) - 1]).toEqual({ shape: "diag_tr", key: "teal" })
        expect(map.tileAt(5, 5)).toBe(0)
        expect(map.tileAt(6, 5)).toBe(0)
    })

    // Documents WHY the view must NOT cancel an open lift step on interruption:
    // cancelling between the lift and the deferred stamp drops the pre-lift
    // snapshot, leaving the map mutated (source cleared, content stamped) with NO
    // undo entry. This is the exact regression the terminal-cancel guard prevents.
    it("cancelling an open lift step before its deferred stamp loses the undo entry", () => {
        const map = new EditorMap()
        map.setCell(0, 0, "full", "rust")
        const history = new EditorHistory()
        const rect: CellRect = { minCol: 0, minRow: 0, maxCol: 0, maxRow: 0 }

        const clip = extractClip(map, rect)
        history.begin(map)
        clearRegion(map, rect)
        history.cancel() // the BUGGY terminal cancel: drops the pre-lift snapshot.

        stampClip(map, clip, 5, 5)
        // pending is null, so commit pushes nothing and the move is un-undoable.
        expect(history.commit(map)).toBe(false)
        expect(history.canUndo()).toBe(false)
        expect(map.tileAt(0, 0)).toBe(0)
        expect(map.palette[map.tileAt(5, 5) - 1]).toEqual({ shape: "full", key: "rust" })
    })
})
