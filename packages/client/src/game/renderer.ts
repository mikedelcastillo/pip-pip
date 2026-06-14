import { radianDifference } from "@pip-pip/core/src/math"
import { PipPipGame } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import * as PIXI from "pixi.js"
import { GameContext } from "."
import { assetLoader } from "./assets"

import { CRTFilter, GlitchFilter, PixelateFilter, BulgePinchFilter } from "pixi-filters"
import { DisplacementFilter } from "@pixi/filter-displacement"
import { Point } from "pixi.js"
import { SHIP_DAIMETER } from "@pip-pip/game/src/logic/constants"
import { PipGameTile } from "@pip-pip/game/src/logic/map"
import { blockStyleFor, tilePolygon, polygonToFlat } from "./mapGraphics"
import { COLORS, DIMS } from "./styles"
import { Bullet } from "@pip-pip/game/src/logic/bullet"
import { Powerup, POWERUP_RADIUS } from "@pip-pip/game/src/logic/powerup"
import { tickDown } from "@pip-pip/game/src/logic/utils"
import { exceedsSnapDistance } from "./interpolation"
import { Vector2 } from "@pip-pip/core/src/physics"
import { EventCallback, EventMapOf } from "@pip-pip/core/src/common/events"
import { healthBarColor, isTeamMode } from "./teams"
import { useGameStore } from "./store"
import { findPath, getNavGrid } from "@pip-pip/game/src/logic/pathfinding"
import { findNearestEnemy } from "@pip-pip/game/src/logic/ai"
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

// The complete set of inputs that decide what the STATIC part of a player's
// overlay (the health bar) looks like. The bar geometry is fixed except for its
// fill length, which is health/maxHealth, and its color, which comes from
// healthBarColor(localTeam, playerTeam, isClient, teamMode). Caching these per
// PlayerGraphic lets render() skip the clear()+redraw when none of them changed
// since the last draw, which is the common case at 60fps (health changes are
// rare). Anything the bar's pixels depend on MUST live here or the bar can go
// stale; the animated buff rings are NOT here because they live on their own
// per-frame graphic (see PlayerGraphic.buffGraphic).
export type HealthOverlayState = {
    health: number
    maxHealth: number
    color: number
}

// True when the health bar must be redrawn: either it has never been drawn
// (prev undefined) or any cached input changed. Pure and side-effect free so it
// can be unit-tested. Keeping this exact means a damage tick, a respawn/health
// restore, a maxHealth change, or a team / self-vs-other color change (a TDM team
// switch) all redraw the SAME frame they happen, exactly like the old
// unconditional redraw.
export function healthOverlayChanged(prev: HealthOverlayState | undefined, next: HealthOverlayState): boolean{
    if(typeof prev === "undefined") return true
    return prev.health !== next.health
        || prev.maxHealth !== next.maxHealth
        || prev.color !== next.color
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

// On-brand procedural powerup pickup: a small glowing diamond (rotated square)
// with a soft outer halo, colour per type (green = health, amber = ammo, cyan =
// haste, purple = shield, pale ghost-white = invis cloak, pink = ricochet). No
// art assets - drawn with Pixi Graphics and pulsed/spun in render().
export class PowerupGraphic extends PoolableGraphic {
    static COLORS: Record<string, number> = {
        health: 0x33DD55,
        ammo: 0xFFAA33,
        haste: 0x33CCFF,
        shield: 0xAA66FF,
        invis: 0xCCE6FF,
        ricochet: 0xFF66AA,
    }

    powerup?: Powerup
    graphic = new PIXI.Graphics()
    spin = 0

    constructor(){
        super()
        this.container.addChild(this.graphic)
    }

    setup(powerup: Powerup){
        this.powerup = powerup
        this.container.position.x = powerup.position.x
        this.container.position.y = powerup.position.y
        this.spin = 0
    }

    draw(pulse: number){
        const type = this.powerup?.type ?? "health"
        const color = PowerupGraphic.COLORS[type] ?? 0xFFFFFF
        const r = POWERUP_RADIUS * (0.85 + 0.15 * pulse)

        this.graphic.clear()
        // Soft outer halo.
        this.graphic.beginFill(color, 0.18)
        this.graphic.drawRect(-r, -r, r * 2, r * 2)
        this.graphic.endFill()
        // Solid inner diamond.
        const inner = r * 0.6
        this.graphic.beginFill(color, 0.95)
        this.graphic.moveTo(0, -inner)
        this.graphic.lineTo(inner, 0)
        this.graphic.lineTo(0, inner)
        this.graphic.lineTo(-inner, 0)
        this.graphic.closePath()
        this.graphic.endFill()
    }

    cleanUp(){
        this.powerup = undefined
        this.graphic.clear()
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

// The static map drawn as a SINGLE vector layer instead of one sprite per tile.
// Every tile becomes a filled polygon (square for full/deco, triangle for a
// diagonal slope matching its 45-degree segWall) painted into one PIXI.Graphics
// in one pass. A diagonal tile also gets a thin darker edge along its hypotenuse
// so the slope reads with a touch of depth, keeping the dark blocky aesthetic.
//
// PERFORMANCE: the map only changes on setMap, so this layer is rebuilt there
// and never per frame. Collapsing N tiles into one display object already kills
// the per-tile object overhead; on top of that we cacheAsBitmap the container so
// the GPU does a single blit per frame regardless of tile count. For very large
// maps whose pixel bounds would blow past the GPU's max texture size, caching is
// skipped and the vector layer is drawn directly (still one batched Graphics),
// so big maps stay correct and cheap either way.
export class MapLayerGraphic {
    // Above this many world pixels on either axis the cached bitmap would risk
    // exceeding the GPU max texture size, so we leave the layer as live vector
    // graphics (one batched draw) instead of caching it.
    static MAX_CACHE_EXTENT = 4096

    container = new PIXI.Container()
    graphic = new PIXI.Graphics()

    constructor(){
        this.container.addChild(this.graphic)
    }

    // Redraw every tile into the single Graphics. Pure-ish: reads only the tile
    // list. Called on init and every setMap; nothing here runs per frame.
    rebuild(tiles: PipGameTile[]){
        const g = this.graphic
        g.clear()

        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity

        for(const tile of tiles){
            const style = blockStyleFor(tile)
            const points = tilePolygon(tile)
            const flat = polygonToFlat(points)

            // Solid face fill for the tile body.
            g.beginFill(style.face, 1)
            g.drawPolygon(flat)
            g.endFill()

            // A thin bevel edge for a touch of depth. For a diagonal we stroke
            // ONLY the hypotenuse (the slope edge a ship glides along) so it reads
            // as a clean slope; the hypotenuse is the longest of the right
            // triangle's three edges. For a square a faint full outline gives the
            // blocky grid its seams.
            const isDiagonal = points.length === 3
            g.lineStyle({ width: 2, color: style.edge, alpha: 0.9 })
            if(isDiagonal){
                const hyp = longestEdge(points)
                g.moveTo(hyp.a.x, hyp.a.y)
                g.lineTo(hyp.b.x, hyp.b.y)
            } else{
                g.drawPolygon(flat)
            }
            g.lineStyle(0)

            for(const p of points){
                if(p.x < minX) minX = p.x
                if(p.x > maxX) maxX = p.x
                if(p.y < minY) minY = p.y
                if(p.y > maxY) maxY = p.y
            }
        }

        // Cache the whole static layer to a bitmap so the per-frame cost is a
        // single blit, UNLESS the map is so large the bitmap would risk the GPU
        // max texture size, in which case keep it as live (still single-draw)
        // vector graphics. cacheAsBitmap must be reset to false before redrawing
        // (handled by the false-set below running first on a rebuild).
        this.container.cacheAsBitmap = false
        const spanX = maxX - minX
        const spanY = maxY - minY
        const cacheable = Number.isFinite(spanX) && Number.isFinite(spanY) &&
            spanX <= MapLayerGraphic.MAX_CACHE_EXTENT &&
            spanY <= MapLayerGraphic.MAX_CACHE_EXTENT &&
            tiles.length > 0
        this.container.cacheAsBitmap = cacheable
    }

    destroy(){
        this.container.cacheAsBitmap = false
        this.graphic.clear()
        this.container.removeChild(this.graphic)
        this.graphic.destroy()
        this.container.destroy({ children: true })
    }
}

// The longest of a triangle's three edges - its hypotenuse for the right
// triangles tilePolygon produces. Pure helper used only when stroking a slope.
function longestEdge(points: { x: number, y: number }[]){
    let best = { a: points[0], b: points[1], len: -1 }
    for(let i = 0; i < points.length; i++){
        const a = points[i]
        const b = points[(i + 1) % points.length]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const len = dx * dx + dy * dy
        if(len > best.len) best = { a, b, len }
    }
    return best
}

export class PlayerGraphic {
    id: string
    player: PipPlayer

    container: PIXI.Container = new PIXI.Container()

    overlayGraphic: PIXI.Graphics = new PIXI.Graphics()

    // The animated buff rings (shield / haste / cloak). Split off the static
    // health-bar overlayGraphic onto their own Graphics because they pulse via
    // buffPulse every frame and so genuinely need a per-frame geometry rebuild
    // while a buff is active, whereas the health bar does NOT. Keeping them apart
    // lets the health bar be cache-gated (skipped when unchanged) without ever
    // freezing the pulse. Drawn after overlayGraphic so it sits on top, matching
    // the old single-graphic draw order.
    buffGraphic: PIXI.Graphics = new PIXI.Graphics()

    // Cache of the inputs that drove the LAST health-bar draw. Undefined until
    // the first draw. render() compares the current inputs against this via
    // healthOverlayChanged and only clears+redraws overlayGraphic when they
    // differ. See HealthOverlayState.
    lastHealthOverlay?: HealthOverlayState

    // Tracks whether buffGraphic currently holds geometry, so a frame with no
    // active buff only clears it ONCE (on the transition to "no buffs") instead
    // of calling clear() every idle frame.
    buffGraphicDrawn = false

    shipContainer: PIXI.Container = new PIXI.Container()
    shipSprite?: PIXI.Sprite

    // The player's name, shown just above the health bar. Lives on `container`
    // (not shipContainer) so it never spins with the ship and stays upright.
    nameText: PIXI.Text = new PIXI.Text("", {
        fontFamily: "VT323",
        fontSize: 16,
        fill: 0xFFFFFF,
        stroke: COLORS.DARK_1,
        strokeThickness: 4,
        align: "center",
    })

    constructor(player: PipPlayer){
        this.id = player.id
        this.player = player

        // Bottom-centre anchored and parked just above the health bar (which sits
        // at the negative HEALTH_BAR_OFFSET, i.e. above the ship).
        this.nameText.anchor.set(0.5, 1)
        this.nameText.position.set(0, DIMS.HEALTH_BAR_OFFSET - (DIMS.HEALTH_BAR_HEIGHT / 2 + DIMS.HEALTH_BAR_BORDER) - 2)

        this.container.addChild(this.shipContainer)
        this.container.addChild(this.overlayGraphic)
        this.container.addChild(this.buffGraphic)
        this.container.addChild(this.nameText)
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
    powerupsContainer = new PIXI.Container()
    damagesContainer = new PIXI.Container()
    particlesContainer = new PIXI.Container()

    // In-world debug overlay (bot paths + targets), drawn only while the debug
    // panel is open. Its own single PIXI.Graphics so a frame either fills it
    // (debug on) or clears it (debug off) without touching any other layer.
    debugContainer = new PIXI.Container()
    botPathsGraphic = new PIXI.Graphics()

    mapBackgroundContainer = new PIXI.Container()
    mapForegroundContainer = new PIXI.Container()

    damages: GraphicPool<DamageGraphic>
    bullets: GraphicPool<BulletGraphic>
    powerups: GraphicPool<PowerupGraphic>
    particles: GraphicPool<ParticleGraphic>
    players: Record<string, PlayerGraphic> = {}

    // The whole static map as one cached vector layer (see MapLayerGraphic).
    // Rebuilt only on setMap; never touched per frame.
    mapLayer = new MapLayerGraphic()

    // Particle wall-bounce segments, derived from game.physics.segWalls. Walls
    // only change on setMap, so this is cached here and rebuilt in
    // updateMapGraphics rather than re-mapped every render frame. Empty until
    // the first map loads (particles just won't bounce until then).
    wallSegments: WallSegment[] = []

    particleSystem = new ParticleSystem()
    shake: ShakeState = triggerShake(0, 1)

    container?: HTMLDivElement

    crtFilter = new CRTFilter()
    glitchFilter = new GlitchFilter()
    pixelateFilter = new PixelateFilter()
    buldgePinchFilter = new BulgePinchFilter()

    // Opt-in retro CRT post-processing, toggled from Settings and persisted via
    // the ui store (OFF by default). Membership in app.stage.filters is the
    // on/off switch — when off the CRT pass is simply not in the array, so it
    // costs nothing. See setCrtEnabled / rebuildStageFilters below.
    crtEnabled = false
    
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
        this.viewportContainer.addChild(this.debugContainer)
        this.viewportContainer.addChild(this.powerupsContainer)
        this.viewportContainer.addChild(this.playersContainer)
        this.viewportContainer.addChild(this.mapForegroundContainer)
        this.viewportContainer.addChild(this.particlesContainer)
        this.viewportContainer.addChild(this.damagesContainer)

        // The static map layer lives in the background container (under ships /
        // bullets), as a single cached vector layer instead of one sprite per
        // tile. updateMapGraphics rebuilds it on init and every setMap.
        this.mapBackgroundContainer.addChild(this.mapLayer.container)

        // The bot-path debug layer lives just above the map floor so routes read
        // over the tiles but never occlude ships / bullets.
        this.debugContainer.addChild(this.botPathsGraphic)

        this.bullets = new GraphicPool(this.bulletsContainer, BulletGraphic)
        this.powerups = new GraphicPool(this.powerupsContainer, PowerupGraphic)
        this.damages = new GraphicPool(this.damagesContainer, DamageGraphic)
        this.particles = new GraphicPool(this.particlesContainer, ParticleGraphic)

        // CRT post-processing tuned to a tasteful retro look (the toggle adds it
        // on top of the always-on bulge). Curvature/vignette stay gentle so the
        // HUD corners remain legible; scanlines animate via crtFilter.time in
        // the render loop.
        this.crtFilter.enabled = true
        this.crtFilter.curvature = 2
        this.crtFilter.lineWidth = 1
        this.crtFilter.lineContrast = 0.2
        this.crtFilter.vignetting = 0.3
        this.crtFilter.vignettingAlpha = 0.7
        this.crtFilter.noise = 0.08
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

        this.rebuildStageFilters()

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

        this.onGameEvent("powerupSpawn", ({ powerup }) => {
            this.powerups.use(graphic => graphic.setup(powerup))
        })

        // A powerup despawning is (in practice) a pickup, so fire a small
        // celebratory burst at its position, reusing the shared particle system.
        this.onGameEvent("powerupDespawn", ({ powerup }) => {
            const graphic = this.powerups.active.find(g => g.powerup === powerup)
            if(typeof graphic !== "undefined") this.powerups.free(graphic)
            emitExplosion(
                this.particleSystem,
                powerup.position.x,
                powerup.position.y,
                10,
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
        // Tint the canvas to the current map's background colour so each map has
        // a distinct mood (falls back to the original dark plum).
        if(typeof this.game.mapType !== "undefined"){
            this.app.renderer.backgroundColor = this.game.mapType.background ?? 0x150E12
        }

        // Rebuild the single cached map layer from the current map's tiles. This
        // replaces the old one-sprite-per-tile loop: every tile (square or slope)
        // is drawn into one Graphics and the whole layer is cached, so a large
        // map costs a single blit per frame instead of N sprites.
        this.mapLayer.rebuild(this.game.map.tiles)

        // Walls only change with the map, so rebuild the particle wall-bounce
        // list here (init + every setMap) instead of allocating it per frame.
        this.wallSegments = Object.values(this.game.physics.segWalls).map(w => ({
            x1: w.start.x,
            y1: w.start.y,
            x2: w.end.x,
            y2: w.end.y,
            radius: w.radius,
        }))

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

    // DEBUG: visualise bot pathfinding in-world. Only runs while the debug panel
    // is open (otherwise the layer is cleared and we bail). The client never
    // receives the server's bot.path, so for each bot we recompute a DISPLAY path
    // here, client-side, with the SAME pathfinding the server uses: route from the
    // bot to its nearest enemy over the map's cached nav grid. We draw the
    // waypoints as small dots joined by lines, plus a ring on the bot's current
    // target. Cheap: only the (few) bots, only while debug is on.
    private drawBotPaths(graphics: PlayerGraphic[]){
        const g = this.botPathsGraphic
        g.clear()

        if(useGameStore.getState().debug === false) return
        if(typeof this.game.map === "undefined") return

        const allPlayers = Object.values(this.game.players)
        const grid = getNavGrid(this.game.map)
        const rectWalls = this.game.map.rectWalls
        const segWalls = this.game.map.segWalls

        for(const graphic of graphics){
            const bot = graphic.player
            if(bot.isBot !== true) continue
            if(bot.spawned !== true) continue

            const found = findNearestEnemy(bot, allPlayers)
            if(typeof found === "undefined") continue

            const fromX = bot.ship.physics.position.x
            const fromY = bot.ship.physics.position.y
            const toX = found.target.ship.physics.position.x
            const toY = found.target.ship.physics.position.y

            // The routed waypoints (start -> ... -> goal). An empty result means no
            // route was found; still mark the target so the intent reads.
            const path = findPath(grid, fromX, fromY, toX, toY, rectWalls, segWalls)
            const waypoints = path.length > 0
                ? path
                : [{ x: fromX, y: fromY }, { x: toX, y: toY }]

            // Connecting lines along the path.
            g.lineStyle({ width: 2, color: COLORS.ACCENT, alpha: 0.7 })
            g.moveTo(waypoints[0].x, waypoints[0].y)
            for(let i = 1; i < waypoints.length; i++){
                g.lineTo(waypoints[i].x, waypoints[i].y)
            }

            // A small dot on each waypoint.
            g.lineStyle(0)
            g.beginFill(COLORS.ACCENT, 0.9)
            for(const wp of waypoints){
                g.drawCircle(wp.x, wp.y, 4)
            }
            g.endFill()

            // A ring marker on the bot's CURRENT target.
            g.lineStyle({ width: 2, color: COLORS.MAIN, alpha: 0.9 })
            g.drawCircle(toX, toY, SHIP_DAIMETER * 0.75)
        }
    }

    render(gameContext: GameContext, deltaMs: number){
        const deltaTime = deltaMs / this.game.deltaMs
        const timeDiff = Date.now() - this.game.lastTick
        const lerp = timeDiff / this.game.deltaMs

        // bullets
        const bulletSmoothing = deltaTime / SMOOTHING.BULLET_POSITION

        // camera
        const cameraSmoothing = deltaTime / SMOOTHING.CAMERA_MOVEMENT

        // Resolve the camera follow target up front. Normally the local player
        // follows their own ship; a spectator (no ship of their own) follows a
        // chosen spawned player instead. Cycling + free-roam panning are driven by
        // processInputs each update tick (see ui.ts), so the renderer only reads
        // the resulting state here.
        const clientPlayer = gameContext.getClientPlayer()
        const isSpectating = typeof clientPlayer !== "undefined" && clientPlayer.spectator === true

        // A spectator who has freed the camera (WASD) follows nobody: the camera
        // target is the free-roam position, panned by processInputs. Otherwise a
        // spectator follows the chosen target, and a live player follows their own
        // ship. Free-roam target is applied here so the smoothing below still eases
        // the camera toward it rather than snapping.
        const freeRoaming = isSpectating && gameContext.spectateFreeRoam === true
        if(freeRoaming){
            this.camera.target.x = gameContext.spectateCamera.x
            this.camera.target.y = gameContext.spectateCamera.y
        }

        // The player whose interpolated position the camera tracks this frame. In
        // free-roam there is no followed player (the target above already drives
        // the camera), so it stays undefined.
        const followPlayer = freeRoaming
            ? undefined
            : isSpectating ? gameContext.getSpectateTarget() : clientPlayer

        // update players
        const players = Object.values(this.players)
        const playerRotationSmoothing = deltaTime / SMOOTHING.PLAYER_ROTATION
        const playerMovementSmoothing = deltaTime / SMOOTHING.PLAYER_MOVEMENT
        const clientPlayerMovementSmoothing = deltaTime / SMOOTHING.CLIENT_PLAYER_MOVEMENT

        // Team context for health-bar coloring, resolved once per frame. In
        // TEAM_DEATHMATCH the bar is colored by TEAM relative to the local player
        // (teammate green, enemy red); outside TDM the original self/other rule
        // holds. localTeam is -1 when there is no local player (e.g. spectating
        // before a target resolves), which healthBarColor falls back from.
        const teamMode = isTeamMode(useGameStore.getState().mode)
        const localTeam = typeof clientPlayer !== "undefined" ? clientPlayer.team : -1

        // The buff rings pulse off a single wall-clock sine wave. Compute it ONCE
        // per frame and reuse it for every player, instead of calling Date.now()
        // and Math.sin once per player inside the loop below.
        const buffPulse = (Math.sin(Date.now() / 150) + 1) / 2

        for(const graphic of players){
            const isClient = graphic.player === gameContext.getClientPlayer()
            const movementSmoothing = isClient ? clientPlayerMovementSmoothing : playerMovementSmoothing

            const tx = graphic.player.ship.physics.position.x + graphic.player.ship.physics.velocity.x * lerp
            const ty = graphic.player.ship.physics.position.y + graphic.player.ship.physics.velocity.y * lerp
            
            const dx = tx - graphic.container.position.x
            const dy = ty - graphic.container.position.y

            if(exceedsSnapDistance(dx, dy, SMOOTHING.MAX_PLAYER_DISTANCE)){
                graphic.container.position.x = tx
                graphic.container.position.y = ty
            } else{
                graphic.container.position.x += dx * movementSmoothing
                graphic.container.position.y += dy * movementSmoothing
            }

            graphic.shipContainer.rotation += radianDifference(graphic.shipContainer.rotation, graphic.player.ship.rotation) * playerRotationSmoothing

            graphic.container.visible = graphic.player.spawned

            // CLOAK: a ship with the "invis" buff fades out. From the viewer's
            // seat an ENEMY (any remote ship) drops to near-zero alpha so it is
            // effectively invisible; the LOCAL player keeps a faint outline so
            // they can still see where they are while cloaked. Alpha rides on the
            // ship sprite only (shipContainer) — the health bar / buff overlays
            // stay fully readable. Full alpha is restored the instant the timer
            // ends.
            graphic.shipContainer.alpha = graphic.player.ship.isInvisible
                ? (isClient ? 0.35 : 0.05)
                : 1

            // Health bar (static): its geometry only changes when the health
            // ratio or the bar color changes, both rare at 60fps. Cache those
            // inputs and only clear()+redraw when they differ from the last draw,
            // so an unchanged bar keeps its existing geometry instead of being
            // rebuilt every frame. healthOverlayChanged returns true on the first
            // draw (lastHealthOverlay undefined), on damage / heal / respawn
            // (health or maxHealth change), and on a color change (team switch in
            // TDM, or self-vs-other), so the bar is never stale.
            const healthOverlay: HealthOverlayState = {
                health: graphic.player.ship.capacities.health,
                maxHealth: graphic.player.ship.maxHealth,
                color: healthBarColor(localTeam, graphic.player.team, isClient, teamMode),
            }
            if(healthOverlayChanged(graphic.lastHealthOverlay, healthOverlay)){
                graphic.overlayGraphic.clear()
                graphic.overlayGraphic.lineStyle({
                    width: DIMS.HEALTH_BAR_HEIGHT + DIMS.HEALTH_BAR_BORDER * 2,
                    color: COLORS.DARK_1,
                })
                graphic.overlayGraphic.moveTo(-(DIMS.HEALTH_BAR_WIDTH / 2 + DIMS.HEALTH_BAR_BORDER), DIMS.HEALTH_BAR_OFFSET)
                graphic.overlayGraphic.lineTo(DIMS.HEALTH_BAR_WIDTH / 2 + DIMS.HEALTH_BAR_BORDER, DIMS.HEALTH_BAR_OFFSET)

                graphic.overlayGraphic.lineStyle({
                    width: DIMS.HEALTH_BAR_HEIGHT,
                    color: healthOverlay.color,
                })
                graphic.overlayGraphic.moveTo(-(DIMS.HEALTH_BAR_WIDTH / 2), DIMS.HEALTH_BAR_OFFSET)
                const h = healthOverlay.health / healthOverlay.maxHealth
                graphic.overlayGraphic.lineTo(DIMS.HEALTH_BAR_WIDTH * h - (DIMS.HEALTH_BAR_WIDTH / 2), DIMS.HEALTH_BAR_OFFSET)

                graphic.lastHealthOverlay = healthOverlay
            }

            // Name above the health bar. Only re-set the text when it changes (a
            // PIXI.Text rebuilds its texture on assignment), and fade it together
            // with the ship so a cloaked enemy's name does not give them away.
            if(graphic.nameText.text !== graphic.player.name){
                graphic.nameText.text = graphic.player.name
            }
            graphic.nameText.alpha = graphic.shipContainer.alpha

            // Buff cues, drawn on their OWN buffGraphic (centred on the ship). A
            // pulsing purple ring around a shielded ship; a subtle cyan halo for
            // a hasted one; a ghost-white shimmer for a cloaked one. Each pulses
            // off the shared per-frame buffPulse (radius and/or alpha), so unlike
            // the health bar these genuinely must rebuild their geometry every
            // frame while active. They live apart from overlayGraphic precisely so
            // that per-frame rebuild does not drag the static health bar along.
            const showShield = graphic.player.ship.timings.shield > 0
            const showHaste = graphic.player.ship.timings.haste > 0
            const showCloak = graphic.player.ship.isInvisible && (isClient || graphic.player === followPlayer)
            if(showShield || showHaste || showCloak){
                graphic.buffGraphic.clear()
                if(showShield){
                    const ringRadius = SHIP_DAIMETER * 0.7 + buffPulse * 4
                    graphic.buffGraphic.lineStyle({
                        width: 3,
                        color: PowerupGraphic.COLORS.shield,
                        alpha: 0.5 + buffPulse * 0.35,
                    })
                    graphic.buffGraphic.drawCircle(0, 0, ringRadius)
                }
                if(showHaste){
                    graphic.buffGraphic.lineStyle(0)
                    graphic.buffGraphic.beginFill(PowerupGraphic.COLORS.haste, 0.12 + buffPulse * 0.08)
                    graphic.buffGraphic.drawCircle(0, 0, SHIP_DAIMETER * 0.55)
                    graphic.buffGraphic.endFill()
                }
                // CLOAK cue: a faint ghost-white shimmer ring. Only drawn for the
                // LOCAL player (and spectate target). The overlay is on a sibling
                // of the faded ship sprite, so drawing it for enemies would betray
                // a cloaked ship that is meant to be unseen.
                if(showCloak){
                    graphic.buffGraphic.lineStyle({
                        width: 2,
                        color: PowerupGraphic.COLORS.invis,
                        alpha: 0.25 + buffPulse * 0.25,
                    })
                    graphic.buffGraphic.drawCircle(0, 0, SHIP_DAIMETER * 0.6 + buffPulse * 3)
                }
                graphic.buffGraphicDrawn = true
            } else if(graphic.buffGraphicDrawn){
                // No active buff this frame: clear the rings ONCE on the
                // transition to idle, then leave the empty graphic untouched.
                graphic.buffGraphic.clear()
                graphic.buffGraphicDrawn = false
            }

            // Track whichever player the camera should follow this frame (the
            // local player normally; the spectate target when spectating). Use
            // the smoothed/interpolated tx,ty so the camera rides the same
            // visual position as the ship sprite.
            if(graphic.player === followPlayer && graphic.player.spawned){
                this.camera.target.x = tx
                this.camera.target.y = ty
            }
        }

        // Debug overlay: when the panel is open, visualise each bot's intended
        // route + current target so pathfinding is legible in-world. Cheap (only
        // for bots, only while debug is on); a clear when off.
        this.drawBotPaths(players)

        // Nothing to follow this frame — the local player is briefly dead /
        // respawning, or a spectator has no live target yet. HOLD the camera at
        // its last target instead of snapping to the world origin, so dying
        // doesn't yank the view away for the respawn window. The camera target
        // initializes at the origin, so a cold start (before anyone spawns)
        // still sits sensibly at 0,0.

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

        // update powerups: gentle spin + pulse so the pickups read as "alive".
        const powerupPulse = (Math.sin(Date.now() / 250) + 1) / 2
        for(const graphic of this.powerups.active){
            if(typeof graphic.powerup !== "undefined"){
                graphic.container.position.x = graphic.powerup.position.x
                graphic.container.position.y = graphic.powerup.position.y
            }
            graphic.spin += deltaTime * 0.05
            graphic.graphic.rotation = graphic.spin
            graphic.draw(powerupPulse)
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
        this.particleSystem.update(deltaMs, this.wallSegments)
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
        if(this.crtEnabled){
            // Advance scanline/noise animation only while the effect is on.
            this.crtFilter.time += deltaMs * 0.01
            this.crtFilter.seed = Math.random()
        }
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

    // Rebuild the stage filter stack. The bulge is always on; the CRT pass is
    // appended only when enabled, so toggling it off removes it entirely (no
    // wasted GPU pass).
    rebuildStageFilters(){
        const filters: PIXI.Filter[] = [this.buldgePinchFilter]
        if(this.crtEnabled){
            filters.push(this.crtFilter)
        }
        this.app.stage.filters = filters
    }

    // Toggle the opt-in retro CRT effect. Driven by the ui store (Settings →
    // Graphics) and the persisted graphics settings applied on mount.
    setCrtEnabled(enabled: boolean){
        if(this.crtEnabled === enabled) return
        this.crtEnabled = enabled
        this.rebuildStageFilters()
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
        this.powerups.destroy()
        this.damages.destroy()
        this.particles.destroy()

        // Turning off the map layer cache here releases its cache RenderTexture
        // before app.destroy frees the rest of the tree.
        this.mapLayer.container.cacheAsBitmap = false

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