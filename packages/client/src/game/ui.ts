import { GameContext, getClientPlayer } from "."
import { touchState } from "./touch"

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
    // secondary / tactical cannon: right mouse button or left shift
    clientPlayer.inputs.useTactical = (mouse.state.right.down || keyboard.state.ShiftLeft) === true
    clientPlayer.inputs.doReload = keyboard.state.KeyR === true

    // Mobile twin-stick overlay. The TouchControls component mutates `touchState`
    // on each pointer event; here we fold it into the same inputs object that the
    // keyboard/mouse just wrote. Touch only overrides the fields it is actually
    // driving, so a phone player using just the left stick still benefits from the
    // aim default, and so the desktop path above is untouched when no finger is
    // down (touchState.active stays false on a mouse-only session).
    if(touchState.active){
        // Movement: the left stick wins while deflected; otherwise fall back to
        // whatever the keyboard produced this tick (likely nothing on mobile).
        if(touchState.moveActive){
            clientPlayer.inputs.movementAngle = touchState.movementAngle
            clientPlayer.inputs.movementAmount = touchState.movementAmount
        }

        // Aim + fire: the right stick steers the crosshair and, while deflected,
        // also fires — classic twin-stick, reachable one-thumbed.
        if(touchState.aimActive){
            clientPlayer.inputs.aimRotation = touchState.aimRotation
        }

        // OR-in the touch action intents so a fire/tactical/reload tap is never
        // clobbered by an idle keyboard/mouse on a touch device.
        clientPlayer.inputs.useWeapon = clientPlayer.inputs.useWeapon || touchState.useWeapon
        clientPlayer.inputs.useTactical = clientPlayer.inputs.useTactical || touchState.useTactical
        clientPlayer.inputs.doReload = clientPlayer.inputs.doReload || touchState.doReload
    }

    // Tag this tick's input with a fresh, monotonically increasing sequence so
    // the server can acknowledge how far it has consumed our stream and the
    // local sim can reconcile its prediction (see PipPlayer.reconcileTo). Bumped
    // once per tick here, BEFORE game.update() predicts and sendPackets records +
    // transmits the frame. (Previously inputSeq never moved, so every input was
    // sent as seq 0 and the server's dedupe dropped repeats.)
    clientPlayer.advanceInputSeq()
}
