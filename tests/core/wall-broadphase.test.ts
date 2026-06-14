import { describe, expect, it } from "vitest"
import {
    PointPhysicsObject,
    PointPhysicsRectWall,
    PointPhysicsSegmentWall,
    PointPhysicsWorld,
    Vector2,
    WallGrid,
} from "@pip-pip/core/src/physics"
import {
    distanceBetweenSegments,
    distanceSegmentToRect,
    nearestPointFromSegment,
} from "@pip-pip/core/src/math"

// Deterministic PRNG (mulberry32) so every "random" trial is reproducible and
// the suite never depends on the global Math.random state. Math.random is fine
// in tests, but a seeded generator makes a failure reproducible from the seed.
function mulberry32(seed: number){
    let a = seed >>> 0
    return function(){
        a |= 0
        a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function randRange(rng: () => number, min: number, max: number){
    return min + rng() * (max - min)
}

// REFERENCE brute-force wall resolver: a verbatim copy of the pre-broadphase
// resolveWallCollisions that iterates EVERY wall in Object.values order. The
// production resolver must produce byte-identical position/velocity to this for
// every configuration; that is the whole behaviour-preserving claim.
function applyWallContactRef(object: PointPhysicsObject, nx: number, ny: number, push: number){
    object.position.x += nx * push
    object.position.y += ny * push
    const into = object.velocity.x * nx + object.velocity.y * ny
    if(into < 0){
        object.velocity.x -= nx * into
        object.velocity.y -= ny * into
    }
}

const MIN_DIST = 0.0001

function bruteResolveWalls(
    object: PointPhysicsObject,
    segWalls: PointPhysicsSegmentWall[],
    rectWalls: PointPhysicsRectWall[],
){
    if(object.collision.enabled === false) return

    for(const segWall of segWalls){
        const minDist = object.radius + segWall.radius

        if(object.position.x < Math.min(segWall.start.x, segWall.end.x) - minDist) continue
        if(object.position.x > Math.max(segWall.start.x, segWall.end.x) + minDist) continue
        if(object.position.y < Math.min(segWall.start.y, segWall.end.y) - minDist) continue
        if(object.position.y > Math.max(segWall.start.y, segWall.end.y) + minDist) continue

        const near = nearestPointFromSegment(
            segWall.start.x, segWall.start.y,
            segWall.end.x, segWall.end.y,
            object.position.x, object.position.y,
        )
        let nx = object.position.x - near.x
        let ny = object.position.y - near.y
        let dist = Math.sqrt(nx * nx + ny * ny)
        if(dist >= minDist) continue

        if(dist < MIN_DIST){
            const sx = segWall.end.x - segWall.start.x
            const sy = segWall.end.y - segWall.start.y
            const slen = Math.max(MIN_DIST, Math.sqrt(sx * sx + sy * sy))
            nx = -sy / slen
            ny = sx / slen
            dist = MIN_DIST
        } else{
            nx /= dist
            ny /= dist
        }

        applyWallContactRef(object, nx, ny, minDist - dist)
    }

    for(const rectWall of rectWalls){
        const halfW = rectWall.width / 2
        const halfH = rectWall.height / 2
        const dxC = object.position.x - rectWall.center.x
        const dyC = object.position.y - rectWall.center.y

        if(Math.abs(dxC) > halfW + object.radius) continue
        if(Math.abs(dyC) > halfH + object.radius) continue

        if(Math.abs(dxC) < halfW && Math.abs(dyC) < halfH){
            const penX = halfW - Math.abs(dxC)
            const penY = halfH - Math.abs(dyC)
            let nx = 0
            let ny = 0
            let pen = 0
            if(penX < penY){ nx = dxC >= 0 ? 1 : -1; pen = penX } else{ ny = dyC >= 0 ? 1 : -1; pen = penY }
            applyWallContactRef(object, nx, ny, pen + object.radius)
            continue
        }

        const nearestX = rectWall.center.x + Math.max(-halfW, Math.min(halfW, dxC))
        const nearestY = rectWall.center.y + Math.max(-halfH, Math.min(halfH, dyC))
        let nx = object.position.x - nearestX
        let ny = object.position.y - nearestY
        const dist = Math.sqrt(nx * nx + ny * ny)
        if(dist >= object.radius || dist < MIN_DIST) continue
        nx /= dist
        ny /= dist
        applyWallContactRef(object, nx, ny, object.radius - dist)
    }
}

function makeRectWall(id: string, cx: number, cy: number, w: number, h: number){
    const wall = new PointPhysicsRectWall(id)
    wall.center = new Vector2(cx, cy)
    wall.width = w
    wall.height = h
    return wall
}

function makeSegWall(id: string, sx: number, sy: number, ex: number, ey: number, r: number){
    const wall = new PointPhysicsSegmentWall(id, sx, sy, ex, ey)
    wall.radius = r
    return wall
}

describe("WallGrid spatial hash", () => {
    it("query returns the same membership as a brute-force AABB overlap scan", () => {
        const rng = mulberry32(1234)
        const grid = new WallGrid()
        const boxes: { id: string, minX: number, minY: number, maxX: number, maxY: number }[] = []
        for(let i = 0; i < 200; i++){
            const id = "w" + i
            const cx = randRange(rng, -4000, 4000)
            const cy = randRange(rng, -4000, 4000)
            const hw = randRange(rng, 10, 400)
            const hh = randRange(rng, 10, 400)
            const minX = cx - hw, minY = cy - hh, maxX = cx + hw, maxY = cy + hh
            grid.insert(id, minX, minY, maxX, maxY)
            boxes.push({ id, minX, minY, maxX, maxY })
        }

        for(let q = 0; q < 500; q++){
            const qx = randRange(rng, -4500, 4500)
            const qy = randRange(rng, -4500, 4500)
            const qhw = randRange(rng, 0, 300)
            const qhh = randRange(rng, 0, 300)
            const qMinX = qx - qhw, qMinY = qy - qhh, qMaxX = qx + qhw, qMaxY = qy + qhh

            const got = grid.query(qMinX, qMinY, qMaxX, qMaxY)

            // The grid must be a SUPERSET of every truly overlapping box (no
            // missed candidates), which is the only correctness requirement.
            for(const box of boxes){
                const overlaps =
                    box.maxX >= qMinX && box.minX <= qMaxX &&
                    box.maxY >= qMinY && box.minY <= qMaxY
                if(overlaps){
                    expect(got.has(box.id)).toBe(true)
                }
            }
        }
    })

    it("insert then remove leaves a query empty; re-add restores it", () => {
        const grid = new WallGrid()
        grid.insert("a", 0, 0, 100, 100)
        grid.insert("b", 5000, 5000, 5100, 5100)

        expect(grid.query(0, 0, 10, 10).has("a")).toBe(true)
        expect(grid.query(0, 0, 10, 10).has("b")).toBe(false)

        grid.remove("a")
        expect(grid.query(0, 0, 10, 10).has("a")).toBe(false)
        // Removing one wall must not disturb the other.
        expect(grid.query(5000, 5000, 5010, 5010).has("b")).toBe(true)

        grid.insert("a", 0, 0, 100, 100)
        expect(grid.query(0, 0, 10, 10).has("a")).toBe(true)
    })

    it("re-inserting the same id does not accumulate stale cells", () => {
        const grid = new WallGrid()
        grid.insert("a", 0, 0, 100, 100)
        // Move the wall far away by re-inserting under the same id.
        grid.insert("a", 9000, 9000, 9100, 9100)
        expect(grid.query(0, 0, 10, 10).has("a")).toBe(false)
        expect(grid.query(9000, 9000, 9010, 9010).has("a")).toBe(true)
    })

    // PERF-SHAPE GUARD: the defect this feature fixes was a query that scanned
    // ALL walls. Here 5000 walls are clustered in a far-away region and a small
    // AABB is queried elsewhere; an O(all-walls) query would still "touch" every
    // wall, but a true cell-only query must return a candidate count bounded by
    // the cells the AABB overlaps times their occupancy, NOT the total wall
    // count. We assert the candidate set is tiny (here: empty, since the query
    // is far from every wall) so a regression back to a full scan is caught.
    it("queryOrdered returns a tiny candidate set, not all N walls", () => {
        const rng = mulberry32(555)
        const grid = new WallGrid()
        const total = 5000
        // Pack every wall into a distant cluster far from the query region.
        for(let i = 0; i < total; i++){
            const cx = randRange(rng, 50000, 60000)
            const cy = randRange(rng, 50000, 60000)
            grid.insert("w" + i, cx - 20, cy - 20, cx + 20, cy + 20)
        }

        // A small AABB near the origin, far from the cluster.
        const candidates = grid.queryOrdered(-50, -50, 50, 50)
        expect(candidates.length).toBe(0)
        expect(candidates.length).toBeLessThan(total)

        // Now place ONE wall inside the query region and a few neighbours just
        // outside. The candidate set must be bounded by what the AABB's cells
        // hold (a handful), never the full 5000+ walls.
        grid.insert("near", -10, -10, 10, 10)
        grid.insert("near2", 30, 30, 60, 60)
        const withNear = grid.queryOrdered(-50, -50, 50, 50)
        expect(withNear.length).toBeLessThan(50)
        expect(withNear).toContain("near")
        // The distant 5000 walls must NOT leak into a small local query.
        for(const id of withNear){
            expect(id.startsWith("w")).toBe(false)
        }
    })

    // The ordinal-based ordering must reproduce Object.values(record) order even
    // when ids are all-digit strings (which V8 hoists to the front in numeric
    // order) interleaved with ordinary string ids (insertion order). queryOrdered
    // over the whole populated region must match Object.values of a parallel
    // record built by inserting the same ids in the same sequence.
    it("queryOrdered reproduces Object.values key order, incl. numeric-string ids", () => {
        const grid = new WallGrid()
        const record: Record<string, true> = {}
        // Mix: ordinary string ids and all-digit (array-index) ids, inserted in
        // an order that V8 will NOT preserve for the numeric ones.
        const ids = ["sX", "9999", "alpha", "1234", "beta", "10", "0234", "2"]
        for(const id of ids){
            grid.insert(id, 0, 0, 50, 50)
            record[id] = true
        }
        const got = grid.queryOrdered(0, 0, 50, 50)
        expect(got).toEqual(Object.keys(record))
    })
})

describe("resolveWallCollisions broadphase equivalence vs brute force", () => {
    // Build a world plus a parallel ordered wall list (the order add* was
    // called, which Object.values preserves) for the reference resolver.
    function buildWorld(rng: () => number){
        const world = new PointPhysicsWorld()
        const segWalls: PointPhysicsSegmentWall[] = []
        const rectWalls: PointPhysicsRectWall[] = []

        const segCount = Math.floor(randRange(rng, 0, 12))
        const rectCount = Math.floor(randRange(rng, 0, 12))

        for(let i = 0; i < segCount; i++){
            const sx = randRange(rng, -600, 600)
            const sy = randRange(rng, -600, 600)
            const ex = sx + randRange(rng, -200, 200)
            const ey = sy + randRange(rng, -200, 200)
            const r = randRange(rng, 0, 40)
            const wall = makeSegWall("s" + i, sx, sy, ex, ey, r)
            world.addSegWall(wall)
            segWalls.push(wall)
        }
        for(let i = 0; i < rectCount; i++){
            const cx = randRange(rng, -600, 600)
            const cy = randRange(rng, -600, 600)
            const w = randRange(rng, 20, 200)
            const h = randRange(rng, 20, 200)
            const wall = makeRectWall("r" + i, cx, cy, w, h)
            world.addRectWall(wall)
            rectWalls.push(wall)
        }

        return { world, segWalls, rectWalls }
    }

    function makeObject(rng: () => number, x: number, y: number){
        const object = new PointPhysicsObject("obj")
        object.position.set(x, y)
        object.velocity.set(randRange(rng, -150, 150), randRange(rng, -150, 150))
        object.radius = randRange(rng, 10, 50)
        return object
    }

    it("matches brute force for hundreds of randomized free-space trials", () => {
        const rng = mulberry32(42)
        for(let trial = 0; trial < 400; trial++){
            const { world, segWalls, rectWalls } = buildWorld(rng)
            const x = randRange(rng, -700, 700)
            const y = randRange(rng, -700, 700)

            const indexed = makeObject(rng, x, y)
            const brute = makeObject(() => 0, x, y)
            // Copy the index object's randomized fields onto the brute object so
            // both start identical.
            brute.velocity.set(indexed.velocity.x, indexed.velocity.y)
            brute.radius = indexed.radius
            world.addObject(indexed)

            world.resolveWallCollisions(indexed)
            bruteResolveWalls(brute, segWalls, rectWalls)

            expect(indexed.position.x).toBe(brute.position.x)
            expect(indexed.position.y).toBe(brute.position.y)
            expect(indexed.velocity.x).toBe(brute.velocity.x)
            expect(indexed.velocity.y).toBe(brute.velocity.y)
        }
    })

    it("matches brute force when sitting in corners touching 2-3 walls at once", () => {
        const rng = mulberry32(7)
        for(let trial = 0; trial < 300; trial++){
            // A tight L / box corner: two perpendicular rect walls plus an
            // optional diagonal seg wall, with the object placed at the inner
            // corner so it overlaps multiple walls in one tick. Resolution order
            // matters here, so a match proves order is preserved.
            const world = new PointPhysicsWorld()
            const segWalls: PointPhysicsSegmentWall[] = []
            const rectWalls: PointPhysicsRectWall[] = []

            const cornerX = randRange(rng, -300, 300)
            const cornerY = randRange(rng, -300, 300)

            const left = makeRectWall("rL", cornerX - 100, cornerY, 200, 40)
            const bottom = makeRectWall("rB", cornerX, cornerY - 100, 40, 200)
            world.addRectWall(left); rectWalls.push(left)
            world.addRectWall(bottom); rectWalls.push(bottom)

            if(rng() > 0.5){
                const seg = makeSegWall("sD", cornerX - 80, cornerY - 80, cornerX + 80, cornerY + 80, randRange(rng, 5, 36))
                world.addSegWall(seg); segWalls.push(seg)
            }

            const ox = cornerX + randRange(rng, -30, 30)
            const oy = cornerY + randRange(rng, -30, 30)

            const indexed = makeObject(rng, ox, oy)
            const brute = new PointPhysicsObject("obj")
            brute.position.set(ox, oy)
            brute.velocity.set(indexed.velocity.x, indexed.velocity.y)
            brute.radius = indexed.radius
            world.addObject(indexed)

            // Run multiple iterations like the world step (corners need it).
            for(let it = 0; it < 2; it++){
                world.resolveWallCollisions(indexed)
                bruteResolveWalls(brute, segWalls, rectWalls)
            }

            expect(indexed.position.x).toBe(brute.position.x)
            expect(indexed.position.y).toBe(brute.position.y)
            expect(indexed.velocity.x).toBe(brute.velocity.x)
            expect(indexed.velocity.y).toBe(brute.velocity.y)
        }
    })

    it("returns empty candidates and no contact for objects far from any wall", () => {
        const world = new PointPhysicsWorld()
        world.addRectWall(makeRectWall("r0", 0, 0, 100, 100))
        world.addSegWall(makeSegWall("s0", 0, 0, 50, 50, 25))

        const object = new PointPhysicsObject("obj")
        object.position.set(100000, 100000)
        object.velocity.set(10, -10)
        object.radius = 25
        world.addObject(object)

        expect(world.querySegWalls(99975, 99975, 100025, 100025)).toEqual([])
        expect(world.queryRectWalls(99975, 99975, 100025, 100025)).toEqual([])

        world.resolveWallCollisions(object)
        expect(object.position.x).toBe(100000)
        expect(object.position.y).toBe(100000)
        expect(object.velocity.x).toBe(10)
        expect(object.velocity.y).toBe(-10)
    })

    it("works on a tiny map with a single wall (no regression for small worlds)", () => {
        const rng = mulberry32(99)
        const world = new PointPhysicsWorld()
        const wall = makeRectWall("only", 0, 0, 80, 80)
        world.addRectWall(wall)

        for(let trial = 0; trial < 100; trial++){
            const x = randRange(rng, -100, 100)
            const y = randRange(rng, -100, 100)
            const indexed = new PointPhysicsObject("obj")
            indexed.position.set(x, y)
            indexed.velocity.set(randRange(rng, -50, 50), randRange(rng, -50, 50))
            indexed.radius = randRange(rng, 10, 40)
            const brute = new PointPhysicsObject("obj")
            brute.position.set(x, y)
            brute.velocity.set(indexed.velocity.x, indexed.velocity.y)
            brute.radius = indexed.radius
            world.addObject(indexed)

            world.resolveWallCollisions(indexed)
            bruteResolveWalls(brute, [], [wall])

            expect(indexed.position.x).toBe(brute.position.x)
            expect(indexed.position.y).toBe(brute.position.y)
            expect(indexed.velocity.x).toBe(brute.velocity.x)
            expect(indexed.velocity.y).toBe(brute.velocity.y)
        }
    })
})

describe("bullet motion-segment broadphase parity", () => {
    // A bullet is a moving point with radius hitRadius. The broadphase query
    // must return a SUPERSET of the walls a brute-force swept scan flags as a
    // hit, so no contact is ever missed. We compare query membership against the
    // exact narrowphase the bullet loop uses (distanceBetweenSegments /
    // distanceSegmentToRect).
    it("query is a superset of every swept-scan hit across randomized bullets", () => {
        const rng = mulberry32(2024)
        for(let trial = 0; trial < 400; trial++){
            const world = new PointPhysicsWorld()
            const segWalls: PointPhysicsSegmentWall[] = []
            const rectWalls: PointPhysicsRectWall[] = []

            const segCount = Math.floor(randRange(rng, 0, 10))
            const rectCount = Math.floor(randRange(rng, 0, 10))
            for(let i = 0; i < segCount; i++){
                const sx = randRange(rng, -500, 500)
                const sy = randRange(rng, -500, 500)
                const ex = sx + randRange(rng, -300, 300)
                const ey = sy + randRange(rng, -300, 300)
                const wall = makeSegWall("s" + i, sx, sy, ex, ey, 36)
                world.addSegWall(wall); segWalls.push(wall)
            }
            for(let i = 0; i < rectCount; i++){
                const cx = randRange(rng, -500, 500)
                const cy = randRange(rng, -500, 500)
                const wall = makeRectWall("r" + i, cx, cy, randRange(rng, 30, 150), randRange(rng, 30, 150))
                world.addRectWall(wall); rectWalls.push(wall)
            }

            const px = randRange(rng, -600, 600)
            const py = randRange(rng, -600, 600)
            const vx = randRange(rng, -100, 100)
            const vy = randRange(rng, -100, 100)
            const hitRadius = randRange(rng, 4, 16)

            const minX = Math.min(px, px + vx) - hitRadius
            const minY = Math.min(py, py + vy) - hitRadius
            const maxX = Math.max(px, px + vx) + hitRadius
            const maxY = Math.max(py, py + vy) + hitRadius

            const segCandidates = new Set(world.querySegWalls(minX, minY, maxX, maxY).map(w => w.id))
            const rectCandidates = new Set(world.queryRectWalls(minX, minY, maxX, maxY).map(w => w.id))

            for(const segWall of segWalls){
                const dist = distanceBetweenSegments(
                    px, py, px + vx, py + vy,
                    segWall.start.x, segWall.start.y, segWall.end.x, segWall.end.y,
                )
                if(dist <= hitRadius + segWall.radius){
                    expect(segCandidates.has(segWall.id)).toBe(true)
                }
            }
            for(const rectWall of rectWalls){
                const dist = distanceSegmentToRect(
                    px, py, px + vx, py + vy,
                    rectWall.center.x, rectWall.center.y, rectWall.width, rectWall.height,
                )
                if(dist <= hitRadius){
                    expect(rectCandidates.has(rectWall.id)).toBe(true)
                }
            }
        }
    })
})
