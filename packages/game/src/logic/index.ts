import { EventEmitter } from "@pip-pip/core/src/common/events"
import { PointPhysicsWorld, Vector2 } from "@pip-pip/core/src/physics"
import { intersectionOfTwoLines, radianDifference } from "@pip-pip/core/src/math"

import { Bullet, BulletPool } from "./bullet"
import { PipPlayer } from "./player"
import { PipShip } from "./ship"
import { PipGameMap } from "./map"
import { PipMapType, PIP_MAPS } from "../maps"
import { tickDown } from "./utils"


export type PipPipGameEventMap = {
    addPlayer: { player: PipPlayer },
    removePlayer: { player: PipPlayer },
    playerIdleChange: { player: PipPlayer },

    playerDetailsChange: { player: PipPlayer },

    playerSetShip: { player: PipPlayer, ship: PipShip },
    playerRemoveShip: { player: PipPlayer, ship: PipShip },
    playerSpawned: { player: PipPlayer },
    playerScoreChanged: { player: PipPlayer },

    setHost: { player: PipPlayer },
    removeHost: undefined,

    settingsChange: undefined,
    phaseChange: undefined,

    setMap: { mapIndex: number, mapType: PipMapType},

    addBullet: { bullet: Bullet },
    removeBullet: { bullet: Bullet },

    addShip: { ship: PipShip },
    removeShip: { ship: PipShip },
    playerReloadStart: { player: PipPlayer },
    playerReloadEnd: { player: PipPlayer },

    dealDamage: { dealer: PipPlayer, target: PipPlayer, damage: number },
    playerKill: { killer: PipPlayer, killed: PipPlayer },
}

export type PipPipGameOptions = {
    shootAiBullets: boolean,
    shootPlayerBullets: boolean,

    calculateAi: boolean,
    assignHost: boolean,
    triggerPhases: boolean
    triggerSpawns: boolean,
    setScores: boolean,

    triggerDamage: boolean,
    considerPlayerPing: boolean,
}

export enum PipPipGameMode {
    DEATHMATCH,
    RACING,
}

export enum PipPipGamePhase {
    SETUP,
    COUNTDOWN,
    MATCH,
    RESULTS,
}

export type PipPipGameSettings = {
    mode: PipPipGameMode,
    useTeams: boolean,
    maxDeaths: 0 | number, // 0 for infinite respawn
    maxKills: 0 | number, // 0 for infinite kills
    friendlyFire: boolean,
}

export class PipPipGame{
    readonly tps = 20
    readonly deltaMs = 1000 / this.tps
    readonly maxTeams = 4

    clientPlayerId = ""

    options: PipPipGameOptions = {
        shootAiBullets: false,
        shootPlayerBullets: false,
        calculateAi: true,
        assignHost: false,
        triggerPhases: false,
        triggerSpawns: false,
        setScores: false,
        triggerDamage: false,
        considerPlayerPing: false,
    }

    events: EventEmitter<PipPipGameEventMap> = new EventEmitter()
    physics: PointPhysicsWorld = new PointPhysicsWorld()

    players: Record<string, PipPlayer> = {}
    bullets: BulletPool
    ships: Record<string, PipShip> = {}

    host?: PipPlayer

    tickNumber = 0
    lastTick = Date.now()

    phase: PipPipGamePhase = PipPipGamePhase.SETUP
    countdown = 0

    mapIndex!:number
    mapType!: PipMapType
    map!: PipGameMap

    settings: PipPipGameSettings = {
        mode: PipPipGameMode.DEATHMATCH,
        useTeams: false,
        maxDeaths: 0,
        maxKills: 25,
        friendlyFire: false,
    }

    constructor(options: Partial<PipPipGameOptions> = {}){
        this.options = {
            ...this.options,
            ...options,
        }
        this.physics.options.baseTps = this.tps
        this.bullets = new BulletPool(this)
        this.setMap()
    }

    setMap(index = 0){
        index = Math.max(0, Math.min(index, PIP_MAPS.length - 1))
        if(this.mapIndex === index) return
        if(typeof this.map !== "undefined"){
            // remove the current map
            for(const rectWall of this.map.rectWalls){
                this.physics.removeRectWall(rectWall)
            }
            for(const segWall of this.map.segWalls){
                this.physics.removeSegWall(segWall)
            }
        }

        const mapType = PIP_MAPS[index]
        const map = mapType.createMap()

        // Add walls
        for(const rectWall of map.rectWalls){
            this.physics.addRectWall(rectWall)
        }

        for(const segWall of map.segWalls){
            this.physics.addSegWall(segWall)
        }

        this.despawnPlayers()
        this.map = map
        this.mapIndex = index
        this.mapType = mapType

        this.events.emit("setMap", { mapIndex: index, mapType })
    }

    setSettings(settings: Partial<PipPipGameSettings> = {}){
        if(this.phase !== PipPipGamePhase.SETUP) return
        let changed = false
        for(const _key in settings){
            const key = _key as keyof PipPipGameSettings
            if(this.settings[key] !== settings[key]){
                changed = true
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const s = this.settings as any // TODO: Fix type
                if(key in s) s[key] = settings[key]
            }
        }
        if(changed){
            this.events.emit("settingsChange")
        }
    }

    createPlayer(id: string){
        return new PipPlayer(this, id)
    }

    destroy(){
        this.players = {}
        this.ships = {}
        this.bullets.destroy()
        this.events.destroy()
        this.physics.destroy()
    }

    setPhase(phase: PipPipGamePhase){
        this.phase = phase
        this.events.emit("phaseChange")
    }

    startMatch(){
        this.countdown = this.tps * 6 // 6 second count down
        this.setPhase(PipPipGamePhase.COUNTDOWN)
        if(this.options.triggerSpawns === true){
            const players = Object.values(this.players)
            for(const player of players){
                player.setSpawned(false)
                this.spawnPlayer(player)
            }
        }
        if(this.options.setScores){
            const players = Object.values(this.players)
            for(const player of players){
                player.resetScores()
            }
        }
    }

    get playerCount(){ return Object.keys(this.players).length }
    
    setHost(player: PipPlayer){
        this.host = player
        this.events.emit("setHost", { player })
    }

    setHostIfNeeded(){
        if(this.options.assignHost === true){
            if(this.playerCount === 0){
                this.removeHost()
            } else{
                const players = Object.values(this.players)
                this.setHost(players[0])
            }
        }
    }

    removeHost(){
        if(typeof this.host !== "undefined"){
            this.host = undefined
            this.events.emit("removeHost")
        }
    }

    update(){
        this.tickNumber++
        this.lastTick = Date.now()
        if(this.phase === PipPipGamePhase.SETUP){
            // despawn all players
            this.despawnPlayers()
        }

        if(this.phase === PipPipGamePhase.COUNTDOWN){
            this.countdown--
            if(this.countdown <= 0){
                this.countdown = 0
                if(this.options.triggerPhases){
                    this.setPhase(PipPipGamePhase.MATCH)
                }
            }
        }
        
        if(this.phase === PipPipGamePhase.MATCH){
            //
        }
        
        if(this.phase !== PipPipGamePhase.SETUP){
            this.updateSystems()
            this.updatePhysics()
        }
    }

    despawnPlayers() {
        if(this.options.triggerSpawns){
            const players = Object.values(this.players)
            for(const player of players){
                if(player.spawned === true){
                    player.setSpawned(false)
                }
            }
        }
    }

    spawnPlayer(player: PipPlayer, x?: number, y?: number){
        let finalX: number
        let finalY: number
        if(typeof x === "number" && typeof y === "number"){
            finalX = x
            finalY = y
        } else{
            if(player.canSpawn === false) return
            if(this.map.spawns.length === 0) return
            const index = Math.floor(Math.random() * this.map.spawns.length)
            const spawn = this.map.spawns[index]
            const angle = Math.random() * Math.PI * 2
            finalX = Math.round(spawn.x + Math.cos(angle) * spawn.radius)
            finalY = Math.round(spawn.y + Math.sin(angle) * spawn.radius)
        }
        player.ship.physics.position.x = finalX
        player.ship.physics.position.y = finalY
        player.ship.physics.velocity.x = 0
        player.ship.physics.velocity.y = 0

        player.ship.reset()
        player.positionStates = []

        player.setSpawned(true)
    }

    addPlayerMidGame(player: PipPlayer){
        if(this.phase === PipPipGamePhase.SETUP) return
        this.spawnPlayer(player)
    }

    updateSystems(){
        if(this.phase === PipPipGamePhase.MATCH){

            for(const player of Object.values(this.players)){
                const playerIsClient = player.id === this.clientPlayerId
                const authorizedToShootBullet = playerIsClient === true || this.options.shootPlayerBullets === true
                const wasWaitingForSpawn = player.spawned === false && player.timings.spawnTimeout !== 0
                // update player
                player.update()
                if(this.options.triggerSpawns === true){
                    if(wasWaitingForSpawn && player.timings.spawnTimeout === 0){
                        this.spawnPlayer(player)
                    }
                }

                // reload input
                if(authorizedToShootBullet && player.ship.canReload && player.inputs.doReload){
                    player.ship.reload()
                }
            }


            for(const player of Object.values(this.players)){
                const playerIsClient = player.id === this.clientPlayerId
                const authorizedToShootBullet = playerIsClient === true || this.options.shootPlayerBullets === true

                // update bullet stuff
                if(authorizedToShootBullet && player.inputs.useWeapon === true && player.spawned === true){
                    // shoot bullets
                    if(player.ship.shoot()){
                        // shoot bullet
                        let positionX = player.ship.physics.position.x
                        let positionY = player.ship.physics.position.y
                        let rotation = player.ship.rotation

                        if(this.options.considerPlayerPing){
                            const lookbackRaw = player.ping / this.deltaMs
                            const prev = player.getLastTickState(lookbackRaw)
                            positionX = prev.positionX
                            positionY = prev.positionY
                            rotation = prev.rotation
                        }

                        this.bullets.new({
                            position: new Vector2(positionX, positionY),
                            owner: player,
                            speed: player.ship.stats.bullet.velocity,
                            radius: player.ship.stats.bullet.radius,
                            rotation,
                        })
                    }
                }
                
                // accelerate players
                const vel = Math.sqrt(
                    player.ship.physics.velocity.x * player.ship.physics.velocity.x +
                    player.ship.physics.velocity.y * player.ship.physics.velocity.y
                )
                const playerMovementInput = Math.max(0, Math.min(1, player.inputs.movementAmount)) 
                const playerAccelerationInput = player.ship.stats.movement.acceleration.normal * playerMovementInput
                const playerSpeedLimitTip = Math.max(0, (vel + playerAccelerationInput) - player.ship.stats.movement.speed.normal / (1 - player.ship.physics.airResistance))
                const playerCappedAccelerationInput = playerAccelerationInput - playerSpeedLimitTip
                
                if(playerCappedAccelerationInput > 0){
                    const angleDiff = radianDifference(player.inputs.movementAngle, player.inputs.aimRotation)
                    const angleEffect = (angleDiff / Math.PI) * (Math.PI / 6) * (1 - player.ship.stats.movement.agility)
                    const agilityModifier = Math.pow(player.ship.stats.movement.agility + (1 - Math.abs(angleDiff) / Math.PI) * (1 - player.ship.stats.movement.agility), 2)
                    const agilityAcceleration = playerCappedAccelerationInput * agilityModifier
                    player.ship.physics.velocity.x += Math.cos(player.inputs.movementAngle + angleEffect) * agilityAcceleration
                    player.ship.physics.velocity.y += Math.sin(player.inputs.movementAngle + angleEffect) * agilityAcceleration
                }
            }

            // update bullets
            for(const bullet of this.bullets.getActive()){
                bullet.update()

                // bullet lived too long
                if(bullet.lifespan <= 0) {
                    this.bullets.unset(bullet)
                }
            }
        } else{
            // destroy all bullets
            this.bullets.destroy()
        }
        
        // Kill bullets
    }

    dealDamage(dealer: PipPlayer, target: PipPlayer){
        if(this.options.triggerDamage === false) return

        // decrease health
        const dealerDamage = dealer.ship.stats.bullet.damage.normal
        const defenseRatio = 2 - target.ship.defense
        const rawDamage = Math.max(1, Math.round(defenseRatio * dealerDamage))
        const damage = Math.min(rawDamage, target.ship.capacities.health)
        target.ship.capacities.health = tickDown(target.ship.capacities.health, damage)

        // increase damage
        dealer.score.damage += damage

        // log damage
        this.events.emit("dealDamage", {
            dealer,
            target,
            damage,
        })

        // trigger kill
        if(target.ship.capacities.health === 0){
            // kill
            dealer.score.kills += 1
            target.score.deaths += 1
            target.setSpawned(false)
            target.timings.spawnTimeout = 20 * 3 // 3 seconds
            this.events.emit("playerKill", {
                killer: dealer,
                killed: target,
            })
        }
    }

    updateBulletPhysics(){
        // check wall collisions
        const segWalls = Object.values(this.physics.segWalls)
        for(const bullet of this.bullets.getActive()){
            // type Intersections = {x: number, y: number}
            // const intersections: Intersections[] = []

            for(const segWall of segWalls){
                const intersection = intersectionOfTwoLines(
                    bullet.physics.position.x, 
                    bullet.physics.position.y,
                    bullet.physics.position.x + bullet.physics.velocity.x,
                    bullet.physics.position.y + bullet.physics.velocity.y,
                    segWall.start.x,
                    segWall.start.y,
                    segWall.end.x,
                    segWall.end.y,
                )

                if(intersection === null) continue

                const epsilon = 1 

                const minIntX = Math.min(segWall.start.x, segWall.end.x) - epsilon
                const maxIntX = Math.max(segWall.start.x, segWall.end.x) + epsilon
                const minIntY = Math.min(segWall.start.y, segWall.end.y) - epsilon
                const maxIntY = Math.max(segWall.start.y, segWall.end.y) + epsilon
                const inIntX = minIntX <= intersection.x && intersection.x <= maxIntX
                const inIntY = minIntY <= intersection.y && intersection.y <= maxIntY

                const minBulX = Math.min(bullet.physics.position.x, bullet.physics.position.x + bullet.physics.velocity.x) - epsilon
                const maxBulX = Math.max(bullet.physics.position.x, bullet.physics.position.x + bullet.physics.velocity.x) + epsilon
                const minBulY = Math.min(bullet.physics.position.y, bullet.physics.position.y + bullet.physics.velocity.y) - epsilon
                const maxBulY = Math.max(bullet.physics.position.y, bullet.physics.position.y + bullet.physics.velocity.y) + epsilon
                const inBulX = minBulX <= intersection.x && intersection.x <= maxBulX
                const inBulY = minBulY <= intersection.y && intersection.y <= maxBulY

                if(inIntX && inIntY && inBulX && inBulY){
                    // improve this in the future
                    this.bullets.unset(bullet)
                    // intersections.push(intersection)
                    // bullet.physics.velocity.x = 0
                    // bullet.physics.velocity.y = 0
                }

                // const nearest = nearestPointFromSegment(
                //     segWall.start.x,
                //     segWall.start.y,
                //     segWall.end.x,
                //     segWall.end.y,
                //     intersection.x,
                //     intersection.y,
                // )
                
                // const dx = nearest.x - intersection.x
                // const dy = nearest.y - intersection.y
                // const dist = Math.sqrt(dx * dx + dy * dy)
                // if(dist < segWall.radius + bullet.physics.radius){
                //     bullet.physics.position.x = nearest.x
                //     bullet.physics.position.y = nearest.y
                //     bullet.physics.velocity.x = 0
                //     bullet.physics.velocity.y = 0
                // }
            }

            // get the nearest
            // if(intersections.length === 0) continue

            // let distance = Infinity
            // let intersection = intersections[0]
            // for(let i = 1; i < intersections.length; i++){
            //     const inters = intersections[i]
            //     const dx = bullet.physics.position.x - inters.x
            //     const dy = bullet.physics.position.y - inters.y
            //     const dist = Math.sqrt(dx * dx + dy * dy)
            //     if(dist < distance){
            //         distance = dist
            //         intersection = inters
            //     }
            // }

            // bullet.physics.position.x = intersection.x
            // bullet.physics.position.y = intersection.y
            // bullet.physics.velocity.x = 0
            // bullet.physics.velocity.y = 0
        }

        // collide with players
        const players = Object.values(this.players)
        for(const player of players){
            if(player.spawned === false) continue

            for(const bullet of this.bullets.getActive()){
                if(bullet.owner === player) continue
                // 1 is player
                // 2 is bullet

                let playerPositionX = player.ship.physics.position.x
                let playerPositionY = player.ship.physics.position.y
                let playerVelocityX = player.ship.physics.velocity.x
                let playerVelocityY = player.ship.physics.velocity.y

                if(this.options.considerPlayerPing === true){
                    const lookbackRaw = player.ping / this.deltaMs
                    const prev = player.getLastTickState(lookbackRaw)
                    playerPositionX = prev.positionX
                    playerPositionY = prev.positionY
                    playerVelocityX = prev.velocityX
                    playerVelocityY = prev.velocityY
                }

                const Vx = bullet.physics.velocity.x - playerVelocityX
                const Vy = bullet.physics.velocity.y - playerVelocityY
                const tDenominator = Vx * Vx + Vy * Vy
                if(tDenominator === 0) continue

                const Px = bullet.physics.position.x - playerPositionX
                const Py = bullet.physics.position.y - playerPositionY
                const r = player.ship.physics.radius + bullet.physics.radius

                const A = Vx * Vx * (r * r - Py * Py)
                const B = 2 * Px * Py * Vx * Vy
                const C = Vy * Vy * (r * r - Px * Px)
                const D = Px * Vx
                const E = Py * Vy

                if(A + B + C < 0) continue

                const t = (Math.sqrt(A + B + C) - D - E) / tDenominator

                const tValid = t >= 0 && t <= 1

                if(tValid === false) continue
                if(bullet.owner instanceof PipPlayer){
                    this.dealDamage(bullet.owner, player)
                }
                this.bullets.unset(bullet)
            }
        }
    }

    updatePhysics(){
        // Run physics
        this.updateBulletPhysics()
        this.physics.update(this.deltaMs)
        
        // Enforce map bounds
        const R = -0.5
        for(const player of Object.values(this.players)){
            if(player.ship.physics.position.x < this.map.bounds.min.x){
                player.ship.physics.position.x = this.map.bounds.min.x
                player.ship.physics.velocity.x *= R
            }
            if(player.ship.physics.position.y < this.map.bounds.min.y){
                player.ship.physics.position.y = this.map.bounds.min.y
                player.ship.physics.velocity.y *= R
            }
            if(player.ship.physics.position.x > this.map.bounds.max.x){
                player.ship.physics.position.x = this.map.bounds.max.x
                player.ship.physics.velocity.x *= R
            }
            if(player.ship.physics.position.y > this.map.bounds.max.y){
                player.ship.physics.position.y = this.map.bounds.max.y
                player.ship.physics.velocity.y *= R
            }
        }

        for(const player of Object.values(this.players)){
            player.trackPositionState()
        }
    }
}