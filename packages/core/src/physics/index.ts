import { generateId } from "../lib/utils"
import { forgivingEqual, nearestPointFromSegment } from "../math"

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
    }

    removeRectWall(rectWall: PointPhysicsRectWall){
        if(rectWall.id in this.rectWalls){
            delete this.rectWalls[rectWall.id]
        }
    }

    addSegWall(segWall: PointPhysicsSegmentWall){
        this.segWalls[segWall.id] = segWall
    }

    removeSegWall(segWall: PointPhysicsSegmentWall){
        if(segWall.id in this.segWalls){
            delete this.segWalls[segWall.id]
        }
    }

    update(deltaMs: number){
        this.lastUpdate = Date.now()
        
        const baseMs = 1000 / this.options.baseTps
        const deltaTime =  (Math.max(1, deltaMs) / baseMs) * this.timeScale
        const objects = Object.values(this.objects)
        const collidableObjects = objects.filter(object => object.collision.enabled === true)

        // Apply air resistance
        for(const object of objects){
            const airResistance = Math.pow(1 - object.airResistance, deltaTime)

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

                const vdx = (a.position.x + a.velocity.x - b.position.x + b.velocity.x)
                const vdy = (a.position.y + a.velocity.y - b.position.y + b.velocity.y)
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

        // Collide with walls
        const collidableRectWalls = Object.values(this.rectWalls)
        for(const object of collidableObjects){
            for(const rectWall of collidableRectWalls){
                const dx = object.position.x - rectWall.center.x
                const dy = object.position.y - rectWall.center.y

                const outerCollidingX = Math.abs(dx) < object.radius + rectWall.width / 2
                const outerCollidingY = Math.abs(dy) < object.radius + rectWall.height / 2
                const outerColliding = outerCollidingX && outerCollidingY

                const innerCollidingX = Math.abs(dx) < object.radius
                const innerCollidingY = Math.abs(dy) < object.radius

                const objectInsideRect = 
                    object.position.x > rectWall.center.x - rectWall.width / 2 &&
                    object.position.x < rectWall.center.x + rectWall.width / 2 &&
                    object.position.y > rectWall.center.y - rectWall.height / 2 &&
                    object.position.y < rectWall.center.y + rectWall.height / 2

                let referencePointX = rectWall.center.x
                let referencePointY = rectWall.center.y
                let referencePointRadius = Math.sqrt(rectWall.width * rectWall.width + rectWall.height * rectWall.height) / 2

                if(outerColliding && !objectInsideRect){
                    referencePointRadius = 0
                    referencePointX = Math.max(rectWall.center.x - rectWall.width / 2, Math.min(rectWall.center.x + rectWall.width / 2, object.position.x))
                    referencePointY = Math.max(rectWall.center.y - rectWall.height / 2, Math.min(rectWall.center.y + rectWall.height / 2, object.position.y))
                }

                if(outerColliding){
                    const rdx = referencePointX - object.position.x
                    const rdy = referencePointY - object.position.y
                    const dist = Math.max(POINT_PHYSICS_MIN_DIST, Math.sqrt(rdx * rdx + rdy * rdy))
                    const diff = ((object.radius + referencePointRadius) - dist) / dist
                    const vx = rdx * diff * -1
                    const vy = rdy * diff * -1

                    if(!objectInsideRect){
                        const px = rectWall.center.x + Math.sign(dx) * (rectWall.width / 2 + object.radius)
                        const py = rectWall.center.y + Math.sign(dy) * (rectWall.height / 2 + object.radius)
                        if(innerCollidingX){
                            object.position.qy = py
                        } else if (innerCollidingY){
                            object.position.qx = px
                        } else if(dist < object.radius){
                            // Colliding with corner
                            const angle = Math.atan2(rdy, rdx) + Math.PI
                            object.position.qx = referencePointX + Math.cos(angle) * object.radius
                            object.position.qy = referencePointY + Math.sin(angle) * object.radius
                        } else{
                            object.position.qx = px
                            object.position.qy = py
                        }
                    }

                    object.velocity.qx += vx
                    object.velocity.qy += vy
                }
            }
        }

        // Collide with segment walls
        const collidableSegWalls = Object.values(this.segWalls)
        for(const object of collidableObjects){
            const points: number[][] = []
            for(const segWall of collidableSegWalls){
                let pointX = segWall.start.x
                let pointY = segWall.start.y
                const singlePoint = segWall.start.x === segWall.end.x && segWall.start.y === segWall.end.y
                if(!singlePoint){
                    const { x, y } = nearestPointFromSegment(
                        segWall.start.x, segWall.start.y,
                        segWall.end.x, segWall.end.y,
                        object.position.x, object.position.y,
                    )
                    pointX = x
                    pointY = y
                }

                const dx = (pointX - object.position.x)
                const dy = (pointY - object.position.y)
                const dist = Math.max(POINT_PHYSICS_MIN_DIST, Math.sqrt(dx * dx + dy * dy))

                const diff = ((segWall.radius + object.radius) - dist) / dist
                
                if(dist < segWall.radius + object.radius){
                    const tolerance = segWall.radius / 2
                    const match = points.find(([x, y]) => forgivingEqual(x, pointX, tolerance) && forgivingEqual(y, pointY, tolerance))
                    if(typeof match === "undefined"){
                        points.push([pointX, pointY, dx * diff, dy * diff])
                    }
                }
            }
            const C = -0.5 * deltaTime
            const P = -1 * deltaTime
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for(const [_x, _y, vx, vy] of points){
                object.velocity.qx += vx * C
                object.velocity.qy += vy * C

                object.position.qx += vx * P
                object.position.qy += vy * P
            }
        }

        // Apply velocity to position
        for(const object of objects){
            // Limit velocity
            const vel = Math.min(this.options.maxVelocity, Math.sqrt(object.velocity.qx * object.velocity.qx + object.velocity.qy * object.velocity.qy))
            const angle = Math.atan2(object.velocity.qy, object.velocity.qx)
            object.velocity.qx = Math.cos(angle) * vel
            object.velocity.qy = Math.sin(angle) * vel

            // Apply velocity
            object.position.qx += object.velocity.qx * deltaTime
            object.position.qy += object.velocity.qy * deltaTime
        }

        for(const object of objects){
            object.velocity.flush()
            object.position.flush()
        }

        if(Date.now() - this.lastLog > this.options.logFrequency){
            this.lastLog = Date.now()
            this.log()
        }
    }

    log(){
        //
    }
}