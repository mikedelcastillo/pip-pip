// Pure, DOM-free helpers for the small map THUMBNAIL drawn on each library card
// (the Procreate/Docs-style home grid). The library stores each map as a
// GridMapData (a dense cols*rows tiles array plus a palette + spawns); these
// helpers derive, WITHOUT any canvas, the cell bounding box of everything painted
// so a thumbnail can fit just the used region (not a wall of empty border) and the
// per-cell shape geometry so the card preview matches the in-editor / in-game look.
// Kept apart from the React thumbnail component so the math unit-tests in isolation
// (see tests/client/mapThumbnail.test.ts), exactly like mapPreview.ts does for the
// map-selector preview.

import { GridMapData, TileShape, paletteEntryAt } from "@pip-pip/game/src/logic/grid-map"

// The INCLUSIVE cell bounding box of every painted tile + spawn in a GridMapData,
// plus an `empty` flag when nothing is painted. Mirrors EditorMap.bounds() but reads
// the on-disk dense GridMapData (a flat row-major tiles array of cols*rows, value 0 =
// empty, n >= 1 = palette[n-1]) instead of the editor's sparse Map, so a stored
// library entry can be measured without rebuilding an EditorMap. Defensive over
// malformed data: a non-array / wrong-length tiles array, or out-of-range spawns,
// simply contribute nothing rather than throwing.
export type ThumbnailCellBounds = {
    empty: boolean,
    minCol: number,
    minRow: number,
    maxCol: number,
    maxRow: number,
}

export function gridMapCellBounds(data: GridMapData): ThumbnailCellBounds{
    const cols = Number.isFinite(data.cols) ? Math.max(0, Math.floor(data.cols)) : 0
    const rows = Number.isFinite(data.rows) ? Math.max(0, Math.floor(data.rows)) : 0

    let minCol = Infinity
    let minRow = Infinity
    let maxCol = -Infinity
    let maxRow = -Infinity

    const include = (col: number, row: number) => {
        if(col < minCol) minCol = col
        if(col > maxCol) maxCol = col
        if(row < minRow) minRow = row
        if(row > maxRow) maxRow = row
    }

    // Painted tiles: any non-zero cell of the dense array contributes its (col, row).
    if(Array.isArray(data.tiles)){
        for(let row = 0; row < rows; row++){
            for(let col = 0; col < cols; col++){
                const value = data.tiles[row * cols + col]
                if(typeof value === "number" && value > 0) include(col, row)
            }
        }
    }
    // Spawns: each [col, row] pair contributes too (a spawn-only map still has a box).
    if(Array.isArray(data.spawns)){
        for(const pair of data.spawns){
            if(Array.isArray(pair) && pair.length === 2
                && typeof pair[0] === "number" && typeof pair[1] === "number"){
                include(Math.floor(pair[0]), Math.floor(pair[1]))
            }
        }
    }

    if(minCol > maxCol || minRow > maxRow){
        return { empty: true, minCol: 0, minRow: 0, maxCol: 0, maxRow: 0 }
    }
    return { empty: false, minCol, minRow, maxCol, maxRow }
}

// One painted cell resolved for thumbnail drawing: its column/row in the dense grid
// and the SHAPE its palette entry holds (full / a diagonal / deco / a half tile),
// plus the raw block KEY so the drawer can colour it via blockFaceCss the SAME way
// the editor + in-game renderer do. Spawns are returned separately by the component.
export type ThumbnailCell = {
    col: number,
    row: number,
    shape: TileShape,
    key: string,
}

// Walk the dense GridMapData into a flat list of painted cells (shape + key per
// cell), resolving each non-zero value through its palette entry. An out-of-range
// palette value is SKIPPED (it cannot be drawn), so a corrupt entry degrades to a
// missing tile rather than a crash. Pure + DOM-free: the React thumbnail just maps
// each returned cell to a filled polygon. Empty cells contribute nothing.
export function gridMapThumbnailCells(data: GridMapData): ThumbnailCell[]{
    const cols = Number.isFinite(data.cols) ? Math.max(0, Math.floor(data.cols)) : 0
    const rows = Number.isFinite(data.rows) ? Math.max(0, Math.floor(data.rows)) : 0
    const cells: ThumbnailCell[] = []
    if(Array.isArray(data.tiles) === false) return cells
    for(let row = 0; row < rows; row++){
        for(let col = 0; col < cols; col++){
            const value = data.tiles[row * cols + col]
            if(typeof value !== "number" || value <= 0) continue
            const entry = paletteEntryAt(data, value)
            if(typeof entry === "undefined") continue
            cells.push({ col, row, shape: entry.shape, key: entry.key })
        }
    }
    return cells
}
