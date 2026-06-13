import { GameContext, getClientPlayer } from "."

export function processInputs(context: GameContext){
    const { mouse, keyboard, game } = context
    const clientPlayer = getClientPlayer(game)
    if(typeof clientPlayer === "undefined") return

    let xInput = 0, yInput = 0
    
    if(keyboard.state.KeyW) yInput -= 1
    if(keyboard.state.KeyS) yInput += 1
    if(keyboard.state.KeyA) xInput -= 1
    if(keyboard.state.KeyD) xInput += 1
    
    const hasKeyboardInput = xInput !== 0 || yInput !== 0
                
    if(hasKeyboardInput){
        clientPlayer.inputs.movementAngle = Math.atan2(yInput, xInput)
        clientPlayer.inputs.movementAmount = 1
    }
    
    if(!hasKeyboardInput){
        clientPlayer.inputs.movementAmount = 0
    }
    
    // aiming
    const mouseAngle = Math.atan2(
        mouse.state.position.y - window.innerHeight / 2,
        mouse.state.position.x - window.innerWidth / 2,
    )
                
    clientPlayer.inputs.aimRotation = mouseAngle
    
    // shooting
    clientPlayer.inputs.useWeapon = (mouse.state.left.down || keyboard.state.Space) === true
    clientPlayer.inputs.doReload = keyboard.state.KeyR === true
}