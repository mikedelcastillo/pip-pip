import { describe, expect, it } from "vitest"
import {
    tilePolygon,
    materialStyleFor,
    isDiagonalTile,
    polygonToFlat,
    hashMaterialKey,
    TILE_MATERIAL_STYLES,
} from "@pip-pip/client/src/game/mapGraphics"
import { PipGameTile } from "@pip-pip/game/src/logic/map"
import { TILE_SIZE } from "@pip-pip/game/src/logic/constants"

// Pure-geometry tests for the Phase 2 map render model: a tile's polygon must
// match its shape (square for full/deco, the right triangle for each diagonal)
// and a tile's block style must be deterministic and on-palette. No Pixi here.

const half = TILE_SIZE / 2

function tile(partial: Partial<PipGameTile>): PipGameTile{
    return { x: 0, y: 0, texture: "tile_default", ...partial }
}

describe("tilePolygon shapes", () => {
    it("draws a full tile as the whole square (4 corners)", () => {
        const points = tilePolygon(tile({ shape: "full" }))
        expect(points.length).toBe(4)
        const xs = points.map(p => p.x).sort((a, b) => a - b)
        const ys = points.map(p => p.y).sort((a, b) => a - b)
        expect(xs[0]).toBe(-half)
        expect(xs[xs.length - 1]).toBe(half)
        expect(ys[0]).toBe(-half)
        expect(ys[ys.length - 1]).toBe(half)
    })

    it("treats a missing shape (legacy tile) as a full square", () => {
        const points = tilePolygon(tile({}))
        expect(points.length).toBe(4)
    })

    it("treats a deco tile as a full square (legacy migrated look)", () => {
        const points = tilePolygon(tile({ shape: "deco" }))
        expect(points.length).toBe(4)
    })

    it("draws each diagonal as a right triangle (3 corners)", () => {
        for(const shape of ["diag_tl", "diag_tr", "diag_bl", "diag_br"] as const){
            const points = tilePolygon(tile({ shape }))
            expect(points.length).toBe(3)
        }
    })

    it("matches diag_tl: right angle top-left, hypotenuse top-right to bottom-left", () => {
        // The slope endpoints must be the two corners that are NOT the filled
        // (right-angle) corner, so the triangle's face lines up with the 45-degree
        // segWall a ship glides along.
        const points = tilePolygon(tile({ shape: "diag_tl" }))
        const set = new Set(points.map(p => p.x + "," + p.y))
        expect(set.has(-half + "," + -half)).toBe(true) // top-left (right angle)
        expect(set.has(half + "," + -half)).toBe(true)  // top-right
        expect(set.has(-half + "," + half)).toBe(true)  // bottom-left
        // The bottom-right corner is empty for diag_tl.
        expect(set.has(half + "," + half)).toBe(false)
    })

    it("matches diag_br: bottom-right filled, top-left corner empty", () => {
        const points = tilePolygon(tile({ shape: "diag_br" }))
        const set = new Set(points.map(p => p.x + "," + p.y))
        expect(set.has(half + "," + half)).toBe(true)   // bottom-right (right angle)
        expect(set.has(-half + "," + -half)).toBe(false) // top-left empty
    })

    it("offsets the polygon to the tile world position", () => {
        const points = tilePolygon(tile({ x: 100, y: 200, shape: "full" }))
        const xs = points.map(p => p.x)
        const ys = points.map(p => p.y)
        expect(Math.min(...xs)).toBe(100 - half)
        expect(Math.max(...xs)).toBe(100 + half)
        expect(Math.min(...ys)).toBe(200 - half)
        expect(Math.max(...ys)).toBe(200 + half)
    })
})

describe("isDiagonalTile", () => {
    it("is true for diagonals and false for square shapes", () => {
        expect(isDiagonalTile(tile({ shape: "diag_tr" }))).toBe(true)
        expect(isDiagonalTile(tile({ shape: "full" }))).toBe(false)
        expect(isDiagonalTile(tile({ shape: "deco" }))).toBe(false)
        expect(isDiagonalTile(tile({}))).toBe(false)
    })
})

describe("polygonToFlat", () => {
    it("flattens points into an [x0,y0,x1,y1,...] array", () => {
        const flat = polygonToFlat([{ x: 1, y: 2 }, { x: 3, y: 4 }])
        expect(flat).toEqual([1, 2, 3, 4])
    })
})

describe("materialStyleFor variety", () => {
    it("maps the legacy keys to the original dark styles", () => {
        expect(materialStyleFor(tile({ material: "tile_default" }))).toEqual(TILE_MATERIAL_STYLES.tile_default)
        expect(materialStyleFor(tile({ material: "tile_hidden" }))).toEqual(TILE_MATERIAL_STYLES.tile_hidden)
    })

    it("falls back to the texture when no block key is present", () => {
        expect(materialStyleFor(tile({ texture: "tile_hidden", material: undefined }))).toEqual(TILE_MATERIAL_STYLES.tile_hidden)
    })

    it("resolves a named block style directly", () => {
        expect(materialStyleFor(tile({ material: "slate" }))).toEqual(TILE_MATERIAL_STYLES.slate)
        expect(materialStyleFor(tile({ material: "rust" }))).toEqual(TILE_MATERIAL_STYLES.rust)
    })

    it("is deterministic for unknown keys (same key -> same style)", () => {
        const a = materialStyleFor(tile({ material: "some_custom_block" }))
        const b = materialStyleFor(tile({ material: "some_custom_block" }))
        expect(a).toEqual(b)
        // It must be one of the defined styles, never undefined.
        expect(a).toBeDefined()
        expect(typeof a.face).toBe("number")
        expect(typeof a.edge).toBe("number")
    })

    it("hashMaterialKey is stable and non-negative", () => {
        expect(hashMaterialKey("abc")).toBe(hashMaterialKey("abc"))
        expect(hashMaterialKey("abc")).toBeGreaterThanOrEqual(0)
        expect(hashMaterialKey("")).toBeGreaterThanOrEqual(0)
    })
})
