import { GameContext, getClientPlayer } from "."
import { touchState } from "./touch"
import {
    gamepadState,
    pollGamepad,
    readFirstGamepad,
} from "./gamepad"
import { useUiStore } from "../store/ui"

export function processInputs(context: GameContext){
    const { mouse, keyboard, game } = context
    const clientPlayer = getClientPlayer(game)
    if(typeof clientPlayer === "undefined") return

    // Custom bindings live in the UI store (seeded from localStorage). Read them
    // each tick via getState() so this hot path stays outside React and always
    // reflects the latest remap without a re-render. `keyDown` resolves an action
    // to whether its bound key code is currently held in the keyboard listener.
    const { keyBindings, gamepadBindings } = useUiStore.getState()
    const keyDown = (action: keyof typeof keyBindings) =>
        keyboard.state[keyBindings[action]] === true

    let xInput = 0, yInput = 0

    if(keyDown("moveUp")) yInput -= 1
    if(keyDown("moveDown")) yInput += 1
    if(keyDown("moveLeft")) xInput -= 1
    if(keyDown("moveRight")) xInput += 1

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

    // shooting — the bound keys drive each action; the mouse buttons keep their
    // fixed roles (left = fire, right = tactical) since aim stays on the mouse.
    clientPlayer.inputs.useWeapon = (mouse.state.left.down || keyDown("fire")) === true
    clientPlayer.inputs.useTactical = (mouse.state.right.down || keyDown("tactical")) === true
    clientPlayer.inputs.doReload = keyDown("reload")

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

    // Gamepad (controller) overlay. Same OR-in philosophy as touch: poll the
    // first connected pad each tick and merge its intents without clobbering
    // keyboard/mouse. readFirstGamepad returns null under SSR/node or when no
    // controller is connected, in which case pollGamepad resets the state to
    // inactive and nothing below fires.
    pollGamepad(gamepadState, readFirstGamepad(), {
        fire: gamepadBindings.fire,
        tactical: gamepadBindings.tactical,
        reload: gamepadBindings.reload,
    })

    if(gamepadState.active){
        // Movement: the left stick wins while deflected, mirroring touch.
        if(gamepadState.moveActive){
            clientPlayer.inputs.movementAngle = gamepadState.movementAngle
            clientPlayer.inputs.movementAmount = gamepadState.movementAmount
        }

        // Aim: the right stick steers the crosshair while deflected.
        if(gamepadState.aimActive){
            clientPlayer.inputs.aimRotation = gamepadState.aimRotation
        }

        // OR-in the action buttons so a held trigger/bumper fires even with an
        // idle keyboard/mouse.
        clientPlayer.inputs.useWeapon = clientPlayer.inputs.useWeapon || gamepadState.useWeapon
        clientPlayer.inputs.useTactical = clientPlayer.inputs.useTactical || gamepadState.useTactical
        clientPlayer.inputs.doReload = clientPlayer.inputs.doReload || gamepadState.doReload
    }

    // Tag this tick's input with a fresh, monotonically increasing sequence so
    // the server can acknowledge how far it has consumed our stream and the
    // local sim can reconcile its prediction (see PipPlayer.reconcileTo). Bumped
    // once per tick here, BEFORE game.update() predicts and sendPackets records +
    // transmits the frame. (Previously inputSeq never moved, so every input was
    // sent as seq 0 and the server's dedupe dropped repeats.)
    clientPlayer.advanceInputSeq()
}
