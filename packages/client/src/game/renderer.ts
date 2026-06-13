import { radianDifference } from "@pip-pip/core/src/math"
import { PipPipGame } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import * as PIXI from "pixi.js"
import { GameContext } from "."
import { assetLoader } from "./assets"

import { CRTFilter, GlitchFilter, PixelateFilter, BulgePinchFilter } from "pixi-filters"
import { DisplacementFilter } from "@pixi/filter-displacement"
import { Point } from "pixi.js"
import { SHIP_DAIMETER, TILE_SIZE } from "@pip-pip/game/src/logic/constants"
import { PipGameTile } from "@pip-pip/game/src/logic/map"
import { COLORS, DIMS } from "./styles"
import { Bullet } from "@pip-pip/game/src/logic/bullet"
import { tickDown } from "@pip-pip/game/src/logic/utils"
import { Vector2 } from "@pip-pip/core/src/physics"
import { EventCallback, EventMapOf } from "@pip-pip/core/src/common/events"
import {
    ParticleSystem,
    emitExplosion,
    emitSparks,
    emitThruster,
    emitMuzzleFlash,
    computeShake,
    triggerShake,
    mergeShake,
    ShakeState,
    Particle,
    WallSegment,
} from "./particles"

const SMOOTHING = {
    CAMERA_MOVEMENT: 5,
    CLIENT_PLAYER_MOVEMENT: 1,
    PLAYER_MOVEMENT: 2,
    PLAYER_ROTATION: 1,
    MAX_PLAYER_DISTANCE: 250,
    BULLET_POSITION: 0.5,
}

export const STAR_BG = {
    COUNT: 200,
    MIN_Z: 5,
    MAX_Z: 10,
    MAX_SCALE: 1,
    MIN_SCALE: 0.25,
    EFFECT: 1,
}

export class StarGraphic {
    sprite: PIXI.Sprite
    z = 0

    constructor(sprite: PIXI.Sprite){
        this.sprite = sprite
        sprite.anchor.set(0.5)
        this.setRandomZ()
    }

    setRandomZ(){
        const z = STAR_BG.MIN_Z + Math.random() * (STAR_BG.MAX_Z - STAR_BG.MIN_Z)
        this.setZ(z)
    }

    get zRatio(){
        return (this.z - STAR_BG.MIN_Z) / (STAR_BG.MAX_Z - STAR_BG.MIN_Z)
    }

    setZ(n: number){
        this.z = n
        const scale = STAR_BG.MIN_SCALE + (1 - this.zRatio) * (STAR_BG.MAX_SCALE - STAR_BG.MIN_SCALE)
        this.sprite.scale.set(scale)
        this.sprite.rotation = Math.random() * Math.PI
    }
}

export class GraphicPool<T extends PoolableGraphic>{
    stage: PIXI.Container
    graphics: T[] = []
    Graphic: new () => T

    constructor(stage: PIXI.Container, Graphic: new () => T){
        this.stage = stage
        this.Graphic = Graphic
    }

    use(setup?: (graphic: T) => void){
        let graphic = this.graphics.find(graphic => graphic.active === false)
        if(typeof graphic === "undefined"){
            graphic = new this.Graphic()
            this.graphics.push(graphic)
        }
        graphic.active = true
        if(typeof setup !== "undefined") setup(graphic)
        this.stage.addChild(graphic.container)
        return graphic
    }

    get active(){
        return this.graphics.filter(graphic => graphic.active === true)
    }

    free(graphic: T){
        if(!(this.graphics.includes(graphic))) return
        this.stage.removeChild(graphic.container)
        graphic.active = false
        graphic?.cleanUp()
    }

    destroy(){
        for(const graphic of this.graphics){
            this.free(graphic)
        }
        this.graphics = []
    }
}

export interface PoolableGraphic{
    cleanUp(): void,
}

export class PoolableGraphic{
    active = false
    container = new PIXI.Container()
}

export type BulletGraphicPosition = {
    x: number, y: number,
    dx: number, dy: number,
    age: number,
}

export class BulletGraphic extends PoolableGraphic{
    static MAX_POSITION_AGE = 500
    static DOZE = 10
    bullet?: Bullet
    graphic = new PIXI.Graphics()
    positions: BulletGraphicPosition[] = []
    positionX = 0
    positionY = 0

    setup(bullet: Bullet){
        this.bullet = bullet
        this.container.addChild(this.graphic)
        this.setPosition(bullet.physics.position.x, bullet.physics.position.y)
    }

    setPosition(x: number, y: number){
        this.positionX = x
        this.positionY = y

        const angle = Math.random() * Math.PI * 2
        const pos = {
            x: this.positionX, y: this.positionY,
            dx: Math.cos(angle) * BulletGraphic.DOZE,
            dy: Math.sin(angle) * BulletGraphic.DOZE,
            age: Date.now(),
        }

        this.positions.push(pos)
    }

    cleanUp(){
        this.bullet = undefined
        this.container.removeChild(this.graphic)
        this.graphic.clear()
    }
}

export class DamageGraphic extends PoolableGraphic {
    static LIFESPAN = 500
    lifespan = 0
    positionX = 0
    positionY = 0
    id?: string
    count = 0
    text: PIXI.Text

    constructor(){
        super()
        this.text = new PIXI.Text("DAMAGE HERE", {
            fontFamily: "VT323",
            fontSize: 28,
            fill: 0xE6AE10,
            align: "center",
        })
        this.text.anchor.set(0.5)
        this.container.addChild(this.text)
    }

    setup(player: PipPlayer){
        this.id = player.id
    }

    add(player:PipPlayer, count: number){
        this.lifespan = DamageGraphic.LIFESPAN // ms
        this.count += count
        this.text.text = this.count.toString()

        this.positionX = player.ship.physics.position.x
        this.positionY = player.ship.physics.position.y - player.ship.physics.radius * 1.75

        this.container.position.x = this.positionX
        this.container.position.y = this.positionY
    }

    cleanUp() {
        this.lifespan = 0
        this.positionX = 0
        this.positionY = 0
        this.count = 0
        this.id = undefined
    }
}

export class ParticleGraphic extends PoolableGraphic {
    graphic = new PIXI.Graphics()

    constructor(){
        super()
        this.container.addChild(this.graphic)
    }

    draw(p: Particle){
        const lifeRatio = p.age / p.lifespan
        const alpha = Math.max(0, 1 - lifeRatio)
        const drawSize = Math.max(0.5, p.size * (1 - lifeRatio))

        const s = Math.max(1, Math.round(drawSize))

        this.graphic.clear()
        this.graphic.beginFill(p.color, alpha)
        this.graphic.drawRect(-s / 2, -s / 2, s, s)
        this.graphic.endFill()

        this.container.position.x = p.x
        this.container.position.y = p.y
    }

    cleanUp(){
        this.graphic.clear()
    }
}

export class MapTileGraphic {
    id: string
    sprite: PIXI.Sprite

    constructor(tile: PipGameTile){
        this.id = ""

        const spriteTexture = assetLoader.get(tile.texture)
        this.sprite = new PIXI.Sprite(spriteTexture)
        this.sprite.anchor.set(0.5)
        this.sprite.width = TILE_SIZE
        this.sprite.height = TILE_SIZE
        this.sprite.position.x = tile.x
        this.sprite.position.y = tile.y
    }
}

export class PlayerGraphic {
    id: string
    player: PipPlayer

    container: PIXI.Container = new PIXI.Container()
    
    overlayGraphic: PIXI.Graphics = new PIXI.Graphics()
    shipContainer: PIXI.Container = new PIXI.Container()
    shipSprite?: PIXI.Sprite

    constructor(player: PipPlayer){
        this.id = player.id
        this.player = player

        this.container.addChild(this.shipContainer)
        this.container.addChild(this.overlayGraphic)
    }

    updateShipSprite(){
        if(typeof this.shipSprite !== "undefined"){
            this.shipContainer.removeChild(this.shipSprite)
        }
        const texture = assetLoader.get(this.player.shipType.texture)
        this.shipSprite = new PIXI.Sprite(texture)
        this.shipSprite.anchor.set(0.5)
        this.shipSprite.position.set(0)
        this.shipSprite.rotation = Math.PI / 2
        this.shipSprite.width = SHIP_DAIMETER
        this.shipSprite.height = SHIP_DAIMETER
        this.shipContainer.addChild(this.shipSprite)
    }
}

export class PipPipRenderer{
    app: PIXI.Application
    game: PipPipGame

    stars: StarGraphic[] = []
    starsContainer = new PIXI.Container()

    viewportContainer = new PIXI.Container()
    playersContainer = new PIXI.Container()
    bulletsContainer = new PIXI.Container()
    damagesContainer = new PIXI.Container()
    particlesContainer = new PIXI.Container()

    mapBackgroundContainer = new PIXI.Container()
    mapForegroundContainer = new PIXI.Container()

    damages: GraphicPool<DamageGraphic>
    bullets: GraphicPool<BulletGraphic>
    particles: GraphicPool<ParticleGraphic>
    players: Record<string, PlayerGraphic> = {}
    mapTiles: MapTileGraphic[] = []

    particleSystem = new ParticleSystem()
    shake: ShakeState = triggerShake(0, 1)

    container?: HTMLDivElement

    crtFilter = new CRTFilter()
    glitchFilter = new GlitchFilter()
    pixelateFilter = new PixelateFilter()
    buldgePinchFilter = new BulgePinchFilter()
    
    displacementSprite: PIXI.Sprite
    displacementFilter: DisplacementFilter

    // Game-event subscriptions registered in the constructor, remembered so
    // destroy() can detach the exact same references via game.events.off() —
    // without this every remount would leak another set of subscriptions
    // (and the closures keep this renderer, and its WebGL context, alive).
    private gameEventSubscriptions: Array<() => void> = []
    private destroyed = false

    camera = {
        position: {
            x: 0, y: 0,
        },
        target: {
            x: 0, y: 0,
        },
        scale: 1,
    }

    constructor(game: PipPipGame){
        this.app = new PIXI.Application({ resizeTo: window, backgroundColor: 0x150E12 })
        this.app.ticker.stop()

        this.app.stage.addChild(this.viewportContainer)
        
        this.viewportContainer.addChild(this.starsContainer)
        this.viewportContainer.addChild(this.bulletsContainer)
        this.viewportContainer.addChild(this.mapBackgroundContainer)
        this.viewportContainer.addChild(this.playersContainer)
        this.viewportContainer.addChild(this.mapForegroundContainer)
        this.viewportContainer.addChild(this.particlesContainer)
        this.viewportContainer.addChild(this.damagesContainer)

        this.bullets = new GraphicPool(this.bulletsContainer, BulletGraphic)
        this.damages = new GraphicPool(this.damagesContainer, DamageGraphic)
        this.particles = new GraphicPool(this.particlesContainer, ParticleGraphic)

        this.crtFilter.enabled = true
        this.crtFilter.curvature = 100
        this.glitchFilter.enabled = true
        this.glitchFilter.resolution = 5
        this.glitchFilter.offset = 25
        this.glitchFilter.slices = 10
        this.glitchFilter.red = new Point(5, 5)
        this.glitchFilter.blue = new Point(2, 1)
        this.glitchFilter.green = new Point(-1, -4)
        this.pixelateFilter.enabled = true
        this.buldgePinchFilter.enabled = true
        this.buldgePinchFilter.strength = 0.05
        this.buldgePinchFilter.center = new Point(
            0.5, 
            0.5,
        )

        const displacementTexture = assetLoader.get("displacement_map")
        this.displacementSprite = new PIXI.Sprite(displacementTexture)
        this.displacementSprite.anchor.set(0.5)
        this.displacementFilter = new DisplacementFilter(this.displacementSprite)
        this.displacementFilter.enabled = true
        this.app.stage.addChild(this.displacementSprite)

        this.app.stage.filters = [
            // this.crtFilter,
            // this.glitchFilter,
            // this.pixelateFilter,
            this.buldgePinchFilter,
            // this.displacementFilter,
        ]

        // initialize stars
        for(let i = 0; i < STAR_BG.COUNT; i++){
            const starTexture = assetLoader.get("star_1")
            if(typeof starTexture === "undefined") continue
            const star = new PIXI.Sprite(starTexture)
            const graphic = new StarGraphic(star)

            const angle = Math.random() * Math.PI * 2
            const mag = Math.random() * this.getViewportRadius()
            star.position.x = Math.cos(angle) * mag
            star.position.y = Math.sin(angle) * mag

            this.starsContainer.addChild(star)
            this.stars.push(graphic)
        }

        this.game = game

        this.onGameEvent("addPlayer", ({ player }) => {
            const graphic = new PlayerGraphic(player)
            this.players[player.id] = graphic
            this.playersContainer.addChild(graphic.container)
        })

        this.onGameEvent("playerSetShip", ({ player }) => {
            this.players[player.id]?.updateShipSprite()
        })

        this.onGameEvent("removePlayer", ({ player }) => {
            if(player.id in this.players){
                const graphic = this.players[player.id]
                delete this.players[player.id]
                this.playersContainer.removeChild(graphic.container)
            }
        })

        this.updateMapGraphics()
        this.onGameEvent("setMap", () => {
            this.updateMapGraphics()
        })

        this.onGameEvent("addBullet", ({ bullet }) => {
            this.bullets.use(graphic => graphic.setup(bullet))

            // Muzzle flash fires along the bullet's heading. Guard a zero-velocity
            // bullet so atan2(0,0) doesn't produce a meaningless direction.
            const vx = bullet.physics.velocity.x
            const vy = bullet.physics.velocity.y
            if(vx !== 0 || vy !== 0){
                emitMuzzleFlash(
                    this.particleSystem,
                    bullet.physics.position.x,
                    bullet.physics.position.y,
                    Math.atan2(vy, vx),
                )
            }
        })

        this.onGameEvent("removeBullet", ({ bullet }) => {
            const graphic = this.bullets.graphics.find(graphic => graphic.bullet === bullet)
            if(typeof graphic !== "undefined"){
                graphic.bullet = undefined
            }

            // A grenade detonates with a far bigger burst than a normal bullet's
            // little puff; scale the explosion with its blast radius so the
            // visual reads as the AoE that the server just resolved.
            const isGrenade = bullet.type === "grenade"
            const explosionSize = isGrenade
                ? Math.max(16, bullet.explosionRadius / 4)
                : 8

            emitExplosion(
                this.particleSystem,
                bullet.physics.position.x,
                bullet.physics.position.y,
                explosionSize,
            )
        })

        this.onGameEvent("dealDamage", ({ target, damage }) => {
            let graphic = this.damages.active.find(g => g.id === target.id)
            if(typeof graphic === "undefined"){
                graphic = this.damages.use(g => g.setup(target))
            }
            graphic.add(target, damage)

            emitSparks(
                this.particleSystem,
                target.ship.physics.position.x,
                target.ship.physics.position.y,
            )
            // Sparks fire for everyone, but only shake the screen when the
            // local player is the one taking the hit.
            if(target.id === this.game.clientPlayerId){
                this.shake = mergeShake(this.shake, triggerShake(5, 150))
            }
        })

        this.onGameEvent("playerKill", ({ killed }) => {
            emitExplosion(
                this.particleSystem,
                killed.ship.physics.position.x,
                killed.ship.physics.position.y,
                14,
            )
            // Explosion shows for every kill, but only shake when you died.
            if(killed.id === this.game.clientPlayerId){
                this.shake = mergeShake(this.shake, triggerShake(10, 350))
            }
        })
    }

    // Subscribe to a game event and remember how to detach it, so destroy()
    // can remove the exact same handler reference.
    private onGameEvent<K extends keyof EventMapOf<PipPipGame["events"]>>(
        eventName: K,
        handler: EventCallback<EventMapOf<PipPipGame["events"]>[K]>,
    ){
        this.game.events.on(eventName, handler)
        this.gameEventSubscriptions.push(() => this.game.events.off(eventName, handler))
    }

    updateMapGraphics(){
        for(const graphic of this.mapTiles){
            this.mapBackgroundContainer.removeChild(graphic.sprite)
        }

        this.mapTiles = []

        for(const tile of this.game.map.tiles){
            const graphic = new MapTileGraphic(tile)
            this.mapBackgroundContainer.addChild(graphic.sprite)

            this.mapTiles.push(graphic)
        }

        // const graphic = new PIXI.Graphics()
        // graphic.lineStyle({
        //     width: 10,
        //     color: 0xff0000,
        // })
        // this.mapForegroundContainer.addChild(graphic)
        // for(const segWall of this.game.map.segWalls){
        //     if(segWall.start.x === segWall.end.x && segWall.start.y === segWall.end.y){
        //         const offset = TILE_SIZE / 4
        //         graphic.moveTo(segWall.start.x - offset, segWall.start.y - offset)
        //         graphic.lineTo(segWall.end.x + offset, segWall.end.y + offset)
        //         graphic.moveTo(segWall.start.x + offset, segWall.start.y - offset)
        //         graphic.lineTo(segWall.end.x - offset, segWall.end.y + offset)
        //     } else{
        //         graphic.moveTo(segWall.start.x, segWall.start.y)
        //         graphic.lineTo(segWall.end.x, segWall.end.y)
        //     }
        // }
    }

    getViewportRadius(){
        return Math.sqrt(this.app.view.width * this.app.view.width + this.app.view.height * this.app.view.height) / 2
    }

    mount(container: HTMLDivElement){
        this.container = container
        this.container.appendChild(this.app.view)
    }

    render(gameContext: GameContext, deltaMs: number){
        const deltaTime = deltaMs / this.game.deltaMs
        const timeDiff = Date.now() - this.game.lastTick
        const lerp = timeDiff / this.game.deltaMs

        // bullets
        const bulletSmoothing = deltaTime / SMOOTHING.BULLET_POSITION

        // camera
        const cameraSmoothing = deltaTime / SMOOTHING.CAMERA_MOVEMENT

        // update players
        const players = Object.values(this.players)
        const playerRotationSmoothing = deltaTime / SMOOTHING.PLAYER_ROTATION
        const playerMovementSmoothing = deltaTime / SMOOTHING.PLAYER_MOVEMENT
        const clientPlayerMovementSmoothing = deltaTime / SMOOTHING.CLIENT_PLAYER_MOVEMENT
        for(const graphic of players){
            const isClient = graphic.player === gameContext.getClientPlayer()
            const movementSmoothing = isClient ? clientPlayerMovementSmoothing : playerMovementSmoothing

            const tx = graphic.player.ship.physics.position.x + graphic.player.ship.physics.velocity.x * lerp
            const ty = graphic.player.ship.physics.position.y + graphic.player.ship.physics.velocity.y * lerp
            
            const dx = tx - graphic.container.position.x
            const dy = ty - graphic.container.position.y

            if(dx * dx + dy + dy > SMOOTHING.MAX_PLAYER_DISTANCE * SMOOTHING.MAX_PLAYER_DISTANCE){
                graphic.container.position.x = tx
                graphic.container.position.y = ty
            } else{
                graphic.container.position.x += dx * movementSmoothing
                graphic.container.position.y += dy * movementSmoothing
            }

            graphic.shipContainer.rotation += radianDifference(graphic.shipContainer.rotation, graphic.player.ship.rotation) * playerRotationSmoothing

            graphic.container.visible = graphic.player.spawned

            graphic.overlayGraphic.clear()
            graphic.overlayGraphic.lineStyle({
                width: DIMS.HEALTH_BAR_HEIGHT + DIMS.HEALTH_BAR_BORDER * 2,
                color: COLORS.DARK_1,
            })
            graphic.overlayGraphic.moveTo(-(DIMS.HEALTH_BAR_WIDTH / 2 + DIMS.HEALTH_BAR_BORDER), DIMS.HEALTH_BAR_OFFSET)
            graphic.overlayGraphic.lineTo(DIMS.HEALTH_BAR_WIDTH / 2 + DIMS.HEALTH_BAR_BORDER, DIMS.HEALTH_BAR_OFFSET)

            graphic.overlayGraphic.lineStyle({
                width: DIMS.HEALTH_BAR_HEIGHT,
                color: isClient ? COLORS.GOOD : COLORS.BAD,
            })
            graphic.overlayGraphic.moveTo(-(DIMS.HEALTH_BAR_WIDTH / 2), DIMS.HEALTH_BAR_OFFSET)
            const h = graphic.player.ship.capacities.health / graphic.player.ship.maxHealth
            graphic.overlayGraphic.lineTo(DIMS.HEALTH_BAR_WIDTH * h - (DIMS.HEALTH_BAR_WIDTH / 2), DIMS.HEALTH_BAR_OFFSET)

            if(isClient && typeof graphic.player.spectating === "undefined"){
                if(graphic.player.spawned){
                    this.camera.target.x = tx
                    this.camera.target.y = ty
                } else{
                    this.camera.target.x = 0
                    this.camera.target.y = 0
                }
            }
        }

        // update bullets
        for(const graphic of this.bullets.active){
            graphic.positions = graphic.positions.filter(pos => {
                const dif = Date.now() - pos.age
                return dif < BulletGraphic.MAX_POSITION_AGE
            })
            if(typeof graphic.bullet !== "undefined"){
                const tx = graphic.bullet.physics.position.x + graphic.bullet.physics.velocity.x * lerp
                const ty = graphic.bullet.physics.position.y + graphic.bullet.physics.velocity.y * lerp

                graphic.setPosition(
                    graphic.positionX + (tx - graphic.positionX) * bulletSmoothing,
                    graphic.positionY + (ty - graphic.positionY) * bulletSmoothing,
                )                
            } else {
                graphic.positions.shift()
            }
            graphic.graphic.clear()

            // Distinct trail per weapon: grenades draw a fat green round, the
            // tactical cannon a thicker amber streak, and primary fire stays the
            // thin white streak.
            const bulletType = graphic.bullet?.type
            const isGrenade = bulletType === "grenade"
            const isTactical = bulletType === "tactical"
            const trailWidth = isGrenade ? 14 : isTactical ? 11 : 5
            const trailColor = isGrenade ? 0x33DD55 : isTactical ? 0xFFAA33 : 0xFFFFFF

            for(let i = 1; i < graphic.positions.length; i++){
                const prev = graphic.positions[i - 1]
                const cur = graphic.positions[i]

                const CT = Math.pow(i / graphic.positions.length, 2)
                const PT = Math.pow((i - 1) / graphic.positions.length, 2)

                graphic.graphic.lineStyle({
                    width: CT * trailWidth,
                    color: trailColor,
                    alpha: Math.max(0.1, CT),
                })
                graphic.graphic.moveTo(
                    prev.x + prev.dx * (1 - PT), 
                    prev.y + prev.dy * (1 - PT),
                )
                graphic.graphic.lineTo(
                    cur.x + cur.dx * (1 - CT) ,
                    cur.y + cur.dy * (1 - CT),
                )
            }

            // graphic.graphic.beginFill(0xFFFFFF)
            // graphic.graphic.moveTo(graphic.positionX, graphic.positionY)
            // graphic.graphic.arc(graphic.positionX, graphic.positionY, 3, 0, Math.PI * 2)
            // graphic.graphic.endFill()

            if(graphic.positions.length === 0){
                this.bullets.free(graphic)
            }
        }

        // update damage graphics
        for(const graphic of this.damages.active){
            graphic.lifespan -= deltaMs
            graphic.lifespan = Math.max(0, graphic.lifespan)
            const life = graphic.lifespan / DamageGraphic.LIFESPAN

            graphic.container.position.x = graphic.positionX
            graphic.container.position.y = graphic.positionY + 10 * life
            graphic.container.scale.set(1 + 0.5 * life)
            graphic.container.alpha = Math.min(1, life * 5)

            if(graphic.lifespan <= 0){
                this.damages.free(graphic)
            }
        }

        // update particles: step the pure simulation (with wall bounces),
        // recycle every graphic from the previous frame, then redraw one graphic
        // per live particle.
        const walls: WallSegment[] = Object.values(this.game.physics.segWalls).map(w => ({
            x1: w.start.x,
            y1: w.start.y,
            x2: w.end.x,
            y2: w.end.y,
            radius: w.radius,
        }))
        this.particleSystem.update(deltaMs, walls)
        for(const g of this.particles.active){
            this.particles.free(g)
        }
        this.particleSystem.forEach(p => this.particles.use(g => g.draw(p)))

        // emit thruster trails behind every spawned, moving ship
        for(const graphic of players){
            if(!graphic.player.spawned) continue
            const vx = graphic.player.ship.physics.velocity.x
            const vy = graphic.player.ship.physics.velocity.y
            const speed = Math.hypot(vx, vy)
            if(speed < 1) continue
            emitThruster(
                this.particleSystem,
                graphic.container.position.x,
                graphic.container.position.y,
                Math.atan2(vy, vx),
                speed,
            )
        }

        // Compute camera
        const cameraDeltaX = (this.camera.target.x - this.camera.position.x) * cameraSmoothing
        const cameraDeltaY = (this.camera.target.y - this.camera.position.y) * cameraSmoothing
        this.camera.position.x += cameraDeltaX
        this.camera.position.y += cameraDeltaY
        
        // Compute the filters
        this.buldgePinchFilter.radius = this.getViewportRadius()
        this.displacementSprite.position.x = this.app.view.width / 2
        this.displacementSprite.position.y = this.app.view.height / 2
        // set displacement scale

        // Center viewport (with screen shake offset applied)
        const shakeOffset = computeShake(this.shake, deltaMs)
        this.viewportContainer.position.x = this.app.view.width / 2 - this.camera.position.x + shakeOffset.dx
        this.viewportContainer.position.y = this.app.view.height / 2 - this.camera.position.y + shakeOffset.dy

        // Compute stars
        const starMaxDist = this.getViewportRadius()
        for(const star of this.stars){
            star.sprite.position.x += cameraDeltaX * star.zRatio * star.zRatio * STAR_BG.EFFECT
            star.sprite.position.y += cameraDeltaY * star.zRatio * star.zRatio * STAR_BG.EFFECT

            const dx = this.camera.position.x - star.sprite.position.x
            const dy = this.camera.position.y - star.sprite.position.y
            const dist2 = dx * dx + dy * dy
            if(dist2 > starMaxDist * starMaxDist){
                const angle = Math.random() * Math.PI * 2
                star.sprite.position.x = this.camera.position.x + Math.cos(angle) * starMaxDist
                star.sprite.position.y = this.camera.position.y + Math.sin(angle) * starMaxDist
                star.setRandomZ()
            }
        }

        this.app.render()
    }

    // Tear everything down so a remount doesn't leak a WebGL context, the Pixi
    // ticker/loader, or the game-event subscriptions. Safe to call more than
    // once. Shared loaded textures/baseTextures are intentionally NOT destroyed
    // here (assetLoader caches them across mounts) — only this app's own
    // display objects are released.
    destroy(){
        if(this.destroyed) return
        this.destroyed = true

        // Detach every game-event subscription this renderer added.
        for(const off of this.gameEventSubscriptions){
            off()
        }
        this.gameEventSubscriptions = []

        // Release pooled graphics (each pool removes its children + destroys).
        this.bullets.destroy()
        this.damages.destroy()
        this.particles.destroy()

        // Remove the canvas from the DOM before destroying the app.
        if(typeof this.container !== "undefined"){
            if(this.app.view.parentNode === this.container){
                this.container.removeChild(this.app.view)
            }
            this.container = undefined
        }

        // Destroy the Pixi application and its WebGL context. children:true so
        // every stage display object is freed; texture/baseTexture:false so the
        // shared assetLoader textures survive for the next mount.
        this.app.destroy(true, { children: true, texture: false, baseTexture: false })
    }
}