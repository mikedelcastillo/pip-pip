import { describe, expect, it } from "vitest"
import {
    degreeDifference,
    degreeToRadians,
    distanceBetweenSegments,
    distancePointToSegment,
    forgivingEqual,
    intersectionOfTwoLines,
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
