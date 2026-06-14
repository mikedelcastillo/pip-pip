import { describe, expect, it } from "vitest"
import { PointPhysicsRectWall, PointPhysicsSegmentWall, Vector2 } from "@pip-pip/core/src/physics"
import {
    avoidWallsHeading,
    buildNavGrid,
    cellCenter,
    escapeHeading,
    findPath,
    findPathCells,
    hasLineOfSight,
    isCellOpen,
    nearestOpenEscape,
    smoothPath,
    STUCK_TICKS_THRESHOLD,
    updateStuckTicks,
    worldToCell,
    type NavPoint,
} from "@pip-pip/game/src/logic/pathfinding"
import { PipGameMapBounds } from "@pip-pip/game/src/logic/map"

// A simple square arena. Big enough that the coarse grid has several cells.
const BOUNDS: PipGameMapBounds = {
    min: { x: -1000, y: -1000 },
    max: { x: 1000, y: 1000 },
}

// A rect wall centred at (cx, cy) with the given size. The map stores these as
// PointPhysicsRectWall (center + width/height).
function rect(cx: number, cy: number, w: number, h: number){
    const wall = new PointPhysicsRectWall()
    wall.center = new Vector2(cx, cy)
    wall.width = w
    wall.height = h
    return wall
}

// A capsule (segment) wall from (sx, sy) to (ex, ey) with a half-thickness.
function seg(sx: number, sy: number, ex: number, ey: number, radius = 25){
    const wall = new PointPhysicsSegmentWall(undefined, sx, sy, ex, ey)
    wall.radius = radius
    return wall
}

describe("nav grid", () => {
    it("marks cells overlapping a wall blocked and open cells open", () => {
        // One big rect wall sitting in the centre of the arena.
        const wall = rect(0, 0, 300, 300)
        const grid = buildNavGrid(BOUNDS, [wall], [])

        // The centre cell (covering world origin) must be blocked.
        const centre = worldToCell(grid, 0, 0)
        expect(isCellOpen(grid, centre.col, centre.row)).toBe(false)

        // A far corner cell, well clear of the wall, must be open.
        const corner = worldToCell(grid, -900, -900)
        expect(isCellOpen(grid, corner.col, corner.row)).toBe(true)
    })

    it("keeps a margin so cells right next to a wall are also blocked", () => {
        // A thin vertical segment wall down the middle. Cells the wall passes
        // through (plus the clearance margin) are blocked; the far sides are open.
        const wall = seg(0, -500, 0, 500, 25)
        const grid = buildNavGrid(BOUNDS, [], [wall])

        const onWall = worldToCell(grid, 0, 0)
        expect(isCellOpen(grid, onWall.col, onWall.row)).toBe(false)

        const farLeft = worldToCell(grid, -800, 0)
        const farRight = worldToCell(grid, 800, 0)
        expect(isCellOpen(grid, farLeft.col, farLeft.row)).toBe(true)
        expect(isCellOpen(grid, farRight.col, farRight.row)).toBe(true)
    })

    it("has every cell open with no walls", () => {
        const grid = buildNavGrid(BOUNDS, [], [])
        expect(grid.blocked.some(b => b === true)).toBe(false)
    })
})

describe("line of sight", () => {
    it("is true down a clear lane", () => {
        // No walls at all: any two points see each other.
        expect(hasLineOfSight(-500, 0, 500, 0, [], [])).toBe(true)
    })

    it("is false straight through a rect wall", () => {
        const wall = rect(0, 0, 200, 200)
        // A horizontal line from the left to the right passes through the wall.
        expect(hasLineOfSight(-500, 0, 500, 0, [wall], [])).toBe(false)
    })

    it("is false straight through a segment wall but true around it", () => {
        // A horizontal wall blocking the direct horizontal lane.
        const wall = seg(-200, 0, 200, 0, 25)
        expect(hasLineOfSight(-500, 0, 500, 0, [], [wall])).toBe(false)
        // A lane that clears the wall vertically has sight.
        expect(hasLineOfSight(-500, 400, 500, 400, [], [wall])).toBe(true)
    })
})

describe("A* search", () => {
    it("finds a path around a blocking wall", () => {
        // A wall that splits the arena but leaves a gap at the top, so the only
        // route from the left side to the right side goes up and over.
        const wall = seg(0, -1000, 0, 400, 25)
        const grid = buildNavGrid(BOUNDS, [], [wall])

        const path = findPath(grid, -700, 0, 700, 0, [], [wall])
        expect(path.length).toBeGreaterThan(0)

        // Every waypoint must sit in an OPEN cell (the route never enters a wall).
        for(const wp of path){
            const cell = worldToCell(grid, wp.x, wp.y)
            expect(isCellOpen(grid, cell.col, cell.row)).toBe(true)
        }

        // The route must detour off the straight y=0 line to get around the wall
        // (the gap is at the top, y > 400), so some waypoint is well above 0.
        const maxY = Math.max(...path.map(wp => wp.y))
        expect(maxY).toBeGreaterThan(400)
    })

    it("returns an empty path when the target is unreachable", () => {
        // A rect wall that completely seals off a pocket in the corner: a small
        // closed box around the goal cell.
        const top = rect(0, -300, 2000, 60)
        const bottom = rect(0, 300, 2000, 60)
        const left = rect(-300, 0, 60, 2000)
        const right = rect(300, 0, 60, 2000)
        // The goal is OUTSIDE the box, the start is sealed INSIDE it. No way out.
        const walls = [top, bottom, left, right]
        const grid = buildNavGrid(BOUNDS, walls, [])

        const path = findPath(grid, 0, 0, 900, 900, walls, [])
        expect(path.length).toBe(0)
    })

    it("findPathCells returns the single start cell when start equals goal", () => {
        const grid = buildNavGrid(BOUNDS, [], [])
        const cells = findPathCells(grid, 3, 3, 3, 3)
        expect(cells.length).toBe(1)
    })

    it("a clear arena routes directly (start and goal cells both present)", () => {
        const grid = buildNavGrid(BOUNDS, [], [])
        const start = worldToCell(grid, -700, -700)
        const goal = worldToCell(grid, 700, 700)
        const cells = findPathCells(grid, start.col, start.row, goal.col, goal.row)
        expect(cells.length).toBeGreaterThan(0)
        // The path starts at the start cell and ends at the goal cell.
        const startIndex = start.row * grid.cols + start.col
        const goalIndex = goal.row * grid.cols + goal.col
        expect(cells[0]).toBe(startIndex)
        expect(cells[cells.length - 1]).toBe(goalIndex)
    })
})

describe("path smoothing", () => {
    it("removes a redundant collinear waypoint", () => {
        // Three collinear points with a clear lane: the middle one is redundant.
        const points: NavPoint[] = [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 200, y: 0 },
        ]
        const smoothed = smoothPath(points, [], [])
        expect(smoothed.length).toBe(2)
        expect(smoothed[0]).toEqual({ x: 0, y: 0 })
        expect(smoothed[1]).toEqual({ x: 200, y: 0 })
    })

    it("keeps a real corner that has no line of sight across it", () => {
        // An L-shaped path around a wall corner: the bend must be kept because
        // the endpoints cannot see each other through the wall.
        const wall = seg(50, -1000, 50, 50, 25)
        const points: NavPoint[] = [
            { x: 0, y: 0 },
            { x: 0, y: 200 },
            { x: 300, y: 200 },
        ]
        const smoothed = smoothPath(points, [], [wall])
        // The corner at (0, 200) is load-bearing, so all three points survive.
        expect(smoothed.length).toBe(3)
    })

    it("returns a short path unchanged", () => {
        const points: NavPoint[] = [{ x: 0, y: 0 }, { x: 100, y: 100 }]
        expect(smoothPath(points, [], [])).toEqual(points)
    })
})

describe("cell helpers", () => {
    it("worldToCell and cellCenter round-trip to the same cell", () => {
        const grid = buildNavGrid(BOUNDS, [], [])
        const cell = worldToCell(grid, 123, -456)
        const centre = cellCenter(grid, cell.col, cell.row)
        const back = worldToCell(grid, centre.x, centre.y)
        expect(back).toEqual(cell)
    })
})

describe("nearest open escape (unstick)", () => {
    it("returns the bot's OWN cell centre when it already sits on an open cell", () => {
        // Empty arena -> every cell is open, so the nearest escape from any point is
        // that point's own cell centre.
        const grid = buildNavGrid(BOUNDS, [], [])
        const escape = nearestOpenEscape(grid, 123, -456)
        const cell = worldToCell(grid, 123, -456)
        const centre = cellCenter(grid, cell.col, cell.row)
        expect(escape).toEqual(centre)
    })

    it("returns an ADJACENT open cell when the bot sits on a blocked cell", () => {
        // A single rect wall in the centre. The origin cell is blocked; the escape
        // must be a DIFFERENT, open cell next to it.
        const wall = rect(0, 0, 300, 300)
        const grid = buildNavGrid(BOUNDS, [wall], [])

        const onWall = worldToCell(grid, 0, 0)
        expect(isCellOpen(grid, onWall.col, onWall.row)).toBe(false)

        const escape = nearestOpenEscape(grid, 0, 0)
        expect(escape).not.toBeUndefined()
        const escapeCell = worldToCell(grid, escape!.x, escape!.y)
        // The escape cell is open and is not the (blocked) starting cell.
        expect(isCellOpen(grid, escapeCell.col, escapeCell.row)).toBe(true)
        expect(escapeCell).not.toEqual(onWall)
    })

    it("finds the one opening out of a pocket blocked on three sides", () => {
        // Build a grid by hand so we control exactly one open neighbour. A 3x3 patch
        // of blocked cells around a centre, with a single open cell to the RIGHT of
        // centre - the only way out of the pocket.
        const grid = buildNavGrid(BOUNDS, [], [])
        const cols = grid.cols
        const cx = Math.floor(grid.cols / 2)
        const cy = Math.floor(grid.rows / 2)

        // Block the centre and three of its four cardinal neighbours, leaving the
        // east (cx + 1) neighbour as the sole opening.
        const blockAt = (col: number, row: number) => { grid.blocked[row * cols + col] = true }
        blockAt(cx, cy)         // the bot's own (wedged) cell
        blockAt(cx - 1, cy)     // west blocked
        blockAt(cx, cy - 1)     // north blocked
        blockAt(cx, cy + 1)     // south blocked
        // east (cx + 1, cy) is left OPEN as the pocket's only exit.

        const centre = cellCenter(grid, cx, cy)
        const escape = nearestOpenEscape(grid, centre.x, centre.y)
        expect(escape).not.toBeUndefined()
        const escapeCell = worldToCell(grid, escape!.x, escape!.y)
        expect(isCellOpen(grid, escapeCell.col, escapeCell.row)).toBe(true)
        // The only open cardinal neighbour is the east one, so the nearest escape
        // is that cell.
        expect(escapeCell).toEqual({ col: cx + 1, row: cy })
    })

    it("escapeHeading points from the wedged bot toward the open exit", () => {
        const grid = buildNavGrid(BOUNDS, [], [])
        const cols = grid.cols
        const cx = Math.floor(grid.cols / 2)
        const cy = Math.floor(grid.rows / 2)
        const blockAt = (col: number, row: number) => { grid.blocked[row * cols + col] = true }
        blockAt(cx, cy)
        blockAt(cx - 1, cy)
        blockAt(cx, cy - 1)
        blockAt(cx, cy + 1)
        // east open

        const centre = cellCenter(grid, cx, cy)
        const heading = escapeHeading(grid, centre.x, centre.y)
        expect(typeof heading).toBe("number")
        // East -> +x -> angle ~0.
        expect(Math.abs(heading!)).toBeLessThan(0.01)
    })

    it("escapeHeading is undefined when the bot is already on an open cell", () => {
        const grid = buildNavGrid(BOUNDS, [], [])
        const centre = cellCenter(grid, 5, 5)
        // Standing on the exact open cell centre -> nothing to escape.
        expect(escapeHeading(grid, centre.x, centre.y)).toBeUndefined()
    })
})

describe("stuck detection", () => {
    it("flags a bot that WANTS to move but has not moved over N ticks, and clears once it moves", () => {
        const grid = buildNavGrid(BOUNDS, [], [])
        // The bot wants to move but is pinned at the same spot every tick.
        let stuckTicks = 0
        let flagged = false
        for(let i = 0; i < STUCK_TICKS_THRESHOLD; i++){
            const out = updateStuckTicks(grid, 100, 100, 100, 100, true, stuckTicks)
            stuckTicks = out.stuckTicks
            if(out.stuck) flagged = true
        }
        // After the threshold of no-progress ticks it is declared stuck.
        expect(flagged).toBe(true)

        // The moment it makes real progress (a full cell jump), the counter resets.
        const moved = updateStuckTicks(grid, 100, 100, 100 + grid.cellSize, 100, true, stuckTicks)
        expect(moved.stuck).toBe(false)
        expect(moved.stuckTicks).toBe(0)
    })

    it("never flags a bot that is NOT trying to move", () => {
        const grid = buildNavGrid(BOUNDS, [], [])
        let stuckTicks = 0
        // Pinned in place but NOT wanting to move (parked / no target): never stuck.
        for(let i = 0; i < STUCK_TICKS_THRESHOLD * 2; i++){
            const out = updateStuckTicks(grid, 0, 0, 0, 0, false, stuckTicks)
            stuckTicks = out.stuckTicks
            expect(out.stuck).toBe(false)
            expect(out.stuckTicks).toBe(0)
        }
    })

    it("does not flag a bot that is slowly but genuinely making progress", () => {
        const grid = buildNavGrid(BOUNDS, [], [])
        let stuckTicks = 0
        let x = 0
        // Each tick it advances a full cell, which counts as progress, so it never
        // trips the stuck detector even though it keeps wanting to move.
        for(let i = 0; i < STUCK_TICKS_THRESHOLD * 2; i++){
            const next = x + grid.cellSize
            const out = updateStuckTicks(grid, x, 0, next, 0, true, stuckTicks)
            stuckTicks = out.stuckTicks
            x = next
            expect(out.stuck).toBe(false)
        }
    })
})

describe("local wall avoidance", () => {
    it("leaves the desired heading unchanged in open space", () => {
        const grid = buildNavGrid(BOUNDS, [], [])
        // No nearby walls -> the heading is returned as-is.
        const angle = Math.PI / 3
        expect(avoidWallsHeading(grid, 0, 0, angle)).toBe(angle)
    })

    it("nudges the heading away from an immediately adjacent wall", () => {
        // Build the grid by hand so we control exactly which neighbour is blocked.
        // Sit the bot on an OPEN cell whose EAST neighbour is blocked, then ask it
        // to drive due EAST (+x, angle 0) straight into that wall: avoidance must
        // deflect the heading off zero.
        const grid = buildNavGrid(BOUNDS, [], [])
        const cols = grid.cols
        const cx = Math.floor(grid.cols / 2)
        const cy = Math.floor(grid.rows / 2)
        grid.blocked[cy * cols + (cx + 1)] = true // east neighbour blocked

        expect(isCellOpen(grid, cx, cy)).toBe(true)
        expect(isCellOpen(grid, cx + 1, cy)).toBe(false)

        const centre = cellCenter(grid, cx, cy)
        const deflected = avoidWallsHeading(grid, centre.x, centre.y, 0)
        // The heading is pushed away from due-east (0); a meaningful deflection.
        expect(Math.abs(deflected)).toBeGreaterThan(0.1)
    })
})
