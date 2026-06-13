import { describe, expect, it } from "vitest"
import { PIP_MAPS } from "@pip-pip/game/src/maps"

describe("map themes", () => {
    it("every map defines a finite 24-bit background colour", () => {
        expect(PIP_MAPS.length).toBeGreaterThan(0)
        for(const map of PIP_MAPS){
            expect(Number.isFinite(map.background)).toBe(true)
            expect(map.background).toBeGreaterThanOrEqual(0)
            expect(map.background).toBeLessThanOrEqual(0xFFFFFF)
        }
    })

    it("maps have visually distinct backgrounds", () => {
        const colors = PIP_MAPS.map(map => map.background)
        expect(new Set(colors).size).toBe(colors.length)
    })
})
