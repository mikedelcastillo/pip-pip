import { describe, expect, it } from "vitest"
import { PIP_MAPS } from "@pip-pip/game/src/maps"

// "validate" is a diagnostic fixture map that intentionally ships zero spawns,
// so the "has spawns" assertion only applies to playable maps. Bounds and
// spawn-containment invariants still hold for every registered map.
const SPAWNLESS_MAP_IDS = new Set(["validate"])

// Covers every registered map (existing and newly authored) for the basic
// invariants applyMapBounds and spawning rely on, then pins the three new
// hand-authored maps by id, name and a distinct background.
describe("authored maps", () => {
    it("registers at least the five originals plus the three new maps", () => {
        expect(PIP_MAPS.length).toBeGreaterThanOrEqual(8)
    })

    describe.each(PIP_MAPS.map(m => [m.id, m] as const))("map %s", (id, map) => {
        it("constructs, has spawns, and has sane bounds containing every spawn", () => {
            const instance = map.createMap()

            // createMap() must not throw. Every playable map yields at least
            // one spawn; the diagnostic fixture is allowed none.
            if(!SPAWNLESS_MAP_IDS.has(id)){
                expect(instance.spawns.length).toBeGreaterThan(0)
            }

            const { min, max } = instance.bounds

            // Bounds finite and non-inverted.
            expect(Number.isFinite(min.x)).toBe(true)
            expect(Number.isFinite(min.y)).toBe(true)
            expect(Number.isFinite(max.x)).toBe(true)
            expect(Number.isFinite(max.y)).toBe(true)
            expect(min.x).toBeLessThan(max.x)
            expect(min.y).toBeLessThan(max.y)

            // Every spawn lies within the bounds.
            for(const spawn of instance.spawns){
                expect(spawn.x).toBeGreaterThanOrEqual(min.x)
                expect(spawn.x).toBeLessThanOrEqual(max.x)
                expect(spawn.y).toBeGreaterThanOrEqual(min.y)
                expect(spawn.y).toBeLessThanOrEqual(max.y)
            }
        })
    })

    const expectedNew = [
        { id: "drift", name: "Drift", background: 0x0E1518 },
        { id: "clash", name: "Clash", background: 0x1A0F0F },
        { id: "nexus", name: "Nexus", background: 0x12081C },
    ]

    it.each(expectedNew)("includes new map $id with name $name", expected => {
        const map = PIP_MAPS.find(m => m.id === expected.id)
        expect(map).toBeDefined()
        expect(map?.name).toBe(expected.name)
        expect(map?.background).toBe(expected.background)
    })

    it("gives every map a unique background colour", () => {
        const backgrounds = PIP_MAPS.map(m => m.background)
        expect(new Set(backgrounds).size).toBe(backgrounds.length)
    })
})
