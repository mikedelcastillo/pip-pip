import { JSONMapSource } from "@pip-pip/game/src/logic/map"
import { TILE_SIZE } from "@pip-pip/game/src/logic/constants"
import {
    GridMapData,
    GridSegment,
    TilePaletteEntry,
    GRID_TILE_DEFAULT_KEY,
    GRID_TILE_HIDDEN_KEY,
} from "@pip-pip/game/src/logic/grid-map"

// MIGRATION: a PURE converter from the legacy wall_tiles / wall_segments format
// (JSONMapSource) into the new GridMapData. The legacy maps store collision
// ENTIRELY as wall_segments (each with radius TILE_SIZE/2); wall_tiles are
// render-only and wall_segment_tiles just pick the tile texture. To keep every
// existing map playing EXACTLY as before, the converter:
//   - keeps the legacy segments verbatim (in cell coordinates, offset to the
//     0-based grid) so collision is byte-for-byte the same geometry,
//   - emits each wall tile as a render-only "deco" tile (no extra rect wall, so
//     no collision is added on top of the segments),
//   - tags a tile "tile_default" when it also carried a segment and "tile_hidden"
//     otherwise, mirroring the legacy loader's texture choice,
//   - maps spawn tiles straight across.
// Legacy tile coordinates are signed (can be negative); the grid is 0-based, so
// every coordinate is shifted by (minCol, minRow). World positions are preserved
// because the loader re-centres tiles on cell*cellSize and the OLD loader did the
// same with tile*TILE_SIZE - the absolute origin shift is irrelevant to play
// (bounds, walls and spawns all move together), and cellSize is kept at TILE_SIZE.

// Render-only "deco" palette: a wall tile that also carried a segment shows the
// default wall texture; a tile with no segment shows the hidden texture. Two
// palette entries cover every legacy wall tile.
const DECO_DEFAULT_INDEX = 0
const DECO_HIDDEN_INDEX = 1

const DECO_PALETTE: TilePaletteEntry[] = [
    { key: GRID_TILE_DEFAULT_KEY, shape: "deco" },
    { key: GRID_TILE_HIDDEN_KEY, shape: "deco" },
]

// Find the inclusive min/max cell coordinate across every tile, segment endpoint
// and spawn so the converted grid fully encloses the legacy map. Returns a unit
// origin box when the source is completely empty.
function legacyExtents(source: JSONMapSource){
    let minCol = Infinity
    let minRow = Infinity
    let maxCol = -Infinity
    let maxRow = -Infinity

    const see = (col: number, row: number) => {
        if(col < minCol) minCol = col
        if(col > maxCol) maxCol = col
        if(row < minRow) minRow = row
        if(row > maxRow) maxRow = row
    }

    for(const [x, y] of source.wall_tiles) see(x, y)
    for(const [x, y] of source.spawn_tiles) see(x, y)
    for(const [sx, sy, ex, ey] of source.wall_segments){
        see(sx, sy)
        see(ex, ey)
    }

    if(minCol > maxCol || minRow > maxRow){
        minCol = 0
        minRow = 0
        maxCol = 0
        maxRow = 0
    }

    return { minCol, minRow, maxCol, maxRow }
}

// Convert a legacy JSONMapSource into the new GridMapData. Pure and lossless for
// playable geometry: the segments (the actual collision) are carried verbatim
// and the tiles are render-only.
export function convertJSONMapToGrid(name: string, source: JSONMapSource): GridMapData{
    const { minCol, minRow, maxCol, maxRow } = legacyExtents(source)

    const cols = maxCol - minCol + 1
    const rows = maxRow - minRow + 1

    // Quick membership set so a wall tile knows whether it also carried a
    // segment (-> default texture) or not (-> hidden texture).
    const segmentTileKeys = new Set<string>()
    for(const [x, y] of source.wall_segment_tiles){
        segmentTileKeys.add(x + "," + y)
    }

    const tiles: number[] = new Array(cols * rows).fill(0)
    for(const [x, y] of source.wall_tiles){
        const col = x - minCol
        const row = y - minRow
        const hasSegment = segmentTileKeys.has(x + "," + y)
        // tiles store palette index + 1, so empty stays 0.
        const paletteIndex = hasSegment ? DECO_DEFAULT_INDEX : DECO_HIDDEN_INDEX
        tiles[row * cols + col] = paletteIndex + 1
    }

    const spawns: [number, number][] = source.spawn_tiles.map(
        ([x, y]): [number, number] => [x - minCol, y - minRow],
    )

    const segments: GridSegment[] = source.wall_segments.map(
        ([sx, sy, ex, ey]): GridSegment => [
            sx - minCol,
            sy - minRow,
            ex - minCol,
            ey - minRow,
        ],
    )

    return {
        name,
        cellSize: TILE_SIZE,
        cols,
        rows,
        tiles,
        spawns,
        palette: DECO_PALETTE,
        segments,
    }
}
