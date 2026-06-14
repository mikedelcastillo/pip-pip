import { GameContext, getClientPlayer } from "."
import { touchState } from "./touch"
import {
    gamepadState,
    pollGamepad,
    readFirstGamepad,
} from "./gamepad"
import { useUiStore } from "../store/ui"
import { BindingInputState, isActionActive } from "../store/keybindings"

// A scroll past this magnitude (in WheelEvent delta units, accumulated since the
// last tick) counts as a wheel "tick" in that direction. Small enough to catch a
// single notch on a mouse wheel, large enough to ignore stray trackpad jitter.
const WHEEL_THRESHOLD = 1

export function processInputs(context: GameContext){
    const { mouse, keyboard, game } = context
    const clientPlayer = getClientPlayer(game)
    if(typeof clientPlayer === "undefined") return

    // Custom bindings live in the UI store (seeded from localStorage). Read them
    // each tick via getState() so this hot path stays outside React and always
    // reflects the latest remap without a re-render.
    const { keyBindings, gamepadBindings } = useUiStore.getState()

    // Drain the wheel delta ONCE per tick (it is momentary: consuming it here
    // clears the accumulator so a wheel binding triggers on exactly the tick the
    // scroll landed). Then snapshot keyboard + mouse state for binding resolution.
    const wheel = mouse.consumeWheel()
    const inputState: BindingInputState = {
        keys: keyboard.state,
        mouse: {
            left: mouse.state.left.down,
            middle: mouse.state.middle.down,
            right: mouse.state.right.down,
        },
        wheel: {
            up: wheel.y <= -WHEEL_THRESHOLD,
            down: wheel.y >= WHEEL_THRESHOLD,
        },
    }

    // An action is active if ANY of its bindings (key, mouse button, or wheel
    // direction) is active this tick. This is what lets a single action be bound
    // to several inputs at once (e.g. fire on both Space and left-click).
    const actionActive = (action: keyof typeof keyBindings) =>
        isActionActive(keyBindings[action], inputState)

    let xInput = 0, yInput = 0

    if(actionActive("moveUp")) yInput -= 1
    if(actionActive("moveDown")) yInput += 1
    if(actionActive("moveLeft")) xInput -= 1
    if(actionActive("moveRight")) xInput += 1

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

    // shooting: every action is driven entirely by its bindings now. The
    // default bindings reproduce the old behavior (left-click + Space fire,
    // right-click + Q tactical, R reload) without the previously hard-wired mouse
    // lines, so a player can freely rebind the mouse buttons too.
    clientPlayer.inputs.useWeapon = actionActive("fire")
    clientPlayer.inputs.useTactical = actionActive("tactical")
    clientPlayer.inputs.doReload = actionActive("reload")

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
