import { describe, expect, it } from "vitest"
import { PointPhysicsObject, PointPhysicsWorld } from "@pip-pip/core/src/physics"

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
