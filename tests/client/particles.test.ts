import { describe, expect, it } from "vitest"
import {
    ParticleSystem,
    Particle,
    WallSegment,
    emitExplosion,
    computeShake,
    triggerShake,
    mergeShake,
    computeShockwaveCenter,
} from "../../packages/client/src/game/particles"

function makeParticle(overrides: Partial<Particle> = {}): Particle {
    return {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        age: 0,
        lifespan: 1000,
        size: 4,
        color: 0xFFFFFF,
        drag: 0,
        gravity: 0,
        ...overrides,
    }
}

describe("ParticleSystem", () => {
    it("removes a particle once it outlives its lifespan", () => {
        const system = new ParticleSystem()
        system.emit([makeParticle({ lifespan: 100 })])
        expect(system.liveCount).toBe(1)
        system.update(150)
        expect(system.liveCount).toBe(0)
    })

    it("integrates position from velocity with no drag", () => {
        const system = new ParticleSystem()
        const p = makeParticle({ vx: 2, drag: 0 })
        system.emit([p])
        system.update(10)
        // x += vx * dt = 2 * 10 = 20
        expect(p.x).toBeCloseTo(20, 5)
    })

    it("reduces speed via drag", () => {
        const system = new ParticleSystem()
        const p = makeParticle({ vx: 10, drag: 0.01 })
        system.emit([p])
        system.update(100)
        const expected = 10 * Math.pow(0.99, 100)
        expect(p.vx).toBeLessThan(10)
        expect(p.vx).toBeCloseTo(expected, 5)
    })

    it("exposes a lifeRatio/alpha/size contract at half-life", () => {
        const p = makeParticle({ lifespan: 200, size: 8, age: 100 })
        const lifeRatio = p.age / p.lifespan
        const alpha = Math.max(0, 1 - lifeRatio)
        const drawSize = Math.max(0.5, p.size * (1 - lifeRatio))
        expect(lifeRatio).toBeCloseTo(0.5, 5)
        expect(alpha).toBeCloseTo(0.5, 5)
        expect(drawSize).toBeCloseTo(4, 5)
    })
})

describe("wall bounce", () => {
    // Horizontal wall along y = 0; radius 2 + particle radius 1 = 3px contact band.
    const wall: WallSegment = { x1: -100, y1: 0, x2: 100, y2: 0, radius: 2 }

    it("reflects a particle moving into a horizontal wall, losing energy", () => {
        const system = new ParticleSystem()
        // Start above the wall; after one 1ms step (dy = -5) it lands at y = 2,
        // inside the 3px contact band while still on the +y side.
        const p = makeParticle({ x: 0, y: 7, vx: 0, vy: -5 })
        system.emit([p])
        system.update(1, [wall])

        // Bounced back upward (away from the wall).
        expect(p.vy).toBeGreaterThan(0)
        // Restitution bled off speed.
        expect(Math.abs(p.vy)).toBeLessThan(5)
        // Pushed back outside the wall's contact band.
        expect(p.y).toBeGreaterThanOrEqual(wall.radius + 1)
    })

    it("leaves a particle moving away from the wall untouched", () => {
        const system = new ParticleSystem()
        // Sits inside the contact band but is moving away (+y), so no bounce.
        const p = makeParticle({ x: 0, y: 2.5, vx: 0, vy: 3 })
        system.emit([p])
        system.update(0, [wall])

        // Velocity unchanged: approaching test (v . n < 0) fails for an outbound
        // particle, so the normal component never flips.
        expect(p.vy).toBe(3)
        expect(p.vx).toBe(0)
    })
})

describe("emitExplosion", () => {
    it("emits the requested count with speeds within the tuned range", () => {
        const system = new ParticleSystem()
        emitExplosion(system, 0, 0, 28)
        expect(system.liveCount).toBe(28)
        system.forEach(p => {
            const speed = Math.hypot(p.vx, p.vy)
            expect(speed).toBeGreaterThanOrEqual(1.5)
            expect(speed).toBeLessThanOrEqual(6.0)
        })
    })
})

describe("shockwave center", () => {
    // The world point's logical screen position is the viewport offset plus the
    // world point (the viewport container is unscaled), and ShockwaveFilter wants
    // its center in the input texture's PHYSICAL pixels, so it scales by resolution.
    it("maps a world point through the viewport offset to a screen position", () => {
        // Camera centered so the viewport is offset by half the screen; a blast at
        // world (200, 50) sits at screen (400 + 200, 300 + 50) at resolution 1.
        const center = computeShockwaveCenter(400, 300, 200, 50, 1)
        expect(center.x).toBeCloseTo(600, 5)
        expect(center.y).toBeCloseTo(350, 5)
    })

    it("scales the screen position by the renderer resolution", () => {
        // The bug: on a 2x (retina/mobile) display the filter center must be in
        // physical pixels, so the same blast lands at twice the logical position.
        const center = computeShockwaveCenter(400, 300, 200, 50, 2)
        expect(center.x).toBeCloseTo(1200, 5)
        expect(center.y).toBeCloseTo(700, 5)
    })

    it("tracks the camera: a fixed world point moves as the viewport offset changes", () => {
        // Same blast, two camera positions -> two distinct screen centers, so the
        // ring stays pinned to the world blast as the camera pans.
        const a = computeShockwaveCenter(400, 300, 0, 0, 1)
        const b = computeShockwaveCenter(500, 300, 0, 0, 1)
        expect(b.x - a.x).toBeCloseTo(100, 5)
    })
})

describe("screen shake", () => {
    it("decays to ~zero amplitude at the end of its duration", () => {
        const state = triggerShake(20, 500)
        const { dx, dy } = computeShake(state, 500)
        expect(Math.hypot(dx, dy)).toBeCloseTo(0, 5)
    })

    it("keeps the stronger shake, then yields to the weaker one once elapsed", () => {
        const strong = triggerShake(20, 500)
        const weak = triggerShake(5, 500)

        // Fresh strong shake should win over a weaker incoming one.
        expect(mergeShake(strong, weak)).toBe(strong)

        // Drain the strong shake so its effective intensity drops below the weak one.
        strong.elapsed = strong.duration
        const result = mergeShake(strong, weak)
        expect(result).toBe(weak)
    })
})
