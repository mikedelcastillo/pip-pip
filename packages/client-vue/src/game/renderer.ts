import { radianDifference } from "@pip-pip/core/src/math"
import { PipPipGame } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import { PIP_SHIPS } from "@pip-pip/game/src/logic/ship"
import * as PIXI from "pixi.js"
import { GameContext } from "."
import { assetLoader } from "./assets"
import { client } from "./client"

export class PlayerGraphic {
    id: string
    player: PipPlayer

    container: PIXI.Container = new PIXI.Container()
    
    shipContainer: PIXI.Container = new PIXI.Container()
    shipSprite?: PIXI.Sprite

    constructor(player: PipPlayer){
        this.id = player.id
        this.player = player

        this.container.addChild(this.shipContainer)
    }

    updateShip(){
        if(typeof this.shipSprite !== "undefined"){
            this.shipContainer.removeChild(this.shipSprite)
        }
        const PlayerShip = PIP_SHIPS[this.player.shipIndex]
        const texture = assetLoader.get(PlayerShip.shipTextureId)
        this.shipSprite = new PIXI.Sprite(texture)
        this.shipSprite.anchor.set(0.5)
        this.shipSprite.position.set(0)
        this.shipSprite.rotation = Math.PI / 2
        this.shipSprite.scale.set(2)
        this.shipContainer.addChild(this.shipSprite)
    }
}

export class PipPipRenderer{
    app: PIXI.Application
    game: PipPipGame

    viewportContainer = new PIXI.Container()
    playersContainer = new PIXI.Container()

    players: Record<string, PlayerGraphic> = {}

    container?: HTMLDivElement

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
        this.app = new PIXI.Application({ resizeTo: window })
        this.app.ticker.stop()

        this.app.stage.addChild(this.viewportContainer)
        this.viewportContainer.addChild(this.playersContainer)

        this.game = game

        this.game.events.on("addPlayer", ({ player }) => {
            const graphic = new PlayerGraphic(player)
            this.players[player.id] = graphic
            this.playersContainer.addChild(graphic.container)
        })

        this.game.events.on("playerSetShip", ({ player }) => {
            this.players[player.id]?.updateShip()
        })

        this.game.events.on("removePlayer", ({ player }) => {
            if(player.id in this.players){
                const graphic = this.players[player.id]
                delete this.players[player.id]
                this.playersContainer.removeChild(graphic.container)
            }
        })
    }

    mount(container: HTMLDivElement){
        this.container = container
        this.container.appendChild(this.app.view)
    }

    render(context: GameContext, deltaMs: number, deltaTime: number){
        // camera
        const cameraSmoothing = Math.pow(1 /  20, deltaTime)
        // if(typeof client.connectionId !== "undefined"){
        //     if(client.connectionId in this.players){
        //         const graphic = this.players[client.connectionId]
        //         const tx = graphic.player.ship.physics.position.x + graphic.player.ship.physics.velocity.x * deltaTime
        //         const ty = graphic.player.ship.physics.position.y + graphic.player.ship.physics.velocity.y * deltaTime
        //     }
        // }


        // update players
        const players = Object.values(this.players)
        const playerRotationSmoothing = Math.pow(1 / 3, deltaTime)
        const playerSmoothing = Math.pow(1 / 50, deltaTime)
        const clientPlayerSmoothing = Math.pow(1 / 5, deltaTime)
        for(const graphic of players){
            const isClient = graphic.player.id === client.connectionId
            const smoothing = isClient ? clientPlayerSmoothing : playerSmoothing
            const tx = graphic.player.ship.physics.position.x + graphic.player.ship.physics.velocity.x * deltaTime
            const ty = graphic.player.ship.physics.position.y + graphic.player.ship.physics.velocity.y * deltaTime
            
            graphic.container.position.x += (tx - graphic.container.position.x) * smoothing
            graphic.container.position.y += (ty - graphic.container.position.y) * smoothing
            graphic.container.rotation += radianDifference(graphic.container.rotation, graphic.player.ship.rotation) * playerRotationSmoothing

            if(isClient){
                this.camera.target.x = tx
                this.camera.target.y = ty
            }
        }

        this.camera.position.x += (this.camera.target.x - this.camera.position.x) * cameraSmoothing
        this.camera.position.y += (this.camera.target.y - this.camera.position.y) * cameraSmoothing
        this.viewportContainer.position.x = this.app.view.width / 2 - this.camera.position.x
        this.viewportContainer.position.y = this.app.view.height / 2 - this.camera.position.y

        this.app.render()
    }
}