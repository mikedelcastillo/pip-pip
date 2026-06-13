export function degreeToRadians(degree: number){
    return degree / 180 * Math.PI
}

export function radiansToDegree(radians: number){
    return radians * 180 / Math.PI
}

export function radianDifference(radianA: number, radianB: number){
    const diff = (radianB - radianA + Math.PI) % (Math.PI * 2) - Math.PI
    return diff < -Math.PI ? diff + Math.PI * 2 : diff
}

export function degreeDifference(degreeA: number, degreeB: number){
    const diff = (degreeB - degreeA + 180) % 360 - 180
    return diff < -180 ? diff + 360 : diff
}

export function forgivingEqual(a: number, b: number, amount = 5){
    return Math.abs(b - a) < amount 
}

export function normalizeToPositiveRadians(radians: number){
    return radians % (Math.PI * 2) + Math.PI * 2
}

export function nearestPointFromSegment(
    lineStartX: number, lineStartY: number, 
    lineEndX: number, lineEndY: number, 
    pointX: number, pointY: number){

    const dx = lineEndX - lineStartX
    const dy = lineEndY - lineStartY
    const m = dy/dx
  
    if(dy == 0){
        if(lineStartX > lineEndX){
            const tx = lineStartX
            lineStartX = lineEndX
            lineEndX = tx
            const ty = lineStartY
            lineStartY = lineEndY
            lineEndY = ty
        }
        if(lineStartX < pointX && pointX < lineEndX){
            return {x: pointX, y: lineStartY}
        } else{
            if(pointX <= lineStartX) return {x: lineStartX, y: lineStartY}
            else return {x: lineEndX, y: lineEndY}
        }
    } else if(dx == 0){
        if(lineStartY > lineEndY){
            const tx = lineStartX
            lineStartX = lineEndX
            lineEndX = tx
            const ty = lineStartY
            lineStartY = lineEndY
            lineEndY = ty
        }
        if(lineStartY < pointY && pointY < lineEndY){
            return {x: lineStartX, y: pointY}
        } else{
            if(pointY <= lineStartY) return {x: lineStartX, y: lineStartY}
            else return {x: lineEndX, y: lineEndY}
        }
    } else{
        if(lineStartX > lineEndX){
            const tx = lineStartX
            lineStartX = lineEndX
            lineEndX = tx
            const ty = lineStartY
            lineStartY = lineEndY
            lineEndY = ty
        }
        const cx = (m * lineStartX - (-1/m) * pointX + pointY - lineStartY)/(m + 1/m)
        const cy = m * (cx - lineStartX) + lineStartY
  
        if(lineStartX < cx && cx < lineEndX){
            return {x: cx, y: cy}
        } else{
            if(cx <= lineStartX) return {x: lineStartX, y: lineStartY}
            else return {x: lineEndX, y: lineEndY}
        }
    }
}

export function distancePointToSegment(
    pointX: number, pointY: number,
    segStartX: number, segStartY: number,
    segEndX: number, segEndY: number){
    const { x, y } = nearestPointFromSegment(segStartX, segStartY, segEndX, segEndY, pointX, pointY)
    const dx = pointX - x
    const dy = pointY - y
    return Math.sqrt(dx * dx + dy * dy)
}

function segmentOrientation(ax: number, ay: number, bx: number, by: number, cx: number, cy: number){
    return Math.sign((by - ay) * (cx - bx) - (bx - ax) * (cy - by))
}

export function segmentsIntersect(
    a1x: number, a1y: number, a2x: number, a2y: number,
    b1x: number, b1y: number, b2x: number, b2y: number){
    const o1 = segmentOrientation(a1x, a1y, a2x, a2y, b1x, b1y)
    const o2 = segmentOrientation(a1x, a1y, a2x, a2y, b2x, b2y)
    const o3 = segmentOrientation(b1x, b1y, b2x, b2y, a1x, a1y)
    const o4 = segmentOrientation(b1x, b1y, b2x, b2y, a2x, a2y)
    return o1 !== o2 && o3 !== o4
}

/**
 * Minimum distance between two line segments. Returns 0 if they cross.
 * Used to test a swept (moving) circle against a wall segment by comparing
 * the result against the sum of the two radii.
 */
export function distanceBetweenSegments(
    a1x: number, a1y: number, a2x: number, a2y: number,
    b1x: number, b1y: number, b2x: number, b2y: number){
    if(segmentsIntersect(a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y)) return 0
    return Math.min(
        distancePointToSegment(a1x, a1y, b1x, b1y, b2x, b2y),
        distancePointToSegment(a2x, a2y, b1x, b1y, b2x, b2y),
        distancePointToSegment(b1x, b1y, a1x, a1y, a2x, a2y),
        distancePointToSegment(b2x, b2y, a1x, a1y, a2x, a2y),
    )
}

export function intersectionOfTwoLines(
    L1x1: number, L1y1: number, 
    L1x2: number, L1y2: number, 
    L2x1: number, L2y1: number, 
    L2x2: number, L2y2: number,
){
    const A1 = L1y2 - L1y1
    const B1 = L1x1 - L1x2
    const C1 = A1 * L1x1 + B1 * L1y1

    const A2 = L2y2 - L2y1
    const B2 = L2x1 - L2x2
    const C2 = A2 * L2x1 + B2 * L2y1

    const det = A1 * B2 - A2 * B1
    
    if ( det === 0) return null

    const x = (B2 * C1 - B1 * C2) / det
    const y = (A1 * C2 - A2 * C1) / det
    return { x, y }
}
  