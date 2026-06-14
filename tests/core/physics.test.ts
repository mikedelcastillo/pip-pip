import { describe, expect, it } from "vitest"
import { PointPhysicsObject, PointPhysicsSegmentWall, PointPhysicsWorld } from "@pip-pip/core/src/physics"

// Two equal-mass circles on a head-on collision course, mirror-imaged about
// x = 0: A on the left moving right, B on the right moving left, both on y = 0.
// The setup is symmetric about x = 0, so the resolved state must stay
// mirror-symmetric.
//
// The collision impulse is driven by the *relative* velocity of the predicted
// positions: (a.pos + a.vel) - (b.pos + b.vel). The old code computed
// `a.pos.x + a.vel.x - b.pos.x + b.velocity.x`, i.e. it ADDED b.velocity
// instead of subtracting it. For this head-on pair that turns the relative
// velocity term (a.vel - b.vel = 10 - (-10) = 20) into (a.vel + b.vel = 0),
// which zeroes the response velocity and over-separates the bodies. The
// magnitude assertions below fail under that bug.
function makeHeadOnPair(){
    const a = new PointPhysicsObject("a")
    const b = new PointPhysicsObject("b")

    a.radius = b.radius = 25
    a.mass = b.mass = 100
    // No air resistance so the only force is the collision response.
    a.airResistance = b.airResistance = 0

    // Overlapping (centres 30 apart, radii sum 50) and closing.
    a.position.set(-15, 0)
    b.position.set(15, 0)
    a.velocity.set(10, 0)
    b.velocity.set(-10, 0)

    const world = new PointPhysicsWorld({ baseTps: 20, maxVelocity: 500 })
    world.addObject(a)
    world.addObject(b)
    return { world, a, b }
}

describe("PointPhysicsWorld collision symmetry", () => {
    it("resolves a symmetric head-on collision into a mirror-image state", () => {
        const { world, a, b } = makeHeadOnPair()

        world.update(1000 / 20) // one base tick

        // Positions stay mirror-image about x = 0 and on the y = 0 axis.
        expect(a.position.x).toBeCloseTo(-b.position.x, 6)
        expect(a.position.y).toBeCloseTo(0, 6)
        expect(b.position.y).toBeCloseTo(0, 6)

        // Velocities stay mirror-image about x = 0, with no spurious y drift.
        expect(a.velocity.x).toBeCloseTo(-b.velocity.x, 6)
        expect(a.velocity.y).toBeCloseTo(0, 6)
        expect(b.velocity.y).toBeCloseTo(0, 6)
    })

    it("damps closing velocity rather than zeroing it (catches the sign bug)", () => {
        const { world, a, b } = makeHeadOnPair()

        world.update(1000 / 20)

        // With the correct relative-velocity sign the bodies are still closing
        // but slowed (10 -> ~6.67). The sign bug collapses the relative velocity
        // to 0, which zeroes both velocities entirely.
        expect(Math.abs(a.velocity.x)).toBeGreaterThan(1)
        expect(Math.abs(b.velocity.x)).toBeGreaterThan(1)
        // They have not been blasted apart to exactly the contact distance
        // (the degenerate behaviour the bug produced: |x| === radius sum / 2).
        expect(Math.abs(a.position.x)).toBeLessThan(25)
        expect(Math.abs(b.position.x)).toBeLessThan(25)
    })
})

// A horizontal segment wall from (0,0) to (100,0) with radius 36 (the diagonal
// half-tile thickness). An object of radius 20 has minDist = 56, so a capsule
// blocks within 56 units of the spine (including the half-circle past each
// endpoint). These tests prove the new cappedEnds field: capped (default) keeps
// the old endcap; uncapped drops only the endcap while keeping the span barrier.
function makeSegWallWorld(cappedEnds: boolean){
    const wall = new PointPhysicsSegmentWall("w", 0, 0, 100, 0)
    wall.radius = 36
    wall.cappedEnds = cappedEnds

    const object = new PointPhysicsObject("o")
    object.radius = 20
    object.airResistance = 0

    const world = new PointPhysicsWorld({ baseTps: 20, maxVelocity: 500 })
    world.addObject(object)
    world.addSegWall(wall)
    return { world, object, wall }
}

describe("PointPhysicsSegmentWall endcap capping", () => {
    it("a CAPPED segWall pushes an object beyond an endpoint (endcap region)", () => {
        // Default capped behaviour: an object just past the (0,0) endpoint, well
        // inside the rounded endcap (distance to endpoint ~ 30 < minDist 56), is
        // pushed out exactly as the original capsule did.
        const { world, object } = makeSegWallWorld(true)
        object.position.set(-10, 28)

        world.resolveWallCollisions(object)

        // It moved away from the endpoint (the half-circle endcap pushed it out).
        const dist = Math.sqrt(object.position.x ** 2 + object.position.y ** 2)
        expect(dist).toBeGreaterThan(55)
        expect(dist).toBeCloseTo(56, 6)
    })

    it("an UNCAPPED segWall does NOT push an object beyond its span (t < 0 or t > 1)", () => {
        // Same geometry, but uncapped: the object sits past the endpoint (t < 0),
        // in the old endcap region, so it must be left untouched.
        const { world, object } = makeSegWallWorld(false)
        object.position.set(-10, 28)

        world.resolveWallCollisions(object)

        expect(object.position.x).toBe(-10)
        expect(object.position.y).toBe(28)
    })

    it("an UNCAPPED segWall STILL pushes an object alongside its span (face stays solid)", () => {
        // Object centred over the span (t = 0.5) and overlapping the face is
        // pushed straight out along the perpendicular, so it cannot pass through.
        const { world, object } = makeSegWallWorld(false)
        object.position.set(50, 28)

        world.resolveWallCollisions(object)

        // Pushed clear along +y to exactly minDist (56) above the spine; x stays.
        expect(object.position.x).toBeCloseTo(50, 6)
        expect(object.position.y).toBeCloseTo(56, 6)
    })

    it("a zero-length UNCAPPED segment does not divide-by-zero (treated as capped)", () => {
        // start == end: segLenSq is 0, so the span projection is skipped and the
        // wall behaves as the original circle/capsule (capped). The object must be
        // pushed out, not NaN.
        const wall = new PointPhysicsSegmentWall("z", 0, 0, 0, 0)
        wall.radius = 36
        wall.cappedEnds = false

        const object = new PointPhysicsObject("o")
        object.radius = 20
        object.airResistance = 0
        object.position.set(0, 10)

        const world = new PointPhysicsWorld({ baseTps: 20, maxVelocity: 500 })
        world.addObject(object)
        world.addSegWall(wall)

        world.resolveWallCollisions(object)

        expect(Number.isNaN(object.position.x)).toBe(false)
        expect(Number.isNaN(object.position.y)).toBe(false)
        // Pushed out along +y to the full minDist (56) from the point.
        expect(object.position.x).toBeCloseTo(0, 6)
        expect(object.position.y).toBeCloseTo(56, 6)
    })
})
