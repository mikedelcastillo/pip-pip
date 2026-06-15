import { describe, expect, it } from "vitest"
import {
    gridMapCellBounds,
    gridMapThumbnailCells,
} from "../../packages/client/src/game/mapThumbnail"
import { EditorMap } from "../../packages/client/src/game/mapEditor"
import { GridMapData } from "../../packages/game/src/logic/grid-map"

// Build a GridMapData with a known painted footprint by painting into an EditorMap
// and exporting it (the same path the editor uses), so the cell bounds + cell list
// are derived from real, validatable map data rather than hand-rolled arrays.
function builtMap(paint: (m: EditorMap) => void): GridMapData{
    const map = new EditorMap("Test")
    paint(map)
    return map.toGridMapData()
}

describe("gridMapCellBounds", () => {
    it("reports the inclusive cell box of painted tiles", () => {
        // Export translates the bbox min to (0, 0), so a 3x2 block of tiles exports
        // as cols 3, rows 2 occupying cols 0..2, rows 0..1.
        const data = builtMap((m) => {
            for(let c = 0; c < 3; c++){
                for(let r = 0; r < 2; r++) m.setCell(c, r, "full")
            }
        })
        expect(gridMapCellBounds(data)).toEqual({ empty: false, minCol: 0, minRow: 0, maxCol: 2, maxRow: 1 })
    })

    it("includes spawn cells in the box even with no tiles", () => {
        const data = builtMap((m) => {
            m.setCell(0, 0, "spawn")
            m.setCell(2, 1, "spawn")
        })
        const box = gridMapCellBounds(data)
        expect(box.empty).toBe(false)
        expect(box.maxCol).toBe(2)
        expect(box.maxRow).toBe(1)
    })

    it("flags an empty map (no tiles, no spawns)", () => {
        const data = builtMap(() => { /* paint nothing */ })
        expect(gridMapCellBounds(data).empty).toBe(true)
    })

    it("tolerates a malformed tiles array without throwing", () => {
        const broken = { name: "B", cellSize: 64, cols: 2, rows: 2, tiles: null as unknown as number[], spawns: [], palette: [] }
        expect(gridMapCellBounds(broken as GridMapData).empty).toBe(true)
    })
})

describe("gridMapThumbnailCells", () => {
    it("resolves each painted cell to its shape + key via the palette", () => {
        const data = builtMap((m) => {
            m.setCell(0, 0, "full")
            m.setCell(1, 0, "diag_tl")
            m.setCell(0, 0, "spawn") // overwrites the (0,0) tile with a spawn
        })
        const cells = gridMapThumbnailCells(data)
        // The spawn evicted the (0,0) tile, leaving only the diagonal as a drawn cell.
        expect(cells.length).toBe(1)
        expect(cells[0].shape).toBe("diag_tl")
        expect(typeof cells[0].key).toBe("string")
    })

    it("returns an empty list for an empty map and tolerates a bad tiles array", () => {
        expect(gridMapThumbnailCells(builtMap(() => {}))).toEqual([])
        const broken = { name: "B", cellSize: 64, cols: 1, rows: 1, tiles: undefined as unknown as number[], spawns: [], palette: [] }
        expect(gridMapThumbnailCells(broken as GridMapData)).toEqual([])
    })

    it("skips an out-of-palette tile value rather than throwing", () => {
        // A dense tile value of 9 with an empty palette has no entry to resolve.
        const data = { name: "B", cellSize: 64, cols: 1, rows: 1, tiles: [9], spawns: [], palette: [] }
        expect(gridMapThumbnailCells(data as GridMapData)).toEqual([])
    })
})
