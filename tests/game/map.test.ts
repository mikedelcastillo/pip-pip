import { describe, expect, it } from "vitest"
import { JSONPipGameMap, PIP_MAP_DEFAULT_BOUNDS, type JSONMapSource } from "@pip-pip/game/src/logic/map"
import { TILE_SIZE } from "@pip-pip/game/src/logic/constants"

const emptySource = (): JSONMapSource => ({
    wall_tiles: [],
    spawn_tiles: [],
    wall_segments: [],
    wall_segment_tiles: [],
})

// Guards the map bounds computation that applyMapBounds relies on. Inverted
// bounds (min > max) would mis-clamp ships, and segments not covered by tiles
// must still be enclosed.
describe("JSONPipGameMap bounds", () => {
    it("encloses wall segments even when there are no tiles", () => {
        // A single segment from tile (2,3) to (8,5) and nothing else.
        const map = new JSONPipGameMap("seg-only", {
            ...emptySource(),
            wall_segments: [[2, 3, 8, 5]],
        })
        const { min, max } = map.bounds

        // Finite and non-inverted.
        expect(Number.isFinite(min.x)).toBe(true)
        expect(Number.isFinite(min.y)).toBe(true)
        expect(Number.isFinite(max.x)).toBe(true)
        expect(Number.isFinite(max.y)).toBe(true)
        expect(min.x).toBeLessThan(max.x)
        expect(min.y).toBeLessThan(max.y)

        // Both segment endpoints (scaled by TILE_SIZE) fall inside the bounds.
        for(const [tx, ty] of [[2, 3], [8, 5]]){
            const x = tx * TILE_SIZE
            const y = ty * TILE_SIZE
            expect(x).toBeGreaterThanOrEqual(min.x)
            expect(x).toBeLessThanOrEqual(max.x)
            expect(y).toBeGreaterThanOrEqual(min.y)
            expect(y).toBeLessThanOrEqual(max.y)
        }
    })

    it("falls back to the default box for a totally empty map", () => {
        const map = new JSONPipGameMap("empty", emptySource())
        const { min, max } = map.bounds

        expect(Number.isFinite(min.x)).toBe(true)
        expect(Number.isFinite(max.x)).toBe(true)
        expect(min.x).toBeLessThan(max.x)
        expect(min.y).toBeLessThan(max.y)

        // Default box is centred on the origin with a half-tile margin.
        expect(min.x).toBe(-PIP_MAP_DEFAULT_BOUNDS - TILE_SIZE / 2)
        expect(max.x).toBe(PIP_MAP_DEFAULT_BOUNDS + TILE_SIZE / 2)
        expect(min.y).toBe(-PIP_MAP_DEFAULT_BOUNDS - TILE_SIZE / 2)
        expect(max.y).toBe(PIP_MAP_DEFAULT_BOUNDS + TILE_SIZE / 2)
    })

    it("lets tiles dominate bounds where present (segments only widen)", () => {
        // Tiles span (0,0)..(10,10); a segment sits well inside them.
        const wall_tiles: number[][] = [[0, 0], [10, 10]]
        const map = new JSONPipGameMap("tiles", {
            ...emptySource(),
            wall_tiles,
            wall_segments: [[3, 3, 4, 4]],
        })
        const { min, max } = map.bounds

        // Bounds match the tile extents (+/- half tile), unaffected by the inner segment.
        expect(min.x).toBe(0 - TILE_SIZE / 2)
        expect(min.y).toBe(0 - TILE_SIZE / 2)
        expect(max.x).toBe(10 * TILE_SIZE + TILE_SIZE / 2)
        expect(max.y).toBe(10 * TILE_SIZE + TILE_SIZE / 2)
    })
})
