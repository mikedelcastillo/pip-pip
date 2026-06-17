import { generateId } from "../lib/utils"
import { nearestPointFromSegment } from "../math"
import { WallGrid, WALL_GRID_CELL_SIZE } from "./wall-grid"

// WallGrid lives in ./wall-grid; re-exported here so existing importers of
// @pip-pip/core/src/physics keep resolving it from one place.
export { WallGrid, WALL_GRID_CELL_SIZE }

export class Vector2{
    _x = 0
    _y = 0
    _qx = 0
    _qy = 0

    constructor(x?: number, y?: number){
        if(typeof x === "number" && typeof y === "number"){
            this.set(x, y)
        }
    }

    get x(){ return this._x }
    set x(value: number){
        this._x = this._qx = value
    }

    get y(){ return this._y }
    set y(value: number){
        this._y = this._qy = value
    }

    get qx(){ return this._qx }
    set qx(value: number){ this._qx = value }

    get qy(){ return this._qy }
    set qy(value: number){ this._qy = value }

    set(x: number, y: number){
        this.x = x
        this.y = y
    }

    queue(x: number, y: number){
        this.qx = x
        this.qy = y
    }

    flush(){
        this.set(this.qx, this.qy)
    }

    reset(){
        this._x = this._y = 0
    }
}

export type CollisionOptions = {
    enabled: boolean,
    channels: number[],
    includeChannels: number[],
    excludeChannels: number[],
    includeObjects: PointPhysicsObject[],
    excludeObjects: PointPhysicsObject[],
}

export class PointPhysicsRectWall {
    id = generateId()
    center: Vector2 = new Vector2()
    width = 50
    height = 50
    constructor(id?: string){
        if(typeof id === "string"){
            this.id = id
        }
    }
}

export type PointPhysicsSegment = {
    startX: number,
    startY: number,
    endX: number,
    endY: number,
}

export class PointPhysicsSegmentWall{
    id = generateId()
    start: Vector2
    end: Vector2
    radius = 25
    // When true (default) the wall is a full capsule with ROUNDED ENDCAPS: it
    // resists everywhere within `radius` of the spine, including the half-circle
    // beyond each endpoint. This is the original behaviour, so every existing
    // wall (legacy/migrated straight segments, every current map) is unchanged.
    //
    // When false the wall is a FLAT barrier over its SPAN only, with NO endcap:
    // an object beyond the segment's projected span (t < 0 or t > 1) is not
    // pushed, removing the invisible "bump" a diagonal capsule otherwise leaves
    // past its tip where it meets a flat wall or another diagonal. An object
    // alongside the span is still fully blocked. See resolveWallCollisions.
    cappedEnds = true
    constructor(id?: string, startX?: number, startY?: number, endX?: number, endY?: number){
        if(typeof id === "string"){
            this.id = id
        }

        if(typeof startX === "number" && typeof startY === "number"){
            this.start = new Vector2(startX, startY)
            this.end = typeof endX === "number" && typeof endY === "number" ? 
                new Vector2(endX, endY) : 
                new Vector2(startX, startY)
        } else{
            this.start = new Vector2(0, 0)
            this.end = new Vector2(0, 0)
        }
    }
}

export const POINT_PHYSICS_MIN_DIST = 0.0001


// Wall push-out passes per tick. >1 keeps the object stable in tight corners
// where resolving one wall can push it into another.
export const WALL_RESOLVE_ITERATIONS = 2

// Per-tick velocity decay multiplier. Shared by the world step and the
// client-side replay (PipPipGame.stepLocalPlayer) so they cannot drift apart.
export function airResistanceMultiplier(airResistance: number, deltaTime: number){
    return Math.pow(1 - airResistance, deltaTime)
}

// Clamp a velocity vector to a maximum speed, preserving direction. Shared by
// the world step and the client-side replay.
export function limitSpeed(vx: number, vy: number, maxVelocity: number){
    const speed = Math.min(maxVelocity, Math.sqrt(vx * vx + vy * vy))
    const angle = Math.atan2(vy, vx)
    return { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed }
}

// Push an object out along a unit normal by `push` units and remove only the
// velocity component heading into the surface, so it slides along the edge.
function applyWallContact(object: PointPhysicsObject, nx: number, ny: number, push: number){
    object.position.x += nx * push
    object.position.y += ny * push
    const into = object.velocity.x * nx + object.velocity.y * ny
    if(into < 0){
        object.velocity.x -= nx * into
        object.velocity.y -= ny * into
    }
}

export class PointPhysicsObject{
    id = generateId()
    
    position: Vector2 = new Vector2()
    velocity: Vector2 = new Vector2()
    
    collision: CollisionOptions = {
        enabled: true,
        channels: [],
        includeChannels: [],
        excludeChannels: [],
        includeObjects: [],
        excludeObjects: [],
    }

    radius = 25
    mass = 100
    airResistance = 0.1

    world?: PointPhysicsWorld

    dead = false

    constructor(id?: string){
        if(typeof id === "string"){
            this.id = id
        }
    }

    setId(id: string){
        this.id = id
        // Ensure ID change is safe
    }

    setWorld(world: PointPhysicsWorld){
        this.world = world
    }

    destroy(){
        if(this.dead === true) return
        if(typeof this.world === "undefined") return
        this.dead = true
        this.world.removeObject(this)
    }
}

export type PointPhysicsWorldOptions = {
    baseTps: number,
    logFrequency: number,
    maxVelocity: number,
}

export class PointPhysicsWorld{
    options: PointPhysicsWorldOptions

    objects: Record<string, PointPhysicsObject> = {}
    rectWalls: Record<string, PointPhysicsRectWall> = {}
    segWalls: Record<string, PointPhysicsSegmentWall> = {}

    // Spatial-hash broadphase over the static walls so an object/bullet only
    // narrowphases walls in nearby cells instead of every wall every tick. Kept
    // perfectly in sync with the Record maps by add/removeRectWall / addSegWall
    // / removeSegWall. Two separate grids preserve the segs-before-rects split.
    rectWallGrid: WallGrid = new WallGrid()
    segWallGrid: WallGrid = new WallGrid()

    lastLog = Date.now()

    timeScale = 1
    
    lastUpdate = Date.now()

    constructor(options: Partial<PointPhysicsWorldOptions> = {}){
        this.options = {
            baseTps: 20,
            logFrequency: 10000,
            maxVelocity: 500,
            ...options,
        }
    }

    destroy(){
        for(const id in this.objects){
            this.objects[id].destroy()
        }
        for(const id in this.rectWalls){
            delete this.rectWalls[id]
        }
        // Wipe the broadphase so it cannot retain refs to walls of a torn-down
        // world (matches the rectWalls clear above; segWalls keep their existing
        // pre-feature behaviour of not being cleared here).
        this.rectWallGrid.clear()
        this.segWallGrid.clear()
    }

    addObject(object: PointPhysicsObject){
        if(object.id in this.objects){
            const conflict = this.objects[object.id]
            if(object !== conflict){
                conflict.destroy()
            }
        }
        this.objects[object.id] = object
        object.setWorld(this)
    }

    removeObject(object: PointPhysicsObject){
        if(object.id in this.objects){
            delete this.objects[object.id]
            object.destroy()
        }
    }

    addRectWall(rectWall: PointPhysicsRectWall){
        this.rectWalls[rectWall.id] = rectWall
        // Footprint = the box AABB (centre +/- half extents).
        const halfW = rectWall.width / 2
        const halfH = rectWall.height / 2
        this.rectWallGrid.insert(
            rectWall.id,
            rectWall.center.x - halfW, rectWall.center.y - halfH,
            rectWall.center.x + halfW, rectWall.center.y + halfH,
        )
    }

    removeRectWall(rectWall: PointPhysicsRectWall){
        if(rectWall.id in this.rectWalls){
            delete this.rectWalls[rectWall.id]
        }
        this.rectWallGrid.remove(rectWall.id)
    }

    addSegWall(segWall: PointPhysicsSegmentWall){
        this.segWalls[segWall.id] = segWall
        // Footprint = the AABB of [start,end] EXPANDED by the capsule radius, so
        // the whole rounded capsule (not just the spine) is covered by the cells.
        const minX = Math.min(segWall.start.x, segWall.end.x) - segWall.radius
        const minY = Math.min(segWall.start.y, segWall.end.y) - segWall.radius
        const maxX = Math.max(segWall.start.x, segWall.end.x) + segWall.radius
        const maxY = Math.max(segWall.start.y, segWall.end.y) + segWall.radius
        this.segWallGrid.insert(segWall.id, minX, minY, maxX, maxY)
    }

    removeSegWall(segWall: PointPhysicsSegmentWall){
        if(segWall.id in this.segWalls){
            delete this.segWalls[segWall.id]
        }
        this.segWallGrid.remove(segWall.id)
    }

    update(deltaMs: number){
        this.lastUpdate = Date.now()
        
        const baseMs = 1000 / this.options.baseTps
        const deltaTime =  (Math.max(1, deltaMs) / baseMs) * this.timeScale
        const objects = Object.values(this.objects)
        const collidableObjects = objects.filter(object => object.collision.enabled === true)

        // Apply air resistance
        for(const object of objects){
            const airResistance = airResistanceMultiplier(object.airResistance, deltaTime)

            object.velocity.qx *= airResistance
            object.velocity.qy *= airResistance
        }

        for(const a of collidableObjects){
            for(const b of collidableObjects){
                if(a.id === b.id) continue
                if(a.collision.channels.some(channel => b.collision.excludeChannels.includes(channel))) continue
                if(b.collision.channels.some(channel => a.collision.excludeChannels.includes(channel))) continue
                if(a.collision.excludeObjects.includes(b)) continue
                if(b.collision.excludeObjects.includes(a)) continue

                const vdx = ((a.position.x + a.velocity.x) - (b.position.x + b.velocity.x))
                const vdy = ((a.position.y + a.velocity.y) - (b.position.y + b.velocity.y))
                // const vdist = Math.sqrt(vdx * vdx + vdy * vdy)

                const dx = (a.position.x - b.position.x)
                const dy = (a.position.y - b.position.y)
                const dist = Math.max(POINT_PHYSICS_MIN_DIST, Math.sqrt(dx * dx + dy * dy))

                const diff = ((a.radius + b.radius) - dist) / dist
                const s1 = (1 / a.mass) / ((1 / a.mass) + (1 / b.mass))
                const s2 = 1 - s1
                const C = 0.5 * deltaTime
                const P = 0.5 * deltaTime

                if(dist < a.radius + b.radius){
                    a.velocity.qx += vdx * s1 * diff * C
                    a.velocity.qy += vdy * s1 * diff * C

                    a.position.qx += vdx * s1 * diff * P
                    a.position.qy += vdy * s1 * diff * P

                    b.velocity.qx -= vdx * s2 * diff * C
                    b.velocity.qy -= vdy * s2 * diff * C
                    
                    b.position.qx -= vdx * s2 * diff * P
                    b.position.qy -= vdy * s2 * diff * P
                }
            }
        }

        // Walls are resolved after integration (see resolveWallCollisions),
        // as a deterministic position push-out + tangential slide rather than
        // the old frame-rate-dependent velocity nudge.

        // Apply velocity to position
        for(const object of objects){
            // Limit velocity
            const limited = limitSpeed(object.velocity.qx, object.velocity.qy, this.options.maxVelocity)
            object.velocity.qx = limited.x
            object.velocity.qy = limited.y

            // Apply velocity
            object.position.qx += object.velocity.qx * deltaTime
            object.position.qy += object.velocity.qy * deltaTime
        }

        for(const object of objects){
            object.velocity.flush()
            object.position.flush()
        }

        // Resolve walls on the committed (post-integration) positions. A few
        // iterations keep convex/concave corners stable.
        for(let iteration = 0; iteration < WALL_RESOLVE_ITERATIONS; iteration++){
            for(const object of collidableObjects){
                this.resolveWallCollisions(object)
            }
        }

        if(Date.now() - this.lastLog > this.options.logFrequency){
            this.lastLog = Date.now()
            this.log()
        }
    }

    /**
     * Deterministic static-wall resolution for one circular object. Pushes the
     * object out of every overlapping wall by the penetration depth and removes
     * only the velocity component heading into the surface, so it slides cleanly
     * along straight and slanted edges. Pure position/velocity correction — no
     * delta-time or wall-clock terms — so client and server (and the client
     * replay step) produce identical results.
     *
     * A wall is a segment with a radius: radius ≈ 0 gives a flat edge at any
     * angle (straight / slanted); a zero-length segment with radius is a circle;
     * radius > 0 is a rounded/capsule wall.
     */
    // Broadphase candidate segment walls whose cells overlap the AABB, returned
    // in the EXACT order Object.values(this.segWalls) yields. The grid hands
    // back only the NEARBY ids already sorted into that order, so we resolve
    // each id to its wall via an O(1) record lookup. We NEVER iterate the full
    // Object.values(this.segWalls) list, so the cost is O(candidates) (plus the
    // grid's O(k log k) sort), not O(all walls). The order is byte-identical to
    // a brute-force scan, which is what makes the sequential push-out in corners
    // match the reference resolver.
    querySegWalls(minX: number, minY: number, maxX: number, maxY: number): PointPhysicsSegmentWall[]{
        const ids = this.segWallGrid.queryOrdered(minX, minY, maxX, maxY)
        const out: PointPhysicsSegmentWall[] = []
        for(const id of ids){
            const segWall = this.segWalls[id]
            if(typeof segWall !== "undefined") out.push(segWall)
        }
        return out
    }

    // Broadphase candidate rect walls, ordered like Object.values(this.rectWalls)
    // for the same byte-identical-result reason as querySegWalls, and likewise
    // O(candidates) via O(1) record lookups instead of a full list scan.
    queryRectWalls(minX: number, minY: number, maxX: number, maxY: number): PointPhysicsRectWall[]{
        const ids = this.rectWallGrid.queryOrdered(minX, minY, maxX, maxY)
        const out: PointPhysicsRectWall[] = []
        for(const id of ids){
            const rectWall = this.rectWalls[id]
            if(typeof rectWall !== "undefined") out.push(rectWall)
        }
        return out
    }

    resolveWallCollisions(object: PointPhysicsObject){
        if(object.collision.enabled === false) return

        // Broadphase: the object's circle AABB is (position +/- radius). Any wall
        // whose footprint AABB overlaps this query AABB shares a grid cell, so
        // the candidate set is a CONSERVATIVE superset of every wall the old
        // full scan would have narrowphased. (segWall footprints already include
        // their capsule radius; the rectWall footprint is its box AABB; the query
        // adds the object radius. If a circle of radius r_o actually overlaps a
        // wall it must overlap that wall's footprint AABB, hence share a cell.)
        const minX = object.position.x - object.radius
        const minY = object.position.y - object.radius
        const maxX = object.position.x + object.radius
        const maxY = object.position.y + object.radius

        // Segment / capsule / circle walls.
        for(const segWall of this.querySegWalls(minX, minY, maxX, maxY)){
            const minDist = object.radius + segWall.radius

            // Cheap broad-phase reject against the segment's padded bounds.
            if(object.position.x < Math.min(segWall.start.x, segWall.end.x) - minDist) continue
            if(object.position.x > Math.max(segWall.start.x, segWall.end.x) + minDist) continue
            if(object.position.y < Math.min(segWall.start.y, segWall.end.y) - minDist) continue
            if(object.position.y > Math.max(segWall.start.y, segWall.end.y) + minDist) continue

            // Uncapped (cappedEnds === false) walls resist ONLY along their span:
            // project the object onto the segment line and, if it lands beyond an
            // endpoint (t < 0 or t > 1), it sits in the old rounded-endcap region,
            // so skip it (no push). Alongside the span the push below is unchanged,
            // so the object still cannot pass through the wall face. A degenerate
            // zero-length segment falls back to the capped path (no projection, no
            // divide-by-zero), preserving the original capsule/circle behaviour.
            if(segWall.cappedEnds === false){
                const sx = segWall.end.x - segWall.start.x
                const sy = segWall.end.y - segWall.start.y
                const segLenSq = sx * sx + sy * sy
                if(segLenSq > POINT_PHYSICS_MIN_DIST){
                    const t = ((object.position.x - segWall.start.x) * sx +
                        (object.position.y - segWall.start.y) * sy) / segLenSq
                    if(t < 0 || t > 1) continue
                }
            }

            const near = nearestPointFromSegment(
                segWall.start.x, segWall.start.y,
                segWall.end.x, segWall.end.y,
                object.position.x, object.position.y,
            )
            let nx = object.position.x - near.x
            let ny = object.position.y - near.y
            let dist = Math.sqrt(nx * nx + ny * ny)
            if(dist >= minDist) continue

            if(dist < POINT_PHYSICS_MIN_DIST){
                // Object centre sits on the wall: push out along the segment's
                // perpendicular so the normal is well defined.
                const sx = segWall.end.x - segWall.start.x
                const sy = segWall.end.y - segWall.start.y
                const slen = Math.max(POINT_PHYSICS_MIN_DIST, Math.sqrt(sx * sx + sy * sy))
                nx = -sy / slen
                ny = sx / slen
                dist = POINT_PHYSICS_MIN_DIST
            } else{
                nx /= dist
                ny /= dist
            }

            applyWallContact(object, nx, ny, minDist - dist)
        }

        // Axis-aligned box walls. Same conservative query AABB as the segments.
        for(const rectWall of this.queryRectWalls(minX, minY, maxX, maxY)){
            const halfW = rectWall.width / 2
            const halfH = rectWall.height / 2
            const dxC = object.position.x - rectWall.center.x
            const dyC = object.position.y - rectWall.center.y

            if(Math.abs(dxC) > halfW + object.radius) continue
            if(Math.abs(dyC) > halfH + object.radius) continue

            if(Math.abs(dxC) < halfW && Math.abs(dyC) < halfH){
                // Centre inside the box: eject along the nearest face.
                const penX = halfW - Math.abs(dxC)
                const penY = halfH - Math.abs(dyC)
                let nx = 0
                let ny = 0
                let pen = 0
                if(penX < penY){ nx = dxC >= 0 ? 1 : -1; pen = penX } else{ ny = dyC >= 0 ? 1 : -1; pen = penY }
                applyWallContact(object, nx, ny, pen + object.radius)
                continue
            }

            const nearestX = rectWall.center.x + Math.max(-halfW, Math.min(halfW, dxC))
            const nearestY = rectWall.center.y + Math.max(-halfH, Math.min(halfH, dyC))
            let nx = object.position.x - nearestX
            let ny = object.position.y - nearestY
            const dist = Math.sqrt(nx * nx + ny * ny)
            if(dist >= object.radius || dist < POINT_PHYSICS_MIN_DIST) continue
            nx /= dist
            ny /= dist
            applyWallContact(object, nx, ny, object.radius - dist)
        }
    }

    log(){
        //
    }
}