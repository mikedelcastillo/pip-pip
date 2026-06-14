import { GameContext, getClientPlayer } from "."
import { touchState } from "./touch"
import {
    gamepadState,
    pollGamepad,
    readFirstGamepad,
} from "./gamepad"
import { useUiStore } from "../store/ui"
import { BindingInputState, isActionActive } from "../store/keybindings"
import { createAimState, resolveAimRotation } from "./aim"

// A scroll past this magnitude (in WheelEvent delta units, accumulated since the
// last tick) counts as a wheel "tick" in that direction. Small enough to catch a
// single notch on a mouse wheel, large enough to ignore stray trackpad jitter.
const WHEEL_THRESHOLD = 1

// The local client's aim latch, held across ticks so releasing a touch/gamepad
// stick keeps the last aimed direction. Module-level like touchState/gamepadState:
// there is a single local client.
const aimState = createAimState()

// How fast the free-roam spectator camera pans, in world units per update tick,
// at full stick/key deflection. Tuned to feel brisk without overshooting the map.
const SPECTATE_PAN_SPEED = 18

// Edge-detect the spectate cycle actions so each press cycles the target exactly
// once (a held key does not rapid-cycle). Module-level: a single local client.
const spectateCycleState = {
    prevNext: false,
    prevPrev: false,
}

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

    // SPECTATOR controls. A spectator has no ship, so their inputs never drive a
    // ship; instead the same keys steer the camera. Space / Right cycle to the
    // next watched player, Left to the previous (edge-detected so a held key does
    // not rapid-cycle); WASD frees the camera into free-roam and pans it. This
    // runs ONLY while the local player is a spectator, so normal play below is
    // completely untouched. We return early afterwards: a spectator has no weapon,
    // aim, or input stream to advance.
    if(clientPlayer.spectator === true){
        // Poll the pad up front so its left stick (free-roam) and cycle buttons
        // are read this tick - the normal poll lives on the live-player path we
        // skip below. Read the raw pad once and reuse it for both the poll and the
        // cycle-button check.
        const pad = readFirstGamepad()
        pollGamepad(gamepadState, pad, {
            fire: gamepadBindings.fire,
            tactical: gamepadBindings.tactical,
            reload: gamepadBindings.reload,
        })

        // Cycle the spectate target on a press of either bound key OR the bound
        // pad button. Edge-detected (held does not rapid-cycle) and direction-keyed:
        // spectateNext (Space / Right / RB) goes forward, spectatePrev (Left / LB)
        // back. Cycling also exits free-roam (see cycleSpectateTarget).
        const padDown = (index: number) =>
            pad !== null && index >= 0 && index < pad.buttons.length && pad.buttons[index].pressed === true
        const next = actionActive("spectateNext") || padDown(gamepadBindings.spectateNext)
        const prev = actionActive("spectatePrev") || padDown(gamepadBindings.spectatePrev)
        if(next && spectateCycleState.prevNext === false) context.cycleSpectateTarget(1)
        if(prev && spectateCycleState.prevPrev === false) context.cycleSpectateTarget(-1)
        spectateCycleState.prevNext = next
        spectateCycleState.prevPrev = prev

        // WASD (or a left-stick deflection) detaches the camera into free-roam and
        // pans it. The renderer seeds beginSpectateFreeRoam with the live camera
        // position, so the pan starts exactly where the view already is. A pad's
        // left stick contributes the same way so a controller can free-roam too.
        let panX = xInput, panY = yInput
        if(gamepadState.active && gamepadState.moveActive){
            panX += Math.cos(gamepadState.movementAngle) * gamepadState.movementAmount
            panY += Math.sin(gamepadState.movementAngle) * gamepadState.movementAmount
        }
        if(touchState.active && touchState.moveActive){
            panX += Math.cos(touchState.movementAngle) * touchState.movementAmount
            panY += Math.sin(touchState.movementAngle) * touchState.movementAmount
        }
        const panMag = Math.hypot(panX, panY)
        if(panMag > 0.001){
            // Seed free-roam from the renderer's current camera so the detach is
            // seamless, then pan. Clamp deflection so a diagonal is not faster.
            const cam = context.renderer.camera.position
            context.beginSpectateFreeRoam(cam.x, cam.y)
            const scale = SPECTATE_PAN_SPEED / Math.max(1, panMag)
            context.panSpectateCamera(panX * scale, panY * scale)
        }

        // A spectator never feeds a ship: clear any leftover movement intent and
        // skip the weapon/aim/inputSeq machinery below.
        clientPlayer.inputs.movementAmount = 0
        return
    }

    if(hasKeyboardInput){
        clientPlayer.inputs.movementAngle = Math.atan2(yInput, xInput)
        clientPlayer.inputs.movementAmount = 1
    }

    if(!hasKeyboardInput){
        clientPlayer.inputs.movementAmount = 0
    }

    // aiming. Detect whether the mouse actually moved since last tick and derive
    // its angle, but DO NOT write aim yet: a touch/gamepad stick may own it, and
    // on stick release we hold the latch rather than snapping back to the mouse.
    // Aim is resolved once below, after the pad has been polled.
    const mouseX = mouse.state.position.x
    const mouseY = mouse.state.position.y
    const mouseMoved = mouseX !== aimState.lastMouseX || mouseY !== aimState.lastMouseY
    aimState.lastMouseX = mouseX
    aimState.lastMouseY = mouseY
    const mouseAngle = Math.atan2(mouseY - window.innerHeight / 2, mouseX - window.innerWidth / 2)

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

        // Aim is resolved centrally below (so a released stick holds its angle);
        // the right stick's contribution is folded in there.

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

        // Aim is resolved centrally below (so a released stick holds its angle).

        // OR-in the action buttons so a held trigger/bumper fires even with an
        // idle keyboard/mouse.
        clientPlayer.inputs.useWeapon = clientPlayer.inputs.useWeapon || gamepadState.useWeapon
        clientPlayer.inputs.useTactical = clientPlayer.inputs.useTactical || gamepadState.useTactical
        clientPlayer.inputs.doReload = clientPlayer.inputs.doReload || gamepadState.doReload
    }

    // Resolve aim once, after both sticks have been read this tick. An actively
    // deflected stick wins (gamepad over touch, matching the old override order);
    // otherwise the mouse only re-takes aim when it moved; otherwise the latched
    // angle holds, so letting go of a stick keeps the last aimed direction.
    const stickAim =
        gamepadState.active && gamepadState.aimActive ? gamepadState.aimRotation
            : touchState.active && touchState.aimActive ? touchState.aimRotation
                : null
    aimState.rotation = resolveAimRotation(aimState.rotation, mouseMoved, mouseAngle, stickAim)
    clientPlayer.inputs.aimRotation = aimState.rotation

    // Tag this tick's input with a fresh, monotonically increasing sequence so
    // the server can acknowledge how far it has consumed our stream and the
    // local sim can reconcile its prediction (see PipPlayer.reconcileTo). Bumped
    // once per tick here, BEFORE game.update() predicts and sendPackets records +
    // transmits the frame. (Previously inputSeq never moved, so every input was
    // sent as seq 0 and the server's dedupe dropped repeats.)
    clientPlayer.advanceInputSeq()
}
