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

// The nav-grid cell size as a multiple of the ship DIAMETER. It MUST be smaller
// than a real corridor so a corridor has open cells to route through: at ~0.75x
// (cell < ship diameter < a 1-tile gap) the grid can represent the gaps the ship
// actually fits, while staying coarse enough that A* is cheap. (Was 1.75x, which
// made cells WIDER than a 1-tile corridor, so every corridor read as blocked and
// bots could never path - they drove straight into walls.)
export const NAV_CELL_DIAMETER_FACTOR = 0.75

// Extra clearance (in ship radii) beyond the bare ship radius kept between a
// routed cell and a wall. A cell is blocked when its CENTRE comes within
// shipRadius*(1 + this) + the wall's radius. A small buffer keeps the bot off the
// surface without closing the ~1-tile gaps it can fit. (Was 1, i.e. a FULL ship
// diameter of clearance, which closed every normal corridor.)
export const NAV_WALL_MARGIN_FACTOR = 0.1

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

// Closest distance from a point to an axis-aligned box (0 when inside). Used to
// test a cell centre against a rect wall when marking the nav grid.
function pointToBoxDistance(
    px: number, py: number,
    minX: number, minY: number, maxX: number, maxY: number){
    const dx = px < minX ? minX - px : (px > maxX ? px - maxX : 0)
    const dy = py < minY ? minY - py : (py > maxY ? py - maxY : 0)
    return Math.sqrt(dx * dx + dy * dy)
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
            // Sample the cell CENTRE: the cell is blocked only when a ship CENTRED
            // there would not clear the walls (centre within `margin` of a rect, or
            // within margin + the wall's radius of a segment spine). This lets a
            // corridor the ship actually fits through keep OPEN cells, unlike the
            // old whole-cell-overlap test which blocked any cell merely touching a
            // wall and so closed every normal-width corridor.
            const cx = grid.originX + (col + 0.5) * finalCellSize
            const cy = grid.originY + (row + 0.5) * finalCellSize

            let blocked = false
            for(const rect of rectWalls){
                const halfW = rect.width / 2
                const halfH = rect.height / 2
                const d = pointToBoxDistance(
                    cx, cy,
                    rect.center.x - halfW, rect.center.y - halfH,
                    rect.center.x + halfW, rect.center.y + halfH,
                )
                if(d <= margin){
                    blocked = true
                    break
                }
            }
            if(blocked === false){
                for(const seg of segWalls){
                    const d = distancePointToSegment(cx, cy, seg.start.x, seg.start.y, seg.end.x, seg.end.y)
                    if(d <= margin + seg.radius){
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

// --- Stuck detection + unstick (robust bot navigation) ---------------------
//
// A bot can wedge itself into a wall pocket: it keeps WANTING to move (the brain
// holds movementAmount > 0) yet the physics barely advances because it is
// grinding into a corner. The helpers below are PURE and fully testable: they
// reason only about two positions, a "wanted to move" flag, and the nav grid, so
// they carry no game state. ai.ts owns the per-bot counters and only calls these.

// How far (as a fraction of the progress unit) a bot must travel over the stuck
// window to count as "making progress". Below this while it WANTED to move, it is
// stuck. A small fraction so only a genuinely wedged bot (almost no travel) trips
// it, never a bot that is merely turning or strafing slowly.
export const STUCK_PROGRESS_FACTOR = 0.35

// How many consecutive low-progress ticks (while wanting to move) before a bot is
// declared stuck. At 20Hz this is ~0.6s of grinding with no real travel, long
// enough to ignore a momentary nudge into a wall but short enough to recover fast.
export const STUCK_TICKS_THRESHOLD = 12

// How many ticks the escape burst lasts once a bot is flagged stuck. It steers at
// the nearest open cell for this long (overriding normal target steering), which
// is plenty to back out of a one-cell pocket, then resumes normal behaviour.
export const ESCAPE_BURST_TICKS = 10

// The squared distance a bot must move over the stuck window to count as progress.
// The progress UNIT is the SMALLER of the grid cell size and the ship diameter, so
// the threshold tracks the grid on a normal (fine) map yet never blows up on a
// coarse / degenerate grid. (A test or pathological arena with enormous bounds
// gets cells thousands of units wide - see NAV_MAX_CELLS in buildNavGrid - and a
// raw cellSize threshold there demanded MORE travel per window than any ship can
// physically cover in a tick, so every TRAVELLING bot read as permanently stuck.
// Clamping the unit to the ship diameter keeps the wedge signature physical: a
// genuinely wedged ship moves far less than its own body over the window, while a
// freely chasing one moves several diameters.) Pure.
export function stuckProgressThresholdSq(grid: NavGrid): number{
    const unit = Math.min(grid.cellSize, SHIP_DAIMETER)
    const d = unit * STUCK_PROGRESS_FACTOR
    return d * d
}

// Decide whether a bot is stuck this tick. Given where it was when the stuck
// WINDOW opened (prevX/prevY, the window origin the caller holds fixed while the
// counter climbs), where it is now (x/y), whether it WANTED to move this tick
// (wantedToMove) and a running low-progress counter (stuckTicks), returns the
// updated counter plus a `stuck` flag. Because prevX/prevY is the window origin
// (not last tick), `x - prevX` is the NET displacement over the whole window, so a
// bot that is slowly ramping up or weaving still counts the ground it covers. The
// counter rises while the bot stays within the progress threshold of the origin,
// and RESETS to 0 the moment it travels far enough (real progress) or stops
// wanting to move. `stuck` is true once the counter reaches STUCK_TICKS_THRESHOLD.
// Pure: no game state, just arithmetic, so a test can drive it tick by tick. A bot
// that is NOT trying to move (wantedToMove false) is never stuck, so a parked /
// no-target bot behaves exactly as before.
export function updateStuckTicks(
    grid: NavGrid,
    prevX: number, prevY: number,
    x: number, y: number,
    wantedToMove: boolean,
    stuckTicks: number,
): { stuckTicks: number, stuck: boolean }{
    if(wantedToMove === false){
        return { stuckTicks: 0, stuck: false }
    }
    const dx = x - prevX
    const dy = y - prevY
    const movedSq = dx * dx + dy * dy
    if(movedSq >= stuckProgressThresholdSq(grid)){
        // Real travel: it is making progress, so clear the counter.
        return { stuckTicks: 0, stuck: false }
    }
    const next = stuckTicks + 1
    return { stuckTicks: next, stuck: next >= STUCK_TICKS_THRESHOLD }
}

// Find the nearest OPEN nav cell to a (possibly wall-wedged) world point and
// return its world centre. Used to give a stuck/blocked bot a concrete escape
// target it can actually reach. A small ring (BFS-style expanding square) search
// outward from the point's own cell; the point's own cell wins immediately when
// it is already open, so a bot in open space gets its own position back and steers
// nowhere new. The search ring grows to cover the whole grid in the worst case but
// returns on the first open cell, so it is cheap in practice and bounded by the
// grid size. Pure: reads only the grid. Returns undefined only when the ENTIRE
// grid is blocked (no open cell exists anywhere).
export function nearestOpenEscape(grid: NavGrid, x: number, y: number): NavPoint | undefined{
    const start = worldToCell(grid, x, y)
    if(isCellOpen(grid, start.col, start.row)){
        return cellCenter(grid, start.col, start.row)
    }

    // Expand a square ring of radius `r` around the start cell and take the first
    // open cell found. Scanning ring by ring (cheapest manhattan-ish first) keeps
    // the returned cell close to the bot, so the escape heading is the shortest
    // way out of the pocket.
    const maxRadius = grid.cols + grid.rows
    for(let r = 1; r <= maxRadius; r++){
        let best: NavPoint | undefined
        let bestDistSq = Infinity
        for(let dc = -r; dc <= r; dc++){
            for(let dr = -r; dr <= r; dr++){
                // Only the cells ON the current ring (max-norm === r); inner rings
                // were already scanned on earlier iterations.
                if(Math.max(Math.abs(dc), Math.abs(dr)) !== r) continue
                const col = start.col + dc
                const row = start.row + dr
                if(isCellOpen(grid, col, row) === false) continue
                // Among the open cells on this ring, keep the EUCLIDEAN-nearest so
                // a diagonal opening does not beat a closer cardinal one.
                const ddc = col - start.col
                const ddr = row - start.row
                const distSq = ddc * ddc + ddr * ddr
                if(distSq < bestDistSq){
                    bestDistSq = distSq
                    best = cellCenter(grid, col, row)
                }
            }
        }
        if(typeof best !== "undefined") return best
    }
    return undefined
}

// The heading (radians) from a bot toward the nearest open cell, or undefined when
// the bot is already on an open cell (nothing to escape) or no open cell exists.
// A thin wrapper over nearestOpenEscape that turns the escape target into an angle
// the brain can feed straight into movementAngle. Pure.
export function escapeHeading(grid: NavGrid, x: number, y: number): number | undefined{
    const escape = nearestOpenEscape(grid, x, y)
    if(typeof escape === "undefined") return undefined
    const dx = escape.x - x
    const dy = escape.y - y
    // Already centred on the open cell -> no meaningful heading.
    if(dx === 0 && dy === 0) return undefined
    return Math.atan2(dy, dx)
}

// Local wall avoidance: nudge a desired movement heading away from a wall the bot
// is grinding into. Samples the nav grid in the four cardinal directions one cell
// out from the bot; each BLOCKED neighbour pushes a small repulsion vector away
// from that wall. The repulsion is blended with the bot's desired heading so the
// bot still mostly goes where it wants but skims along a wall instead of pressing
// into it. With no nearby blocked cells the desired heading is returned unchanged,
// so an open-field bot is unaffected. Pure: reads only the grid.
export function avoidWallsHeading(grid: NavGrid, x: number, y: number, desiredAngle: number): number{
    const cell = worldToCell(grid, x, y)
    // Repulsion accumulates as a vector pointing AWAY from each blocked neighbour.
    let repelX = 0
    let repelY = 0
    const cardinals = [
        { dc: 1, dr: 0 },
        { dc: -1, dr: 0 },
        { dc: 0, dr: 1 },
        { dc: 0, dr: -1 },
    ]
    for(const c of cardinals){
        if(isCellOpen(grid, cell.col + c.dc, cell.row + c.dr) === false){
            // Push opposite the blocked neighbour.
            repelX -= c.dc
            repelY -= c.dr
        }
    }
    if(repelX === 0 && repelY === 0) return desiredAngle

    const desiredX = Math.cos(desiredAngle)
    const desiredY = Math.sin(desiredAngle)
    const repelLen = Math.sqrt(repelX * repelX + repelY * repelY)
    const repelNX = repelX / repelLen
    const repelNY = repelY / repelLen

    // How head-on the desired heading is into the wall: dot of the desired heading
    // with the repulsion normal. Near -1 means the bot is driving STRAIGHT into the
    // wall (desired points opposite the push), where a plain blend just decelerates
    // along the same line and never deflects.
    const dot = desiredX * repelNX + desiredY * repelNY

    if(dot < -0.9){
        // Head-on: a blend would cancel to (almost) the same axis and keep grinding.
        // Instead SLIDE along the wall - steer perpendicular to the repulsion, on
        // whichever side keeps the bot moving most like it wanted. Perpendiculars to
        // (repelNX, repelNY) are (-repelNY, repelNX) and (repelNY, -repelNX).
        const perpX = -repelNY
        const perpY = repelNX
        // Pick the perpendicular that best agrees with the desired heading so the
        // detour is the small one, not a U-turn.
        const align = desiredX * perpX + desiredY * perpY
        if(align >= 0) return Math.atan2(perpY, perpX)
        return Math.atan2(-perpY, -perpX)
    }

    // Glancing contact: blend the desired heading (unit vector) with the repulsion.
    // The repulsion weight is modest so the bot keeps pursuing its waypoint while
    // easing off the wall, rather than fleeing it outright.
    const repelWeight = 0.6
    const blendX = desiredX + repelNX * repelWeight
    const blendY = desiredY + repelNY * repelWeight
    if(blendX === 0 && blendY === 0) return desiredAngle
    return Math.atan2(blendY, blendX)
}
