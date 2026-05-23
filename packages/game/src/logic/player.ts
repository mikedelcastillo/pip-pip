import { radianDifference } from "@pip-pip/core/src/math"
import { PointPhysicsObject, Vector2 } from "@pip-pip/core/src/physics"
import { PipPipGame } from "."
import { PIP_SHIPS, ShipType } from "../ships"

import { PipShip } from "./ship"
import { tickDown } from "./utils"

export type PlayerInputs = {
    movementAngle: number,
    movementAmount: number,

    aimRotation: number,

    useWeapon: boolean,
    useTactical: boolean,
    doReload: boolean,

    spawn: boolean,
}

export type PlayerTimings = {
    spawnTimeout: number,
}

export type PlayerTickState = {
    positionX: number,
    positionY: number,
    velocityX: number,
    velocityY: number,
    rotation: number,
}

export type PlayerScores = {
    kills: number,
    assists: number,
    deaths: number,
    damage: number,
}

export const MAX_PLAYER_POSITION_STATES = 8

export class PipPlayer{
    id: string
    
    ship!: PipShip
    shipIndex!: number
    shipType!: ShipType

    game: PipPipGame
    spectating?: PipPlayer | PipShip | PointPhysicsObject | Vector2

    name = "Pilot" + Math.floor(Math.random() * 1000)
    idle = false
    ping = 0

    team = 0

    score: PlayerScores = {
        kills: 0,
        assists: 0,
        deaths: 0,
        damage: 0,
    }

    inputs: PlayerInputs = {
        movementAngle: 0,
        movementAmount: 0,

        aimRotation: 0,

        useWeapon: false,
        useTactical: false,
        doReload: false,

        spawn: false,
    }

    timings: PlayerTimings = {
        spawnTimeout: 0,
    }

    spectator = false
    spawned = false

    positionStates: PlayerTickState[] = []

    constructor(game: PipPipGame, id: string){
        this.game = game
        this.id = id

        if(id in this.game.players) throw new Error("Player already in game.")
        this.game.players[id] = this
        this.game.events.emit("addPlayer", { player: this })
        this.game.setHostIfNeeded()
        this.setShip()
    }

    get canSpawn(){
        if(this.spectator === true) return false
        if(this.spawned === true) return false
        if(this.timings.spawnTimeout > 0) return false
        return true
    }

    setName(name: string){
        this.name = name
        this.game.events.emit("playerDetailsChange", { player: this })
    }

    remove(){
        if(!(this.id in this.game.players)) return
        this.setSpawned(false)
        delete this.game.players[this.id]
        this.game.events.emit("removePlayer", { player: this })
        this.game.setHostIfNeeded()
    }
    
    setKills(n: number){
        this.score.kills = n
        this.game.events.emit("playerScoreChanged", { player: this })
    }
    
    setAssists(n: number){
        this.score.assists = n
        this.game.events.emit("playerScoreChanged", { player: this })
    }
    
    setDeaths(n: number){
        this.score.deaths = n
        this.game.events.emit("playerScoreChanged", { player: this })
    }
    
    setDamage(n: number){
        this.score.damage = n
        this.game.events.emit("playerScoreChanged", { player: this })
    }

    resetScores(){
        this.setKills(0)
        this.setAssists(0)
        this.setDeaths(0)
        this.setDamage(0)
    }

    setIdle(idle: boolean){
        this.idle = idle
        this.game.events.emit("playerIdleChange", { player: this })
    }

    setSpawned(state: boolean){
        if(typeof this.ship !== "undefined"){
            if(state === true){
                this.game.physics.addObject(this.ship.physics)
            } else{
                this.game.physics.removeObject(this.ship.physics)
            }
        }
        this.spawned = state
        this.game.events.emit("playerSpawned", { player: this })
    }

    setShip(index?: number){
        if(typeof index === "number"){
            index = Math.max(0, Math.min(index, PIP_SHIPS.length - 1))
        } else{
            index = Math.floor(Math.random() * PIP_SHIPS.length)
        }
        if(this.shipIndex === index) return
        
        const shipType = PIP_SHIPS[index]

        const ship = new shipType.Ship(this.game, this.id)
        ship.setPlayer(this)

        if(typeof this.ship !== "undefined"){
            ship.physics.position.x = this.ship.physics.position.x
            ship.physics.position.y = this.ship.physics.position.y
            ship.physics.velocity.x = this.ship.physics.velocity.x
            ship.physics.velocity.y = this.ship.physics.velocity.y
            this.game.physics.removeObject(this.ship.physics)
        }

        if(this.spawned === true){
            this.game.physics.addObject(ship.physics)
        }

        this.ship = ship
        this.shipIndex = index
        this.shipType = shipType

        this.game.events.emit("playerSetShip", {
            player: this,
            ship,
        })
    }

    getTickState(): PlayerTickState{
        return {
            positionX: this.ship.physics.position.x,
            positionY: this.ship.physics.position.y,
            velocityX: this.ship.physics.velocity.x,
            velocityY: this.ship.physics.velocity.y,
            rotation: this.ship.rotation,
        }
    }

    trackPositionState(){
        const state = this.getTickState()

        if(this.positionStates.length >= MAX_PLAYER_POSITION_STATES){
            this.positionStates.pop()
        }
        this.positionStates.unshift(state)
    }

    getLastTickState(index: number){
        if(this.positionStates.length === 0){
            return this.getTickState()
        }
        index = Math.max(0, Math.min(index, this.positionStates.length - 1))
        const fromIndex = Math.floor(index)
        const toIndex = Math.ceil(index)
        const from = this.positionStates[fromIndex]
        const to = this.positionStates[toIndex]
        if(fromIndex === toIndex) return this.positionStates[fromIndex]
        const dist = index - fromIndex
        return {
            positionX: from.positionX + (to.positionX - from.positionX) * dist,
            positionY: from.positionY + (to.positionY - from.positionY) * dist,
            velocityX: from.velocityX + (to.velocityX - from.velocityX) * dist,
            velocityY: from.velocityY + (to.velocityY - from.velocityY) * dist,
            rotation: from.rotation + radianDifference(from.rotation, to.rotation) * dist,
        }
    }

    update(){
        this.timings.spawnTimeout = tickDown(this.timings.spawnTimeout, 1)

        if(typeof this.ship !== "undefined"){
            this.ship.update()
        }
    }
}