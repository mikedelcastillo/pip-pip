import { describe, expect, it } from "vitest"
import {
    degreeDifference,
    degreeToRadians,
    distanceBetweenSegments,
    distancePointToSegment,
    distanceSegmentToRect,
    forgivingEqual,
    intersectionOfTwoLines,
    normalizeToPositiveRadians,
    pointInRect,
    radianDifference,
    radiansToDegree,
    segmentsIntersect,
} from "@pip-pip/core/src/math"

describe("angle conversions", () => {
    it("converts degrees to radians and back", () => {
        expect(degreeToRadians(180)).toBeCloseTo(Math.PI, 10)
        expect(degreeToRadians(90)).toBeCloseTo(Math.PI / 2, 10)
        expect(radiansToDegree(Math.PI)).toBeCloseTo(180, 10)
        expect(radiansToDegree(Math.PI / 2)).toBeCloseTo(90, 10)
    })
})

describe("radianDifference", () => {
    it("returns the signed shortest angular distance", () => {
        expect(radianDifference(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 10)
        expect(radianDifference(0, -Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 10)
    })

    it("takes the short way around the circle", () => {
        // From 0 to 270deg the short path is -90deg, not +270deg.
        expect(radianDifference(0, (3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 10)
        // The reverse must apply the negative-wrap correction branch.
        expect(radianDifference((3 * Math.PI) / 2, 0)).toBeCloseTo(Math.PI / 2, 10)
    })
})

describe("degreeDifference", () => {
    it("returns the signed shortest distance in degrees", () => {
        expect(degreeDifference(0, 270)).toBeCloseTo(-90, 10)
        expect(degreeDifference(350, 10)).toBeCloseTo(20, 10)
        expect(degreeDifference(10, 350)).toBeCloseTo(-20, 10)
    })
})

describe("normalizeToPositiveRadians", () => {
    const TAU = Math.PI * 2
    const samples = [0, 1, 3, 5, Math.PI, TAU, TAU + 0.5, 100, -0.0001, -1, -TAU, -TAU - 0.5, -100]

    it("maps any angle into the canonical [0, 2π)", () => {
        for(const x of samples){
            const r = normalizeToPositiveRadians(x)
            expect(r).toBeGreaterThanOrEqual(0)
            expect(r).toBeLessThan(TAU)
        }
    })

    it("preserves the angle modulo 2π", () => {
        for(const x of samples){
            const r = normalizeToPositiveRadians(x)
            // r and x must differ by a whole number of turns.
            const turns = (x - r) / TAU
            expect(turns).toBeCloseTo(Math.round(turns), 9)
        }
    })

    it("returns 0 for 0 (regression: the old code returned 2π)", () => {
        expect(normalizeToPositiveRadians(0)).toBe(0)
    })
})

describe("forgivingEqual", () => {
    it("is true within the tolerance and false outside it", () => {
        expect(forgivingEqual(100, 103)).toBe(true)
        expect(forgivingEqual(100, 110)).toBe(false)
        expect(forgivingEqual(100, 100.5, 1)).toBe(true)
    })
})

describe("distancePointToSegment", () => {
    it("measures perpendicular distance to a segment span", () => {
        // Point above the middle of a horizontal segment.
        expect(distancePointToSegment(0, 5, -10, 0, 10, 0)).toBeCloseTo(5, 10)
    })

    it("clamps to the nearest endpoint when past the segment", () => {
        // Point well past the right end clamps to (10, 0).
        expect(distancePointToSegment(20, 0, -10, 0, 10, 0)).toBeCloseTo(10, 10)
    })
})

describe("segmentsIntersect / distanceBetweenSegments", () => {
    it("detects a crossing", () => {
        expect(segmentsIntersect(-1, 0, 1, 0, 0, -1, 0, 1)).toBe(true)
        expect(distanceBetweenSegments(-1, 0, 1, 0, 0, -1, 0, 1)).toBe(0)
    })

    it("returns false for parallel, non-touching segments", () => {
        expect(segmentsIntersect(0, 0, 1, 0, 0, 1, 1, 1)).toBe(false)
        expect(distanceBetweenSegments(0, 0, 1, 0, 0, 1, 1, 1)).toBeCloseTo(1, 10)
    })
})

describe("intersectionOfTwoLines", () => {
    it("finds the crossing point of two lines", () => {
        const point = intersectionOfTwoLines(0, 0, 1, 1, 0, 1, 1, 0)
        expect(point).not.toBeNull()
        expect(point?.x).toBeCloseTo(0.5, 10)
        expect(point?.y).toBeCloseTo(0.5, 10)
    })

    it("returns null for parallel lines", () => {
        expect(intersectionOfTwoLines(0, 0, 1, 0, 0, 1, 1, 1)).toBeNull()
    })
})

describe("pointInRect", () => {
    it("is true inside and on the edge, false outside", () => {
        // Box centred at (0,0), 100x100 -> spans [-50, 50] on both axes.
        expect(pointInRect(0, 0, 0, 0, 100, 100)).toBe(true)
        expect(pointInRect(50, 50, 0, 0, 100, 100)).toBe(true)
        expect(pointInRect(-50, 10, 0, 0, 100, 100)).toBe(true)
        expect(pointInRect(51, 0, 0, 0, 100, 100)).toBe(false)
        expect(pointInRect(0, -60, 0, 0, 100, 100)).toBe(false)
    })
})

describe("distanceSegmentToRect", () => {
    it("returns 0 when a segment endpoint is inside the box", () => {
        // End at the box centre.
        expect(distanceSegmentToRect(-200, 0, 0, 0, 0, 0, 100, 100)).toBe(0)
    })

    it("returns 0 when a segment tunnels clean through the box (no endpoint inside)", () => {
        // A thin 8-wide box centred at x=0; a horizontal segment from x=-200 to
        // x=200 passes straight through it. Neither endpoint is inside, but the
        // segment crosses the box, so the distance is 0.
        expect(distanceSegmentToRect(-200, 0, 200, 0, 0, 0, 8, 600)).toBe(0)
    })

    it("returns the perpendicular gap when the segment misses the box", () => {
        // Box [-50,50]^2; horizontal segment 30 above the top edge.
        expect(distanceSegmentToRect(-200, 80, 200, 80, 0, 0, 100, 100)).toBeCloseTo(30, 10)
    })

    it("measures distance to the nearest corner past the box", () => {
        // Segment well to the upper-right of the box clamps to the (50, 50)
        // corner: distance from (90, 90) is sqrt(40^2 + 40^2).
        const d = distanceSegmentToRect(90, 90, 200, 200, 0, 0, 100, 100)
        expect(d).toBeCloseTo(Math.hypot(40, 40), 10)
    })
})
