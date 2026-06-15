import { describe, expect, it } from "vitest"
import {
    EditorMap,
    EditorHistory,
    EditorBrush,
    Cell,
    CellRect,
    EditorClip,
    rectCells,
    lineCells,
    boundedFloodFill,
    mirrorMap,
    extractClip,
    clearRegion,
    stampClip,
    rotateClipCW,
    flipClip,
    brushAtCell,
    materialAtCell,
    snapshotEditorMap,
    snapshotsEqual,
} from "../../packages/client/src/game/mapEditor"

// UNDO / REDO coverage for EVERY editor tool. The pure model (mapEditor.ts) owns
// both the map mutations and the EditorHistory; the view (views/MapEditor.tsx)
// only BRACKETS each tool's mutation with history.begin(map) before the gesture
// and history.commit(map) after it, so one gesture = one undo step. These tests
// REPLAY that exact begin -> op -> commit sequence per tool (no DOM, no React) and
// assert: the map CHANGED, undo reverts to a byte-equal pre-op state, redo
// re-applies the post-op state, a new edit invalidates the redo stack, the pure
// READ tools (eyedropper / pick) create NO step, and a genuine no-op commits none.

// A comparable, order-independent DUMP of a map's undoable content (tiles +
// spawns), so two states can be compared byte-for-byte regardless of insertion
// order. Tiles are sorted "col,row=value" strings and spawns are sorted "col,row"
// strings, joined into one canonical string. snapshotsEqual already compares
// content order-independently; this gives a readable, deep-equality-friendly form
// for expect(...).toEqual and for asserting two dumps differ.
function dumpMap(map: EditorMap): { tiles: string[], spawns: string[] }{
    const tiles = Array.from(map.tiles.entries())
        .map(([key, value]) => `${key}=${value}`)
        .sort()
    const spawns = map.spawns
        .map(([col, row]) => `${col},${row}`)
        .sort()
    return { tiles, spawns }
}

// Are two map dumps identical? A thin wrapper so a test reads as "the map is the
// SAME as the snapshot" rather than re-deriving the comparison each time.
function dumpsEqual(a: ReturnType<typeof dumpMap>, b: ReturnType<typeof dumpMap>): boolean{
    if(a.tiles.length !== b.tiles.length) return false
    if(a.spawns.length !== b.spawns.length) return false
    for(let i = 0; i < a.tiles.length; i++){
        if(a.tiles[i] !== b.tiles[i]) return false
    }
    for(let i = 0; i < a.spawns.length; i++){
        if(a.spawns[i] !== b.spawns[i]) return false
    }
    return true
}

// Run a tool's edit EXACTLY as the view brackets it (begin -> mutate -> commit),
// asserting the canonical undo/redo contract for ONE history step:
//   1. the map CHANGED from its pre-op dump,
//   2. the op committed exactly ONE step (canUndo flips true, past grows by 1),
//   3. undo restores a BYTE-EQUAL copy of the pre-op dump,
//   4. redo re-applies the post-op dump exactly,
//   5. after redo, one more undo + redo still round-trips (the step is stable).
// `mutate` performs the tool's map mutation(s) between begin and commit; it is
// passed the live map so it can call setCell / clearRegion / stampClip / etc. The
// helper owns the history bracketing so each test body stays the tool's mutation.
function assertOneStepRoundTrip(
    map: EditorMap,
    history: EditorHistory,
    mutate: (map: EditorMap) => void,
){
    const before = dumpMap(map)
    expect(history.canUndo()).toBe(false)

    history.begin(map)
    mutate(map)
    const committed = history.commit(map)
    const after = dumpMap(map)

    // The op must actually change the map and commit exactly one step.
    expect(committed).toBe(true)
    expect(dumpsEqual(before, after)).toBe(false)
    expect(history.canUndo()).toBe(true)
    expect(history.canRedo()).toBe(false)

    // Undo fully reverts to the pre-op state, byte-for-byte.
    expect(history.undo(map)).toBe(true)
    expect(dumpMap(map)).toEqual(before)
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(true)

    // Redo fully re-applies the post-op state.
    expect(history.redo(map)).toBe(true)
    expect(dumpMap(map)).toEqual(after)

    // The step is stable: another undo/redo cycle round-trips identically.
    expect(history.undo(map)).toBe(true)
    expect(dumpMap(map)).toEqual(before)
    expect(history.redo(map)).toBe(true)
    expect(dumpMap(map)).toEqual(after)
}

// A small map with some known content: a horizontal wall, a couple of spawns, and
// a deco tile, so transforms / selections have something to act on. Mutating this
// returns a FRESH map per test so no test leaks state into another.
function seededMap(): EditorMap{
    const map = new EditorMap()
    map.setCell(0, 0, "full")
    map.setCell(1, 0, "full")
    map.setCell(2, 0, "full")
    map.setCell(0, 1, "deco")
    map.toggleSpawn(3, 3)
    map.toggleSpawn(4, 3)
    return map
}

describe("freehand stroke", () => {
    it("undoes and redoes a multi-cell freehand stroke as one step", () => {
        const map = new EditorMap()
        const history = new EditorHistory()
        // The view paints each cell along lineCells(last, current) via setCell while
        // dragging; replay that as one begin -> setCell* -> commit gesture.
        assertOneStepRoundTrip(map, history, (m) => {
            for(const [col, row] of lineCells([0, 0], [4, 2])){
                m.setCell(col, row, "full")
            }
        })
    })
})

describe("rectangle", () => {
    it("undoes and redoes a filled rectangle as one step", () => {
        const map = new EditorMap()
        const history = new EditorHistory()
        // rect mode: applyCells(rectCells(start, end)) under one history step.
        assertOneStepRoundTrip(map, history, (m) => {
            for(const [col, row] of rectCells([1, 1], [4, 3])){
                m.setCell(col, row, "full")
            }
        })
    })
})

describe("line", () => {
    it("undoes and redoes a straight line as one step", () => {
        const map = new EditorMap()
        const history = new EditorHistory()
        // line mode: applyCells(lineCells(start, end)) under one history step.
        assertOneStepRoundTrip(map, history, (m) => {
            for(const [col, row] of lineCells([0, 0], [6, 3])){
                m.setCell(col, row, "full")
            }
        })
    })
})

describe("flood fill", () => {
    it("undoes and redoes a bounded flood fill as one step", () => {
        // Paint a small wall so the fill has content + a bbox to clamp against, then
        // fill the empty region next to it. The view computes the fill cells via
        // boundedFloodFill(start, tileAt, fillClamp) then applies them in one step.
        const map = new EditorMap()
        map.setCell(0, 0, "full")
        map.setCell(0, 1, "full")
        const history = new EditorHistory()
        assertOneStepRoundTrip(map, history, (m) => {
            const start: Cell = [2, 2]
            const cells = boundedFloodFill(start, (c, r) => m.tileAt(c, r), m.fillClamp(start))
            for(const [col, row] of cells){
                m.setCell(col, row, "full")
            }
        })
    })
})

describe("spawn toggle", () => {
    it("undoes and redoes a spawn toggle as one step", () => {
        const map = new EditorMap()
        const history = new EditorHistory()
        // spawn brush: begin -> toggleSpawn (via setCell("spawn")) -> commit.
        assertOneStepRoundTrip(map, history, (m) => {
            m.setCell(5, 5, "spawn")
        })
    })

    it("undoes a spawn that evicted a tile, restoring the tile", () => {
        // A spawn dropped on a tile cell removes the tile (mutual exclusion). Undo
        // must bring the tile back, not just remove the spawn.
        const map = new EditorMap()
        map.setCell(2, 2, "full")
        const history = new EditorHistory()
        const before = dumpMap(map)
        history.begin(map)
        map.setCell(2, 2, "spawn")
        expect(history.commit(map)).toBe(true)
        expect(map.hasSpawn(2, 2)).toBe(true)
        expect(map.tileAt(2, 2)).toBe(0)
        history.undo(map)
        expect(dumpMap(map)).toEqual(before)
        expect(map.tileAt(2, 2)).toBeGreaterThan(0)
        expect(map.hasSpawn(2, 2)).toBe(false)
    })
})

describe("half tile", () => {
    const halves: EditorBrush[] = ["half_top", "half_bottom", "half_left", "half_right"]
    for(const brush of halves){
        it(`undoes and redoes painting a ${brush} half tile as one step`, () => {
            const map = new EditorMap()
            const history = new EditorHistory()
            assertOneStepRoundTrip(map, history, (m) => {
                m.setCell(1, 1, brush)
            })
        })
    }
})

describe("slope / auto-slope", () => {
    const slopes: EditorBrush[] = ["diag_tl", "diag_tr", "diag_bl", "diag_br"]
    for(const brush of slopes){
        it(`undoes and redoes an explicit ${brush} slope as one step`, () => {
            const map = new EditorMap()
            const history = new EditorHistory()
            assertOneStepRoundTrip(map, history, (m) => {
                m.setCell(2, 2, brush)
            })
        })
    }

    it("undoes and redoes an auto slope (resolved from neighbours) as one step", () => {
        // auto resolves to a concrete diagonal from the cell's full neighbours: a
        // full block above and to the left of (1,1) makes auto pick diag_tl. The
        // whole begin -> setCell(auto) -> commit is one step.
        const map = new EditorMap()
        map.setCell(1, 0, "full")
        map.setCell(0, 1, "full")
        const history = new EditorHistory()
        assertOneStepRoundTrip(map, history, (m) => {
            m.setCell(1, 1, "auto")
        })
    })
})

describe("mirror", () => {
    it("undoes and redoes a horizontal mirror as one step", () => {
        const map = seededMap()
        const history = new EditorHistory()
        // mirror tool: begin -> mirrorMap(map, axis) -> commit.
        assertOneStepRoundTrip(map, history, (m) => {
            mirrorMap(m, "horizontal")
        })
    })

    it("undoes and redoes a vertical mirror as one step", () => {
        const map = seededMap()
        const history = new EditorHistory()
        assertOneStepRoundTrip(map, history, (m) => {
            mirrorMap(m, "vertical")
        })
    })
})

describe("selection: move", () => {
    it("undoes and redoes a move (lift + clear + stamp) as one step", () => {
        // The view's move drag: begin -> extractClip + clearRegion (lift) -> stampClip
        // at the drop offset (commit). The lift opens the step, the stamp closes it,
        // so the whole move is ONE undo step.
        const map = seededMap()
        const history = new EditorHistory()
        const sel: CellRect = { minCol: 0, minRow: 0, maxCol: 2, maxRow: 0 }
        assertOneStepRoundTrip(map, history, (m) => {
            const clip = extractClip(m, sel)
            clearRegion(m, sel)
            // Drop two cells down and one right of the original top-left.
            stampClip(m, clip, sel.minCol + 1, sel.minRow + 2)
        })
    })
})

describe("selection: rotate", () => {
    it("undoes and redoes a rotate (lift + rotate + stamp) as one step", () => {
        // rotate acts on the floating clip: lift the selection, rotate the clip CW,
        // then stamp it back at the selection's top-left, all under one step.
        const map = seededMap()
        const history = new EditorHistory()
        const sel: CellRect = { minCol: 0, minRow: 0, maxCol: 2, maxRow: 1 }
        assertOneStepRoundTrip(map, history, (m) => {
            const clip = extractClip(m, sel)
            clearRegion(m, sel)
            stampClip(m, rotateClipCW(clip), sel.minCol, sel.minRow)
        })
    })
})

describe("selection: flip", () => {
    it("undoes and redoes a horizontal flip (lift + flip + stamp) as one step", () => {
        const map = seededMap()
        const history = new EditorHistory()
        const sel: CellRect = { minCol: 0, minRow: 0, maxCol: 2, maxRow: 1 }
        assertOneStepRoundTrip(map, history, (m) => {
            const clip = extractClip(m, sel)
            clearRegion(m, sel)
            stampClip(m, flipClip(clip, "horizontal"), sel.minCol, sel.minRow)
        })
    })

    it("undoes and redoes a vertical flip (lift + flip + stamp) as one step", () => {
        const map = seededMap()
        const history = new EditorHistory()
        const sel: CellRect = { minCol: 0, minRow: 0, maxCol: 2, maxRow: 1 }
        assertOneStepRoundTrip(map, history, (m) => {
            const clip = extractClip(m, sel)
            clearRegion(m, sel)
            stampClip(m, flipClip(clip, "vertical"), sel.minCol, sel.minRow)
        })
    })
})

describe("selection: cut", () => {
    it("undoes and redoes a cut (clearRegion) as one step", () => {
        // cut copies the region to the clipboard (no map change) then clears it as
        // one step. Only the clear is undoable; replay begin -> clearRegion -> commit.
        const map = seededMap()
        const history = new EditorHistory()
        const sel: CellRect = { minCol: 0, minRow: 0, maxCol: 2, maxRow: 0 }
        // The clipboard copy itself mutates nothing, so it sits outside the step.
        const clipboard: EditorClip = extractClip(map, sel)
        expect(clipboard.tiles.length).toBeGreaterThan(0)
        assertOneStepRoundTrip(map, history, (m) => {
            clearRegion(m, sel)
        })
    })
})

describe("selection: delete", () => {
    it("undoes and redoes a delete (clearRegion of tiles + spawns) as one step", () => {
        // delete clears the selection's content as one step. The region here spans a
        // spawn too, so both tiles and spawns are removed and must come back on undo.
        const map = seededMap()
        const history = new EditorHistory()
        const sel: CellRect = { minCol: 3, minRow: 3, maxCol: 4, maxRow: 3 }
        expect(map.hasSpawn(3, 3)).toBe(true)
        assertOneStepRoundTrip(map, history, (m) => {
            clearRegion(m, sel)
        })
    })
})

describe("selection: paste", () => {
    it("undoes and redoes a paste (stampClip) as one step", () => {
        // paste stamps a clipboard clip into the map at an offset under one step. The
        // clip is built from a separate source region; replay begin -> stampClip ->
        // commit at the paste location.
        const source = new EditorMap()
        source.setCell(0, 0, "full")
        source.setCell(1, 0, "deco")
        source.toggleSpawn(0, 1)
        const clip: EditorClip = extractClip(source, { minCol: 0, minRow: 0, maxCol: 1, maxRow: 1 })

        const map = new EditorMap()
        const history = new EditorHistory()
        assertOneStepRoundTrip(map, history, (m) => {
            stampClip(m, clip, 10, 10)
        })
    })
})

describe("redo stack invalidation", () => {
    it("clears the redo stack when a new edit is committed after an undo", () => {
        const map = new EditorMap()
        const history = new EditorHistory()

        // First edit, then undo it so a redo is available.
        history.begin(map)
        map.setCell(0, 0, "full")
        expect(history.commit(map)).toBe(true)
        expect(history.undo(map)).toBe(true)
        expect(history.canRedo()).toBe(true)

        // A brand-new edit must INVALIDATE the redo (the undone future is dropped).
        history.begin(map)
        map.setCell(9, 9, "full")
        expect(history.commit(map)).toBe(true)
        expect(history.canRedo()).toBe(false)

        // And redo now does nothing (the future was cleared).
        expect(history.redo(map)).toBe(false)
        expect(map.tileAt(0, 0)).toBe(0)
        expect(map.tileAt(9, 9)).toBeGreaterThan(0)
    })
})

describe("eyedropper / pick", () => {
    it("creates NO undo step (canUndo unchanged) and does not mutate the map", () => {
        const map = seededMap()
        const history = new EditorHistory()
        const before = dumpMap(map)
        expect(history.canUndo()).toBe(false)

        // PICK is a pure read: the view calls brushAtCell / materialAtCell and never
        // begins or commits a history step. Reading any cell must not touch history.
        expect(brushAtCell(map, 0, 0)).toBe("full")
        expect(brushAtCell(map, 0, 1)).toBe("deco")
        expect(brushAtCell(map, 3, 3)).toBe("spawn")
        expect(brushAtCell(map, 9, 9)).toBe("empty")
        materialAtCell(map, 0, 0)

        // No begin/commit happened, so history is untouched and the map is byte-equal.
        expect(history.canUndo()).toBe(false)
        expect(history.canRedo()).toBe(false)
        expect(dumpMap(map)).toEqual(before)
    })
})

describe("no-op gestures commit no step", () => {
    it("commits nothing when a freehand stroke repaints identical cells", () => {
        // Paint a block, then a gesture that re-paints the SAME block (no change).
        // snapshotsEqual sees no diff, so commit() returns false and no step lands.
        const map = new EditorMap()
        map.setCell(1, 1, "full")
        const history = new EditorHistory()
        history.begin(map)
        // Re-applying the same brush to the same cell changes nothing.
        expect(map.setCell(1, 1, "full")).toBe(false)
        expect(history.commit(map)).toBe(false)
        expect(history.canUndo()).toBe(false)
    })

    it("commits nothing when an erase gesture hits only empty cells", () => {
        const map = new EditorMap()
        const history = new EditorHistory()
        history.begin(map)
        // Erasing already-empty cells is a no-op across the whole gesture.
        for(const [col, row] of rectCells([0, 0], [3, 3])){
            map.setCell(col, row, "empty")
        }
        expect(history.commit(map)).toBe(false)
        expect(history.canUndo()).toBe(false)
    })

    it("commits nothing when a mirror has no source content", () => {
        // An empty map has nothing to reflect, so mirrorMap changes nothing and the
        // bracketed gesture commits no step.
        const map = new EditorMap()
        const history = new EditorHistory()
        history.begin(map)
        expect(mirrorMap(map, "horizontal")).toBe(false)
        expect(history.commit(map)).toBe(false)
        expect(history.canUndo()).toBe(false)
    })

    it("commits nothing when a cut/delete clears an empty region", () => {
        const map = new EditorMap()
        const history = new EditorHistory()
        history.begin(map)
        expect(clearRegion(map, { minCol: 50, minRow: 50, maxCol: 55, maxRow: 55 })).toBe(false)
        expect(history.commit(map)).toBe(false)
        expect(history.canUndo()).toBe(false)
    })
})

describe("multiple steps stay independent", () => {
    it("undoes a sequence of different tools one step at a time, in reverse order", () => {
        // Three distinct tool gestures in a row; undo must peel them back exactly one
        // at a time, and redo must re-apply them in order. This proves each tool is
        // its OWN step rather than collapsing or leaking into a neighbour.
        const map = new EditorMap()
        const history = new EditorHistory()

        const s0 = snapshotEditorMap(map)

        history.begin(map)
        for(const [col, row] of rectCells([0, 0], [2, 2])){
            map.setCell(col, row, "full")
        }
        expect(history.commit(map)).toBe(true)
        const s1 = snapshotEditorMap(map)

        history.begin(map)
        map.setCell(5, 5, "spawn")
        expect(history.commit(map)).toBe(true)
        const s2 = snapshotEditorMap(map)

        history.begin(map)
        map.setCell(1, 1, "deco")
        expect(history.commit(map)).toBe(true)
        const s3 = snapshotEditorMap(map)

        // Undo back through every step.
        history.undo(map)
        expect(snapshotsEqual(snapshotEditorMap(map), s2)).toBe(true)
        history.undo(map)
        expect(snapshotsEqual(snapshotEditorMap(map), s1)).toBe(true)
        history.undo(map)
        expect(snapshotsEqual(snapshotEditorMap(map), s0)).toBe(true)
        expect(history.canUndo()).toBe(false)

        // Redo forward through every step.
        history.redo(map)
        expect(snapshotsEqual(snapshotEditorMap(map), s1)).toBe(true)
        history.redo(map)
        expect(snapshotsEqual(snapshotEditorMap(map), s2)).toBe(true)
        history.redo(map)
        expect(snapshotsEqual(snapshotEditorMap(map), s3)).toBe(true)
        expect(history.canRedo()).toBe(false)
    })
})
