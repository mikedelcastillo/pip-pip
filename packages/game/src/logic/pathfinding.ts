import { PointPhysicsRectWall, PointPhysicsSegmentWall } from "@pip-pip/core/src/physics"
import { distancePointToSegment, segmentsIntersect } from "@pip-pip/core/src/math"
import { SHIP_DAIMETER } from "./constants"
import { PipGameMap, PipGameMapBounds } from "./map"

// Coarse navigation grid + line-of-sight + A* used by the bot brain to route
// AROUND walls when it cannot see its target. Everything here is PURE: it reads
// only the map's walls and bounds and a couple of world points, so it is fully
// unit-testable with no running game. The grid is built ONCE per map (cached on
// the game, rebuilt only when the map changes) and a path is recomputed at most
// every few ticks - never per tick - so this LOWERS server CPU compared with a
// per-tick straight-line chase that drives bots into walls.

// The nav-grid cell size as a multiple of the ship DIAMETER. ~1.75x keeps the
// grid coarse (few cells -> cheap A*) while still leaving room for a ship to
// pass between two open cells. A coarser grid is the main CPU lever here.
export const NAV_CELL_DIAMETER_FACTOR = 1.75

// Extra clearance (in ship radii) baked into a cell's blocked test so paths do
// not hug walls: a cell counts as blocked when a wall comes within ship radius
// + this margin of it. One ship radius of margin keeps the routed bot off the
// surface without closing narrow gaps entirely.
export const NAV_WALL_MARGIN_FACTOR = 1

// Hard cap on the total number of nav-grid cells. A real map fits comfortably
// under this, but a degenerate or test arena with enormous bounds would
// otherwise allocate millions of cells (and a per-cell wall scan) on the build.
// When the requested cell size would exceed this budget, buildNavGrid grows the
// cell size so cols*rows stays at/under the cap - the grid just gets coarser,
// which only makes A* cheaper. Bounds the one-time build cost.
export const NAV_MAX_CELLS = 4096

// A waypoint in world coordinates (a cell centre on the routed path).
export type NavPoint = {
    x: number,
    y: number,
}

// A coarse uniform occupancy grid over the map bounds. `blocked[row * cols +
// col]` is true when that cell overlaps (within margin) any wall. Cell (col,
// row) covers world [originX + col*cell, ...] etc. Built once per map.
export type NavGrid = {
    originX: number,
    originY: number,
    cellSize: number,
    cols: number,
    rows: number,
    blocked: boolean[],
}

// True straight-line clearance test of a single grid CELL against one rect
// wall, inflated by `margin`. The cell is treated as an axis-aligned box; the
// wall is inflated by margin on every side, and we report an overlap when the
// two boxes intersect. Cheap and exact for AABB-vs-AABB.
function cellOverlapsRect(
    cellMinX: number, cellMinY: number, cellMaxX: number, cellMaxY: number,
    rect: PointPhysicsRectWall, margin: number){
    const halfW = rect.width / 2 + margin
    const halfH = rect.height / 2 + margin
    const rMinX = rect.center.x - halfW
    const rMaxX = rect.center.x + halfW
    const rMinY = rect.center.y - halfH
    const rMaxY = rect.center.y + halfH
    if(cellMaxX < rMinX || cellMinX > rMaxX) return false
    if(cellMaxY < rMinY || cellMinY > rMaxY) return false
    return true
}

// Closest distance from a point to an axis-aligned box (0 inside). Used to test
// a capsule (segment) wall against a cell: sample the cell centre against the
// segment, but to be safe against thin walls slicing a cell we also test the
// segment endpoints against the cell box.
function pointToBoxDistance(
    px: number, py: number,
    minX: number, minY: number, maxX: number, maxY: number){
    const dx = px < minX ? minX - px : (px > maxX ? px - maxX : 0)
    const dy = py < minY ? minY - py : (py > maxY ? py - maxY : 0)
    return Math.sqrt(dx * dx + dy * dy)
}

// True when a capsule (segment) wall comes within `clearance` of a grid cell.
// The segment's spine is tested against the cell box from both sides: the cell
// centre vs the segment, and each segment endpoint vs the cell box. That covers
// a long thin wall crossing the cell as well as a wall ending inside it.
function cellOverlapsSeg(
    cellMinX: number, cellMinY: number, cellMaxX: number, cellMaxY: number,
    seg: PointPhysicsSegmentWall, clearance: number){
    const cx = (cellMinX + cellMaxX) / 2
    const cy = (cellMinY + cellMaxY) / 2
    const centreDist = distancePointToSegment(
        cx, cy,
        seg.start.x, seg.start.y,
        seg.end.x, seg.end.y,
    )
    if(centreDist <= clearance) return true
    const startDist = pointToBoxDistance(seg.start.x, seg.start.y, cellMinX, cellMinY, cellMaxX, cellMaxY)
    if(startDist <= clearance) return true
    const endDist = pointToBoxDistance(seg.end.x, seg.end.y, cellMinX, cellMinY, cellMaxX, cellMaxY)
    if(endDist <= clearance) return true
    return false
}

// The default cell size for a ship of diameter SHIP_DAIMETER.
export function defaultNavCellSize(){
    return SHIP_DAIMETER * NAV_CELL_DIAMETER_FACTOR
}

// The default clearance margin (ship radius + wall margin) used when marking a
// cell blocked, so routed paths keep a ship's width away from walls.
export function defaultNavMargin(){
    return (SHIP_DAIMETER / 2) * (1 + NAV_WALL_MARGIN_FACTOR)
}

// Build a coarse occupancy grid over the map bounds. A cell is blocked when any
// rectWall or segWall comes within `margin` of it (segWall clearance also adds
// the wall's own radius). Pure: depends only on the walls + bounds passed in.
// Called ONCE per map (see getNavGrid), never per tick.
export function buildNavGrid(
    bounds: PipGameMapBounds,
    rectWalls: PointPhysicsRectWall[],
    segWalls: PointPhysicsSegmentWall[],
    cellSize = defaultNavCellSize(),
    margin = defaultNavMargin(),
): NavGrid{
    const width = Math.max(cellSize, bounds.max.x - bounds.min.x)
    const height = Math.max(cellSize, bounds.max.y - bounds.min.y)

    // Keep the grid within the cell budget. If the requested cell size would blow
    // past NAV_MAX_CELLS (huge / degenerate bounds), grow the cell size just
    // enough that cols*rows lands at/under the cap. A coarser grid only makes A*
    // cheaper; it never makes the build pathological.
    let finalCellSize = cellSize
    const rawCols = Math.ceil(width / finalCellSize)
    const rawRows = Math.ceil(height / finalCellSize)
    if(rawCols * rawRows > NAV_MAX_CELLS){
        // area / NAV_MAX_CELLS is the area per cell at the cap; its square root is
        // the side length that yields ~NAV_MAX_CELLS square cells over the area.
        finalCellSize = Math.sqrt((width * height) / NAV_MAX_CELLS)
    }

    const cols = Math.max(1, Math.ceil(width / finalCellSize))
    const rows = Math.max(1, Math.ceil(height / finalCellSize))

    const grid: NavGrid = {
        originX: bounds.min.x,
        originY: bounds.min.y,
        cellSize: finalCellSize,
        cols,
        rows,
        blocked: new Array(cols * rows).fill(false),
    }

    for(let row = 0; row < rows; row++){
        for(let col = 0; col < cols; col++){
            const cellMinX = grid.originX + col * finalCellSize
            const cellMinY = grid.originY + row * finalCellSize
            const cellMaxX = cellMinX + finalCellSize
            const cellMaxY = cellMinY + finalCellSize

            let blocked = false
            for(const rect of rectWalls){
                if(cellOverlapsRect(cellMinX, cellMinY, cellMaxX, cellMaxY, rect, margin)){
                    blocked = true
                    break
                }
            }
            if(blocked === false){
                for(const seg of segWalls){
                    // A capsule wall's true half-thickness is its radius, so the
                    // clearance a routed ship needs is margin + that radius.
                    if(cellOverlapsSeg(cellMinX, cellMinY, cellMaxX, cellMaxY, seg, margin + seg.radius)){
                        blocked = true
                        break
                    }
                }
            }
            grid.blocked[row * cols + col] = blocked
        }
    }

    return grid
}

// Convert a world coordinate to a grid column/row, clamped to the grid so an
// out-of-bounds point maps to the nearest edge cell.
export function worldToCell(grid: NavGrid, x: number, y: number){
    const col = Math.max(0, Math.min(grid.cols - 1, Math.floor((x - grid.originX) / grid.cellSize)))
    const row = Math.max(0, Math.min(grid.rows - 1, Math.floor((y - grid.originY) / grid.cellSize)))
    return { col, row }
}

// The world-space centre of a grid cell (used to emit waypoints).
export function cellCenter(grid: NavGrid, col: number, row: number): NavPoint{
    return {
        x: grid.originX + (col + 0.5) * grid.cellSize,
        y: grid.originY + (row + 0.5) * grid.cellSize,
    }
}

// Is a cell inside the grid and open (not blocked)?
export function isCellOpen(grid: NavGrid, col: number, row: number){
    if(col < 0 || col >= grid.cols) return false
    if(row < 0 || row >= grid.rows) return false
    return grid.blocked[row * grid.cols + col] === false
}

// Cheap straight-line clearance test between two world points: does the segment
// from (ax, ay) to (bx, by) cross ANY wall (inflated by the routed ship's
// clearance)? This is the FAST path the brain uses every tick - when it is true
// the bot ignores the grid entirely and drives straight at the target, exactly
// as it did before pathfinding existed. Pure.
export function hasLineOfSight(
    ax: number, ay: number,
    bx: number, by: number,
    rectWalls: PointPhysicsRectWall[],
    segWalls: PointPhysicsSegmentWall[],
    margin = SHIP_DAIMETER / 2,
){
    for(const seg of segWalls){
        // Treat the capsule's spine as a segment; a hit is the two segments
        // passing within (margin + the wall's radius) of each other. An exact
        // crossing is distance 0, which the threshold also covers.
        const clearance = margin + seg.radius
        if(segmentsIntersect(ax, ay, bx, by, seg.start.x, seg.start.y, seg.end.x, seg.end.y)) return false
        const d = Math.min(
            distancePointToSegment(ax, ay, seg.start.x, seg.start.y, seg.end.x, seg.end.y),
            distancePointToSegment(bx, by, seg.start.x, seg.start.y, seg.end.x, seg.end.y),
            distancePointToSegment(seg.start.x, seg.start.y, ax, ay, bx, by),
            distancePointToSegment(seg.end.x, seg.end.y, ax, ay, bx, by),
        )
        if(d <= clearance) return false
    }

    for(const rect of rectWalls){
        // Inflate the box by margin, then test the sight line against its four
        // edges. A crossing of any edge (or a start/end point sitting inside the
        // inflated box) blocks the line.
        const halfW = rect.width / 2 + margin
        const halfH = rect.height / 2 + margin
        const minX = rect.center.x - halfW
        const maxX = rect.center.x + halfW
        const minY = rect.center.y - halfH
        const maxY = rect.center.y + halfH

        const aInside = ax >= minX && ax <= maxX && ay >= minY && ay <= maxY
        const bInside = bx >= minX && bx <= maxX && by >= minY && by <= maxY
        if(aInside || bInside) return false

        if(segmentsIntersect(ax, ay, bx, by, minX, minY, maxX, minY)) return false
        if(segmentsIntersect(ax, ay, bx, by, maxX, minY, maxX, maxY)) return false
        if(segmentsIntersect(ax, ay, bx, by, maxX, maxY, minX, maxY)) return false
        if(segmentsIntersect(ax, ay, bx, by, minX, maxY, minX, minY)) return false
    }

    return true
}

// Convenience overload of hasLineOfSight reading the walls straight off a map.
export function mapHasLineOfSight(map: PipGameMap, ax: number, ay: number, bx: number, by: number, margin?: number){
    return hasLineOfSight(ax, ay, bx, by, map.rectWalls, map.segWalls, margin)
}

// 8-connected neighbour offsets (4 cardinals + 4 diagonals). Diagonals let a
// path cut corners diagonally so routes stay short; the diagonal move is only
// taken when BOTH orthogonal cells are open (no corner-clipping through a wall).
const NEIGHBOURS: { dc: number, dr: number, cost: number }[] = [
    { dc: 1, dr: 0, cost: 1 },
    { dc: -1, dr: 0, cost: 1 },
    { dc: 0, dr: 1, cost: 1 },
    { dc: 0, dr: -1, cost: 1 },
    { dc: 1, dr: 1, cost: Math.SQRT2 },
    { dc: 1, dr: -1, cost: Math.SQRT2 },
    { dc: -1, dr: 1, cost: Math.SQRT2 },
    { dc: -1, dr: -1, cost: Math.SQRT2 },
]

// Octile heuristic (admissible for 8-connected movement): the cheapest possible
// cost ignoring walls. Keeps A* optimal and well-directed so it expands few
// cells.
function octileHeuristic(c0: number, r0: number, c1: number, r1: number){
    const dc = Math.abs(c1 - c0)
    const dr = Math.abs(r1 - r0)
    return (dc + dr) + (Math.SQRT2 - 2) * Math.min(dc, dr)
}

// A* over the nav grid from a start cell to a goal cell, 8-connected. Returns
// the list of cell indices (row * cols + col) from start to goal inclusive, or
// an empty array when no path exists (caller falls back gracefully). The open
// set is a plain array scanned for the lowest f - fine for these coarse grids
// (tens of cells) and allocation-light; A* is only run on the path cadence, not
// per tick. Pure: reads only the grid.
export function findPathCells(grid: NavGrid, startCol: number, startRow: number, goalCol: number, goalRow: number): number[]{
    const total = grid.cols * grid.rows
    if(total === 0) return []

    const startIndex = startRow * grid.cols + startCol
    const goalIndex = goalRow * grid.cols + goalCol

    // A blocked goal is unreachable by definition; bail before searching.
    if(isCellOpen(grid, startCol, startRow) === false) return []
    if(isCellOpen(grid, goalCol, goalRow) === false) return []
    if(startIndex === goalIndex) return [startIndex]

    const gScore = new Array<number>(total).fill(Infinity)
    const fScore = new Array<number>(total).fill(Infinity)
    const cameFrom = new Array<number>(total).fill(-1)
    const closed = new Array<boolean>(total).fill(false)

    gScore[startIndex] = 0
    fScore[startIndex] = octileHeuristic(startCol, startRow, goalCol, goalRow)

    // Open set as an index list; we linear-scan for the lowest fScore. Small grid
    // -> small open set, so this stays cheap without a heap.
    const open: number[] = [startIndex]

    while(open.length > 0){
        // Find the open node with the lowest fScore.
        let bestAt = 0
        for(let i = 1; i < open.length; i++){
            if(fScore[open[i]] < fScore[open[bestAt]]) bestAt = i
        }
        const current = open[bestAt]

        if(current === goalIndex){
            // Reconstruct the cell path from goal back to start.
            const path: number[] = []
            let node = current
            while(node !== -1){
                path.push(node)
                node = cameFrom[node]
            }
            path.reverse()
            return path
        }

        // Pop current out of the open set (swap-remove) and close it.
        open[bestAt] = open[open.length - 1]
        open.pop()
        closed[current] = true

        const col = current % grid.cols
        const row = (current - col) / grid.cols

        for(const n of NEIGHBOURS){
            const nc = col + n.dc
            const nr = row + n.dr
            if(isCellOpen(grid, nc, nr) === false) continue
            // No diagonal corner-cutting: a diagonal step is only legal when both
            // shared orthogonal cells are open, so the route never slips through a
            // wall corner.
            if(n.dc !== 0 && n.dr !== 0){
                if(isCellOpen(grid, col + n.dc, row) === false) continue
                if(isCellOpen(grid, col, row + n.dr) === false) continue
            }
            const neighbourIndex = nr * grid.cols + nc
            if(closed[neighbourIndex]) continue

            const tentative = gScore[current] + n.cost
            if(tentative >= gScore[neighbourIndex]) continue

            cameFrom[neighbourIndex] = current
            gScore[neighbourIndex] = tentative
            fScore[neighbourIndex] = tentative + octileHeuristic(nc, nr, goalCol, goalRow)
            if(open.indexOf(neighbourIndex) === -1) open.push(neighbourIndex)
        }
    }

    return []
}

// Drop redundant waypoints: keep a waypoint only when the previous KEPT point
// has no clear line of sight to the one after it. The result is the minimal
// chain of corners a ship has to round, so the bot steers toward real turning
// points instead of every cell centre. Pure (reads the same walls as
// hasLineOfSight).
export function smoothPath(
    points: NavPoint[],
    rectWalls: PointPhysicsRectWall[],
    segWalls: PointPhysicsSegmentWall[],
    margin = SHIP_DAIMETER / 2,
): NavPoint[]{
    if(points.length <= 2) return points.slice()

    const result: NavPoint[] = [points[0]]
    let anchor = 0
    for(let i = 1; i < points.length - 1; i++){
        const next = points[i + 1]
        // If the anchor can already see the NEXT point, the current point i is
        // redundant (collinear or a needless dog-leg) and is dropped.
        if(hasLineOfSight(points[anchor].x, points[anchor].y, next.x, next.y, rectWalls, segWalls, margin)){
            continue
        }
        // The anchor cannot see past point i, so i is a real corner - keep it and
        // make it the new anchor.
        result.push(points[i])
        anchor = i
    }
    result.push(points[points.length - 1])
    return result
}

// Full route: A* over the grid from `from` to `to`, mapped to world-space
// waypoints and smoothed. Returns an empty array when no route exists (the
// brain then falls back to a direct steer / hold). This is the single entry the
// AI brain calls on its path cadence.
export function findPath(
    grid: NavGrid,
    fromX: number, fromY: number,
    toX: number, toY: number,
    rectWalls: PointPhysicsRectWall[],
    segWalls: PointPhysicsSegmentWall[],
    margin = SHIP_DAIMETER / 2,
): NavPoint[]{
    const start = worldToCell(grid, fromX, fromY)
    const goal = worldToCell(grid, toX, toY)
    const cells = findPathCells(grid, start.col, start.row, goal.col, goal.row)
    if(cells.length === 0) return []

    const points: NavPoint[] = cells.map(index => {
        const col = index % grid.cols
        const row = (index - col) / grid.cols
        return cellCenter(grid, col, row)
    })

    return smoothPath(points, rectWalls, segWalls, margin)
}

// Cache key for a built grid: walls + bounds are fixed per map, so the map id +
// extents uniquely identify a grid. getNavGrid keys its cache on this so a grid
// is built once and reused across ticks (and bots), only rebuilt on map change.
export function navGridKey(map: PipGameMap){
    const b = map.bounds
    return map.id + ":" + b.min.x + ":" + b.min.y + ":" + b.max.x + ":" + b.max.y
}

// Process-wide nav-grid cache keyed by navGridKey. A grid is a pure function of
// a map's walls + bounds, so caching it here means buildNavGrid runs ONCE per
// distinct map and every bot on every tick reuses the same grid - the core of
// the "lower, not raise, CPU" requirement.
const NAV_GRID_CACHE = new Map<string, NavGrid>()

// Get the nav grid for a map, building (and caching) it on first use. The cache
// is keyed on the map id + bounds so a map change yields a fresh grid while a
// stable map reuses the cached one. Bots read this once per path recompute.
export function getNavGrid(map: PipGameMap): NavGrid{
    const key = navGridKey(map)
    const cached = NAV_GRID_CACHE.get(key)
    if(typeof cached !== "undefined") return cached
    const grid = buildNavGrid(map.bounds, map.rectWalls, map.segWalls)
    NAV_GRID_CACHE.set(key, grid)
    return grid
}

// Test/util hook: drop the cached grids so a rebuilt map (or a test that mutates
// walls) gets a fresh grid. Never needed on the live server (maps are stable),
// but keeps the cache from masking a deliberate wall change in tests.
export function clearNavGridCache(){
    NAV_GRID_CACHE.clear()
}
