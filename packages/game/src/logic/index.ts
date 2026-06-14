import { EventEmitter } from "@pip-pip/core/src/common/events"
import { PointPhysicsWorld, Vector2, airResistanceMultiplier, limitSpeed, WALL_RESOLVE_ITERATIONS } from "@pip-pip/core/src/physics"
import { distanceBetweenSegments, radianDifference } from "@pip-pip/core/src/math"

import { Bullet, BulletPool, BulletType } from "./bullet"
import { Powerup, PowerupPool, PowerupType, applyPowerupEffect, HASTE_MULTIPLIER } from "./powerup"
import { PipPlayer, PlayerInputs } from "./player"
import { updateBotInputs } from "./ai"
import { generateId } from "@pip-pip/core/src/lib/utils"
import { PipShip } from "./ship"
import { PipGameMap } from "./map"
import { PipMapType, PIP_MAPS } from "../maps"
import { tickDown } from "./utils"
import { INTERP_DELAY_TICKS } from "./constants"


export type PipPipGameEventMap = {
    addPlayer: { player: PipPlayer },
    removePlayer: { player: PipPlayer },
    playerIdleChange: { player: PipPlayer },
    playerSpectateChange: { player: PipPlayer },

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

    powerupSpawn: { powerup: Powerup },
    powerupDespawn: { powerup: Powerup },
    powerupPickup: { player: PipPlayer, powerup: Powerup },
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

    spawnPowerups: boolean,
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
        spawnPowerups: false,
    }

    events: EventEmitter<PipPipGameEventMap> = new EventEmitter()
    physics: PointPhysicsWorld = new PointPhysicsWorld()

    players: Record<string, PipPlayer> = {}
    bullets: BulletPool
    powerups: PowerupPool
    ships: Record<string, PipShip> = {}

    // Server-authoritative powerup spawning (gated on options.spawnPowerups):
    // at most POWERUP_MAX_ACTIVE alive at once, a fresh one attempted every
    // POWERUP_SPAWN_INTERVAL_TICKS during MATCH. Respawn falls out of the same
    // cap/interval loop once a pickup frees a slot.
    readonly POWERUP_MAX_ACTIVE = 4
    readonly POWERUP_SPAWN_INTERVAL_TICKS = this.tps * 8 // ~8 seconds
    // Counts down to the next spawn attempt; starts at a full interval so the
    // field is not flooded the instant a match begins.
    powerupSpawnTimer = this.tps * 8

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
        this.powerups = new PowerupPool(this)
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

    // Bots are players keyed by a 2-char id whose FIRST char is "~" (0x7E), e.g.
    // "~0".."~z". The connection-id pool is alphanumerics only (see
    // generateId), so a "~"-prefixed id can never collide with a real
    // connection id, and it is exactly 2 chars so it round-trips through the
    // $string(CONNECTION_ID_LENGTH=2) playerId serializer like any player id.
    nextBotId(){
        const taken = Object.keys(this.players)
        let id = "~" + generateId(1)
        while(taken.includes(id)){
            id = "~" + generateId(1)
        }
        return id
    }

    // Add one training-grounds bot. It self-registers into game.players (like
    // any PipPlayer) and is broadcast to every real client by the normal
    // per-player broadcast, since that iterates all players. During a live
    // MATCH the bot is spawned immediately so it joins the fight at once.
    addBot(){
        const bot = this.createPlayer(this.nextBotId())
        bot.isBot = true
        bot.setName("BOT-" + bot.id.slice(1).toUpperCase())
        this.addPlayerMidGame(bot)
        return bot
    }

    addBots(count: number){
        const bots: PipPlayer[] = []
        const safeCount = Math.max(0, Math.floor(count))
        for(let i = 0; i < safeCount; i++){
            bots.push(this.addBot())
        }
        return bots
    }

    clearBots(){
        let removed = 0
        for(const player of Object.values(this.players)){
            if(player.isBot === true){
                player.remove()
                removed++
            }
        }
        return removed
    }

    destroy(){
        this.players = {}
        this.ships = {}
        this.bullets.destroy()
        this.powerups.destroy()
        this.events.destroy()
        this.physics.destroy()
    }

    setPhase(phase: PipPipGamePhase){
        this.phase = phase
        this.events.emit("phaseChange")
    }

    startMatch(){
        this.countdown = this.tps * 6 // 6 second count down
        this.powerupSpawnTimer = this.POWERUP_SPAWN_INTERVAL_TICKS
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

    // A player is eligible to be host only if it is a present, connected
    // (non-idle), real (non-bot) player. Idle players are disconnected tabs and
    // bots have no connection to drive host-only controls, so neither should
    // ever hold the host slot.
    isHostEligible(player: PipPlayer){
        if(!(player.id in this.players)) return false
        if(player.idle === true) return false
        if(player.isBot === true) return false
        return true
    }

    // Recompute the host so it is always a present, non-idle, non-bot player
    // when one exists. Called on join/leave (PipPlayer add/remove) and every
    // tick (update) so a host going idle/disconnecting hands off promptly.
    //
    // Keep the current host if it is still eligible (no needless churn / event
    // spam). Otherwise promote the first eligible player — effectively the
    // longest-present real, connected player, since insertion order is
    // preserved. When the lobby has no eligible player (empty, or only bots /
    // idle players remain) the host is cleared. A first player joining an empty
    // lobby falls out of this naturally: they are the only eligible candidate,
    // so they become host.
    setHostIfNeeded(){
        if(this.options.assignHost !== true) return
        if(typeof this.host !== "undefined" && this.isHostEligible(this.host)) return
        const candidate = Object.values(this.players).find(player => this.isHostEligible(player))
        if(typeof candidate === "undefined"){
            this.removeHost()
        } else{
            this.setHost(candidate)
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

        // Re-evaluate the host every tick (gated on assignHost). Joins/leaves
        // already trigger this via PipPlayer add/remove, but a host going idle
        // (disconnected tab) flips player.idle without going through here, so
        // the per-tick check is what hands the host off to an active player.
        this.setHostIfNeeded()

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
        // Spawn is an authoritative teleport: drop all prediction/interp state
        // so nothing replays or interpolates across the discontinuity.
        player.resetNetworkState()

        player.setSpawned(true)
    }

    addPlayerMidGame(player: PipPlayer){
        if(this.phase === PipPipGamePhase.SETUP) return
        this.spawnPlayer(player)
    }

    updateSystems(){
        if(this.phase === PipPipGamePhase.MATCH){

            // Anti-farm: despawn idle (disconnected) real players during MATCH
            // so a closed/reloaded tab does not leave a free sitting-duck kill
            // on the field. Bots are deliberately exempt — they are training
            // targets and are never idle. Gated on triggerSpawns so only the
            // authoritative server despawns; the client mirrors it via packets.
            if(this.options.triggerSpawns === true){
                for(const player of Object.values(this.players)){
                    if(player.idle === true && player.isBot === false && player.spawned === true){
                        player.setSpawned(false)
                    }
                }
            }

            // Drive AI bots before inputs are consumed. The brain writes each
            // bot's inputs directly (their inputQueue is always empty, so the
            // consume step below is a no-op for them and leaves these inputs
            // intact). Gated by calculateAi so a non-authoritative client
            // instance never re-derives bot behaviour locally.
            if(this.options.calculateAi === true){
                const allPlayers = Object.values(this.players)
                for(const player of allPlayers){
                    if(player.isBot === true && player.spawned === true){
                        updateBotInputs(player, allPlayers)
                    }
                }
            }

            // Consume one queued input per player per tick, in seq order. This
            // is a no-op on the client and for AI (their queues are empty);
            // only the server populates inputQueue (one connection's stream
            // per player), so it stays server-authoritative without a flag.
            for(const player of Object.values(this.players)){
                player.consumeQueuedInput()
            }

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
                        const spread = player.ship.stats.weapon.spread
                        // A multi-pellet primary splits its configured damage
                        // among the pellets so a wide spray is not strictly
                        // better than a single focused shot (total on-target
                        // damage matches a single bullet when every pellet hits).
                        const damage = player.ship.stats.bullet.damage.normal / Math.max(1, spread.count)
                        this.spawnSpread(
                            player,
                            spread.count,
                            spread.angle,
                            player.ship.stats.bullet.velocity,
                            player.ship.stats.bullet.radius,
                            damage,
                            "primary",
                        )
                    }
                }

                // tactical / secondary weapon: a slow, heavy cannon on its own
                // ammo + cooldown. Same authority + ping-rewind handling as the
                // primary weapon, driven by the useTactical input.
                if(authorizedToShootBullet && player.inputs.useTactical === true && player.spawned === true){
                    if(player.ship.shootTactical()){
                        const tactical = player.ship.stats.tactical
                        const spread = tactical.spread
                        const damage = tactical.damage.normal / Math.max(1, spread.count)
                        // The tactical weapon fires either the heavy single-target
                        // "cannon" round (default) or a "grenade" that detonates
                        // with area-of-effect damage when it ends its life. The
                        // ship's tactical.bulletKind picks which; a grenade also
                        // carries its blast radius so the AoE (and the client's
                        // explosion) can size itself.
                        const isGrenade = tactical.bulletKind === "grenade"
                        this.spawnSpread(
                            player,
                            spread.count,
                            spread.angle,
                            tactical.bullet.velocity,
                            tactical.bullet.radius,
                            damage,
                            isGrenade ? "grenade" : "tactical",
                            isGrenade ? tactical.explosionRadius : 0,
                        )
                    }
                }

                // accelerate players (shared with the client-side replay step)
                const accel = this.computeMovementAcceleration(player, player.inputs)
                player.ship.physics.velocity.x += accel.x
                player.ship.physics.velocity.y += accel.y
            }

            // update bullets
            for(const bullet of this.bullets.getActive()){
                bullet.update()

                // bullet lived too long
                if(bullet.lifespan <= 0) {
                    // A grenade that expires mid-air still detonates (AoE).
                    this.detonateGrenade(bullet)
                    this.bullets.unset(bullet)
                }
            }

            // spawn map powerups (server-authoritative)
            this.updatePowerupSpawns()
        } else{
            // destroy all bullets
            this.bullets.destroy()
            // destroy all powerups (so a match that ends clears the field)
            this.powerups.destroy()
        }
    }

    // Server-authoritative powerup spawning. Gated on options.spawnPowerups so a
    // non-authoritative client never invents pickups (it only receives them via
    // packets). Only runs during MATCH (the single MATCH-branch caller already
    // guarantees this). Tops the field up to POWERUP_MAX_ACTIVE, attempting one
    // new spawn every POWERUP_SPAWN_INTERVAL_TICKS; the same loop handles respawn
    // after a pickup frees a slot.
    updatePowerupSpawns(){
        if(this.options.spawnPowerups !== true) return

        if(this.powerupSpawnTimer > 0){
            this.powerupSpawnTimer = tickDown(this.powerupSpawnTimer, 1)
            return
        }
        this.powerupSpawnTimer = this.POWERUP_SPAWN_INTERVAL_TICKS

        if(this.powerups.getActive().length >= this.POWERUP_MAX_ACTIVE) return

        const position = this.randomPowerupPosition()
        if(typeof position === "undefined") return

        // Weighted pool: each entry is one "ticket", so a type listed more often
        // is more likely. health/ammo/haste/shield each get 2 tickets; the strong
        // "invis" cloak gets a single ticket so it shows up roughly half as often.
        // Extend this pool (adjust the repeats to tune rarity) as types are added.
        const types: PowerupType[] = [
            "health", "health",
            "ammo", "ammo",
            "haste", "haste",
            "shield", "shield",
            "invis",
        ]
        const type = types[Math.floor(Math.random() * types.length)]

        this.powerups.new({ position, type })
    }

    // Pick an open world position for a powerup. Reuses the map's spawn points
    // (already guaranteed open, away from walls) like spawnPlayer does — simple
    // and collision-free. Returns undefined when the map has no spawn points.
    randomPowerupPosition(){
        if(this.map.spawns.length === 0) return undefined
        const index = Math.floor(Math.random() * this.map.spawns.length)
        const spawn = this.map.spawns[index]
        const angle = Math.random() * Math.PI * 2
        return new Vector2(
            Math.round(spawn.x + Math.cos(angle) * spawn.radius),
            Math.round(spawn.y + Math.sin(angle) * spawn.radius),
        )
    }

    // Resolve powerup pickups: a SPAWNED player whose ship overlaps an active
    // powerup (circle-vs-circle, like bullet-vs-player) picks it up. The effect
    // is applied server-side and gated like damage on spawnPowerups, the powerup
    // is marked dead, and powerupPickup is emitted so the broadcast can tell
    // clients to remove it. A non-authoritative client never runs this (the flag
    // is off there); it removes powerups purely from the powerupPickup packet.
    updatePowerupPickups(){
        if(this.options.spawnPowerups !== true) return

        for(const player of Object.values(this.players)){
            if(player.spawned === false) continue
            for(const powerup of this.powerups.getActive()){
                const dx = player.ship.physics.position.x - powerup.position.x
                const dy = player.ship.physics.position.y - powerup.position.y
                const r = player.ship.physics.radius + powerup.radius
                if(dx * dx + dy * dy > r * r) continue
                this.pickupPowerup(player, powerup)
                break
            }
        }
    }

    pickupPowerup(player: PipPlayer, powerup: Powerup){
        applyPowerupEffect(powerup.type, player)
        this.events.emit("powerupPickup", { player, powerup })
        this.powerups.unset(powerup)
    }

    // Emit `count` bullets for one shot, fanned evenly across a cone of total
    // width `angle` (radians) centred on the firing direction. The base
    // position/rotation is the shooter's ship now, OR — when considerPlayerPing
    // is set — rewound to where the shooter's own ship was when they fired
    // (one-way latency, ping/2; the shooter sees themselves via prediction at
    // present time, so no interp delay). The same base is reused for every
    // pellet so the whole spray originates from one point.
    //
    // For count N and angle A, pellet i (0..N-1) is offset by
    // -A/2 + i * (A / (N - 1)); N === 1 always fires straight (offset 0).
    spawnSpread(
        player: PipPlayer,
        count: number,
        angle: number,
        speed: number,
        radius: number,
        damage: number,
        type: BulletType,
        explosionRadius = 0,
    ){
        const pellets = Math.max(1, Math.floor(count))

        let positionX = player.ship.physics.position.x
        let positionY = player.ship.physics.position.y
        let baseRotation = player.ship.rotation

        if(this.options.considerPlayerPing){
            const lookbackRaw = (player.ping / 2) / this.deltaMs
            const prev = player.getLastTickState(lookbackRaw)
            positionX = prev.positionX
            positionY = prev.positionY
            baseRotation = prev.rotation
        }

        for(let i = 0; i < pellets; i++){
            const offset = pellets === 1 ? 0 : -angle / 2 + i * (angle / (pellets - 1))
            this.bullets.new({
                position: new Vector2(positionX, positionY),
                owner: player,
                speed,
                radius,
                rotation: baseRotation + offset,
                damage,
                type,
                explosionRadius,
            })
        }
    }

    // Movement acceleration for a single input. Single source of truth shared
    // by the authoritative server tick (updateSystems) and the client-side
    // replay step (stepLocalPlayer) so the two cannot drift apart.
    computeMovementAcceleration(player: PipPlayer, inputs: PlayerInputs): { x: number, y: number }{
        const phys = player.ship.physics
        const vel = Math.sqrt(phys.velocity.x * phys.velocity.x + phys.velocity.y * phys.velocity.y)
        const movementInput = Math.max(0, Math.min(1, inputs.movementAmount))
        // HASTE buff: scale both acceleration and the speed cap by the same
        // factor so a hasted ship both accelerates harder AND tops out faster.
        // This lives in the shared movement step, so the local player's
        // prediction uses it too (the timing is networked, see playerShipTimings).
        const hasteFactor = player.ship.timings.haste > 0 ? HASTE_MULTIPLIER : 1
        const accelerationInput = player.ship.stats.movement.acceleration.normal * movementInput * hasteFactor
        const speedCap = (player.ship.stats.movement.speed.normal * hasteFactor) / (1 - phys.airResistance)
        const speedLimitTip = Math.max(0, (vel + accelerationInput) - speedCap)
        const cappedAccelerationInput = accelerationInput - speedLimitTip

        if(cappedAccelerationInput <= 0) return { x: 0, y: 0 }

        const agility = player.ship.stats.movement.agility
        const angleDiff = radianDifference(inputs.movementAngle, inputs.aimRotation)
        const angleEffect = (angleDiff / Math.PI) * (Math.PI / 6) * (1 - agility)
        const agilityModifier = Math.pow(agility + (1 - Math.abs(angleDiff) / Math.PI) * (1 - agility), 2)
        const agilityAcceleration = cappedAccelerationInput * agilityModifier
        return {
            x: Math.cos(inputs.movementAngle + angleEffect) * agilityAcceleration,
            y: Math.sin(inputs.movementAngle + angleEffect) * agilityAcceleration,
        }
    }

    // Advance ONLY the local player's kinematics by one tick for the given
    // input, reproducing the server's per-tick order exactly: accelerate →
    // damp (air resistance) → clamp speed → integrate → resolve walls →
    // world-bounds bounce. It shares the air-resistance, speed-clamp and wall
    // resolver (and its iteration count) with the authoritative world step so
    // the two cannot drift. dt is fixed at 1 (never the Date.now() ticker delta).
    stepLocalPlayer(player: PipPlayer, inputs: PlayerInputs, dt = 1){
        const phys = player.ship.physics

        const accel = this.computeMovementAcceleration(player, inputs)
        phys.velocity.x += accel.x
        phys.velocity.y += accel.y

        const airResistance = airResistanceMultiplier(phys.airResistance, dt)
        phys.velocity.x *= airResistance
        phys.velocity.y *= airResistance

        const limited = limitSpeed(phys.velocity.x, phys.velocity.y, this.physics.options.maxVelocity)
        phys.velocity.x = limited.x
        phys.velocity.y = limited.y

        phys.position.x += phys.velocity.x * dt
        phys.position.y += phys.velocity.y * dt

        // Resolve walls with the SAME resolver and iteration count as the
        // authoritative world step, so the replay stops at walls exactly as the
        // server does (this is what fully removes the wall rubber-band).
        for(let iteration = 0; iteration < WALL_RESOLVE_ITERATIONS; iteration++){
            this.physics.resolveWallCollisions(phys)
        }
        this.applyMapBounds(player)
    }

    applyMapBounds(player: PipPlayer){
        const R = -0.5
        const phys = player.ship.physics
        if(phys.position.x < this.map.bounds.min.x){
            phys.position.x = this.map.bounds.min.x
            phys.velocity.x *= R
        }
        if(phys.position.y < this.map.bounds.min.y){
            phys.position.y = this.map.bounds.min.y
            phys.velocity.y *= R
        }
        if(phys.position.x > this.map.bounds.max.x){
            phys.position.x = this.map.bounds.max.x
            phys.velocity.x *= R
        }
        if(phys.position.y > this.map.bounds.max.y){
            phys.position.y = this.map.bounds.max.y
            phys.velocity.y *= R
        }
    }

    dealDamage(dealer: PipPlayer, target: PipPlayer, weaponDamage = dealer.ship.stats.bullet.damage.normal){
        if(this.options.triggerDamage === false) return

        // Anti-farm: award NO damage/kill/score credit for hits against an idle
        // (disconnected) real player. Idle players are already despawned during
        // MATCH, but this is the authoritative backstop so a reload-the-tab
        // exploit can never farm a disconnected enemy for free score. Bots stay
        // farmable (never idle) so training still works. Same triggerDamage gate
        // as above, so only the server enforces it.
        if(target.idle === true && target.isBot === false) return

        // SHIELD buff (or legacy invincibility): the target takes ZERO health
        // loss. It still exists and collides — only the health hit is blocked.
        // Covers grenades too, since detonateGrenade routes through dealDamage.
        if(target.ship.isShielded) return

        // decrease health
        const dealerDamage = weaponDamage
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

    // Detonate a grenade at its current position, dealing area-of-effect damage
    // to EVERY spawned player within the grenade's explosionRadius — including
    // the grenade's own owner (self-damage is intended: standing on your own
    // blast hurts, exactly like a real grenade). Damage falls off linearly with
    // distance: full base damage at the centre, scaling to ~0 at the radius
    // edge, with a floor of 1 for any player that overlaps the blast at all so a
    // graze always registers. Server-authoritative: gated on triggerDamage, and
    // computed at detonation time against players' CURRENT positions (the AoE is
    // a plain radius check, not ping-rewound — only direct-hit detection is
    // lag-compensated; see updateBulletPhysics). dealDamage emits the normal
    // dealDamage events so damage numbers and sounds already work. Call this
    // immediately before unsetting the grenade, so the blast originates from the
    // bullet's position before it is reset.
    detonateGrenade(bullet: Bullet){
        if(this.options.triggerDamage === false) return
        if(bullet.type !== "grenade") return
        if(!(bullet.owner instanceof PipPlayer)) return
        const radius = bullet.explosionRadius
        if(radius <= 0) return

        const blastX = bullet.physics.position.x
        const blastY = bullet.physics.position.y

        for(const player of Object.values(this.players)){
            if(player.spawned === false) continue
            const dx = player.ship.physics.position.x - blastX
            const dy = player.ship.physics.position.y - blastY
            const dist = Math.sqrt(dx * dx + dy * dy)
            // A player counts as caught in the blast when its hitbox overlaps the
            // explosion circle (centre distance within radius + ship radius).
            const reach = radius + player.ship.physics.radius
            if(dist > reach) continue

            // Linear falloff from full damage at the centre to 0 at the edge,
            // clamped to a minimum of 1 so any overlap deals at least 1.
            const falloff = Math.max(0, 1 - dist / reach)
            const scaled = Math.max(1, bullet.damage * falloff)
            this.dealDamage(bullet.owner, player, scaled)
        }
    }

    updateBulletPhysics(){
        // check wall collisions: swept circle (the bullet's motion segment,
        // inflated by both radii) vs each wall segment. The previous test used
        // a zero-width line intersection that missed corner grazes and skims
        // for fast bullets (velocity is 100/tick, larger than the bullet).
        const segWalls = Object.values(this.physics.segWalls)
        for(const bullet of this.bullets.getActive()){
            const hitRadius = bullet.physics.radius
            for(const segWall of segWalls){
                const dist = distanceBetweenSegments(
                    bullet.physics.position.x,
                    bullet.physics.position.y,
                    bullet.physics.position.x + bullet.physics.velocity.x,
                    bullet.physics.position.y + bullet.physics.velocity.y,
                    segWall.start.x,
                    segWall.start.y,
                    segWall.end.x,
                    segWall.end.y,
                )

                if(dist <= hitRadius + segWall.radius){
                    // A grenade that hits a wall detonates on contact (AoE).
                    this.detonateGrenade(bullet)
                    this.bullets.unset(bullet)
                    break
                }
            }
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

                if(this.options.considerPlayerPing === true && bullet.owner instanceof PipPlayer){
                    // Rewind the TARGET to where the SHOOTER saw it WHEN FIRING:
                    // the shooter's one-way latency (ping/2) plus the render
                    // interpolation delay the shooter views remote ships behind.
                    // The rewind is anchored to the bullet's spawn tick (via its
                    // age) so the target's hitbox stays frozen at the fired-at
                    // moment for the bullet's whole flight. Without the age term
                    // the lookback would track an ever-advancing "now", sliding
                    // the hitbox forward each tick so a bullet aimed where the
                    // shooter saw a moving target could never catch it.
                    const age = bullet.spawnTick >= 0 ? this.tickNumber - bullet.spawnTick : 0
                    const lookbackRaw = (bullet.owner.ping / 2) / this.deltaMs + INTERP_DELAY_TICKS + age
                    const prev = player.getLastTickState(lookbackRaw)
                    playerPositionX = prev.positionX
                    playerPositionY = prev.positionY
                    playerVelocityX = prev.velocityX
                    playerVelocityY = prev.velocityY
                }

                const Px = bullet.physics.position.x - playerPositionX
                const Py = bullet.physics.position.y - playerPositionY
                const r = player.ship.physics.radius + bullet.physics.radius

                // Swept-circle test over this tick's relative motion. Treat the
                // bullet as a point moving by the relative velocity V against a
                // circle of combined radius r centred on the (possibly rewound)
                // target. A hit is the FIRST contact: an overlap already present
                // at the start of the tick (t <= 0) or an entry root within the
                // tick (0 <= t_entry <= 1). The previous version solved for the
                // EXIT root and rejected anything already overlapping, so a bullet
                // sitting on a target — including the degenerate case where the
                // bullet and target share a velocity (relative speed 0) — dealt no
                // damage at all.
                const Vx = bullet.physics.velocity.x - playerVelocityX
                const Vy = bullet.physics.velocity.y - playerVelocityY
                const tDenominator = Vx * Vx + Vy * Vy

                let hit: boolean
                if(Px * Px + Py * Py <= r * r){
                    // Already overlapping at the start of the tick.
                    hit = true
                } else if(tDenominator === 0){
                    // No relative motion and not overlapping: cannot connect.
                    hit = false
                } else{
                    // Quadratic |P + tV|^2 = r^2. Real roots require a
                    // non-negative discriminant; the entry (smaller) root is the
                    // first contact. A hit lands this tick when it falls in [0, 1].
                    const b = 2 * (Px * Vx + Py * Vy)
                    const c = Px * Px + Py * Py - r * r
                    const discriminant = b * b - 4 * tDenominator * c
                    if(discriminant < 0){
                        hit = false
                    } else{
                        const tEntry = (-b - Math.sqrt(discriminant)) / (2 * tDenominator)
                        hit = tEntry >= 0 && tEntry <= 1
                    }
                }

                if(hit === false) continue
                if(bullet.type === "grenade"){
                    // A grenade that touches a player detonates with AoE rather
                    // than dealing single-target damage — the radius check inside
                    // detonateGrenade covers this player and anyone nearby.
                    this.detonateGrenade(bullet)
                } else if(bullet.owner instanceof PipPlayer){
                    this.dealDamage(bullet.owner, player, bullet.damage)
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
        for(const player of Object.values(this.players)){
            this.applyMapBounds(player)
        }

        // Resolve powerup pickups against final ship positions this tick.
        this.updatePowerupPickups()

        for(const player of Object.values(this.players)){
            player.trackPositionState()
        }
    }
}