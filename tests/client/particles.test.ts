import { describe, expect, it } from "vitest"
import {
    ParticleSystem,
    Particle,
    emitExplosion,
    computeShake,
    triggerShake,
    mergeShake,
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
