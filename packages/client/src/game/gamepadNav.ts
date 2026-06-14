// Gamepad-driven UI navigation. Lets a player drive the whole menu/modal UI
// (home menu, lobby, every modal, ship/map cards, loadout, pause menu) with a
// controller, no mouse required. This is purely additive UI focus: it never
// touches the in-match gameplay controls.
//
// SPLIT, like ./gamepad and ./touch:
//   - The spatial-pick math (pickInDirection) is pure and DOM-free, so it is
//     unit-testable in isolation (see tests/client/gamepad-nav.test.ts).
//   - The service (createGamepadNav) reads navigator.getGamepads() on an
//     animation-frame loop, edge-detects inputs, gates on whether UI nav is
//     appropriate, and drives document focus + .click() / Escape.
//
// IMPORTANT - gameplay must stay untouched. processInputs (game/ui.ts) reads the
// same pad each tick for movement/aim/fire DURING a live match. To avoid fighting
// it, this service only acts when UI navigation is appropriate (see isNavActive):
// a modal is open, OR there is no live in-play game container, OR the phase is not
// MATCH. During live MATCH gameplay with no modal open it returns early every
// frame and the gameplay controls own the stick/buttons.

import { PipPipGamePhase } from "@pip-pip/game/src/logic"

// A minimal structural view of the Gamepad API objects we read. Declaring our
// own (mirroring ./gamepad) keeps this importable under node/vitest and
// documents exactly which fields we touch.
export type NavButtonLike = { pressed: boolean }
export type NavGamepadLike = {
    axes: readonly number[]
    buttons: readonly NavButtonLike[]
}

// The four navigation directions a press resolves to.
export type NavDirection = "up" | "down" | "left" | "right"

// Standard-mapping button indices we care about for UI nav.
export const BUTTON_A = 0 // activate the focused control
export const BUTTON_B = 1 // back out (close a modal)
export const DPAD_UP = 12
export const DPAD_DOWN = 13
export const DPAD_LEFT = 14
export const DPAD_RIGHT = 15

// Left-stick axes (standard mapping), reused for directional nav alongside the
// d-pad so either input walks focus.
export const NAV_AXIS_X = 0
export const NAV_AXIS_Y = 1

// Past this stick deflection the stick counts as pushed in a direction. Higher
// than the gameplay move deadzone so a resting stick never drifts focus.
export const NAV_STICK_THRESHOLD = 0.6

// A plain axis-aligned rectangle, the only geometry pickInDirection needs. Built
// from a DOMRect (left/top/right/bottom) by the service; kept structural so the
// math stays DOM-free and testable.
export type NavRect = {
    left: number
    top: number
    right: number
    bottom: number
}

const centerX = (r: NavRect): number => (r.left + r.right) / 2
const centerY = (r: NavRect): number => (r.top + r.bottom) / 2

// Pure spatial focus pick. Given the bounding rects of every focusable element,
// the index currently focused, and the pressed direction, return the index of
// the BEST element to move focus to - the nearest one that genuinely lies in the
// pressed direction. Returns the current index unchanged when there is no
// sensible candidate (e.g. already at the edge in that direction), so focus
// stays put rather than wrapping or jumping somewhere surprising.
//
// Algorithm (compare bounding-box centers):
//   - For each OTHER rect, take the displacement from the current center.
//   - Keep only rects that lie in the pressed direction: the dominant component
//     of the displacement must point that way (e.g. for "right", dx > 0 and the
//     horizontal travel must exceed the vertical, so an element merely above/
//     below is not mistaken for one to the right). This naturally ignores
//     elements "behind" the current one.
//   - Among the survivors, pick the smallest weighted distance, charging the
//     off-axis component more so the pick favours the element most directly in
//     the pressed direction.
// When `current` is out of range (e.g. nothing focused yet, -1), fall back to the
// first rect so the very first press lands focus somewhere.
export function pickInDirection(
    rects: NavRect[],
    current: number,
    direction: NavDirection,
): number {
    if (rects.length === 0) return -1
    if (current < 0 || current >= rects.length) return 0

    const from = rects[current]
    const fromX = centerX(from)
    const fromY = centerY(from)

    // Charge the off-axis distance more heavily so the pick prefers an element
    // squarely in the pressed direction over one far off to the side.
    const OFF_AXIS_WEIGHT = 2

    let best = current
    let bestScore = Infinity

    for (let i = 0; i < rects.length; i++) {
        if (i === current) continue
        const r = rects[i]
        const dx = centerX(r) - fromX
        const dy = centerY(r) - fromY

        // On-axis = travel along the pressed direction (must be positive);
        // off-axis = perpendicular drift. The on-axis travel must also dominate
        // so an element mostly sideways is not picked for a vertical press.
        let onAxis: number
        let offAxis: number
        if (direction === "left") {
            onAxis = -dx
            offAxis = Math.abs(dy)
        } else if (direction === "right") {
            onAxis = dx
            offAxis = Math.abs(dy)
        } else if (direction === "up") {
            onAxis = -dy
            offAxis = Math.abs(dx)
        } else {
            onAxis = dy
            offAxis = Math.abs(dx)
        }

        // Behind us, or more sideways than forward: not a candidate for this
        // direction.
        if (onAxis <= 0) continue
        if (offAxis > onAxis) continue

        const score = onAxis + offAxis * OFF_AXIS_WEIGHT
        if (score < bestScore) {
            bestScore = score
            best = i
        }
    }

    return best
}

// Map a pressed button index to a nav direction, or null if it is not a d-pad
// direction. Pure + testable.
export function buttonToDirection(index: number): NavDirection | null {
    if (index === DPAD_UP) return "up"
    if (index === DPAD_DOWN) return "down"
    if (index === DPAD_LEFT) return "left"
    if (index === DPAD_RIGHT) return "right"
    return null
}

// Map a left-stick deflection (x, y in -1..1) to a single nav direction, or null
// when the stick rests inside the threshold. The dominant axis wins so a roughly
// diagonal push resolves to one clean direction. Pure + testable.
export function stickToDirection(x: number, y: number, threshold: number): NavDirection | null {
    const ax = Math.abs(x)
    const ay = Math.abs(y)
    if (ax < threshold && ay < threshold) return null
    if (ax >= ay) return x > 0 ? "right" : "left"
    return y > 0 ? "down" : "up"
}

// The DOM-facing dependencies the service needs, injected so the loop itself
// stays thin and the wiring is explicit. Defaults (createGamepadNav) bind these
// to the real browser; tests could supply fakes.
export type GamepadNavDeps = {
    readPad: () => NavGamepadLike | null
    getPhase: () => PipPipGamePhase
}

// Selector for the open-modal backdrop. Modal.module.sass hashes the class, but
// every backdrop also carries the stable global "center-container" class AND is
// the direct child structure of a fixed full-screen overlay; we detect the modal
// by its hashed backdrop class prefix, which Vite emits as "_backdrop_<hash>".
// Matching on the attribute prefix keeps us decoupled from the exact hash.
const MODAL_BACKDROP_SELECTOR = "[class*=\"backdrop\"]"

// The focusable-element selector. Mirrors the usual roving-focus set: enabled
// buttons, anything explicitly tabbable, inputs, and role=button surfaces (the
// ship/map cards). [tabindex="-1"] is excluded so programmatically-focusable-but-
// not-tabbable nodes are skipped.
const FOCUSABLE_SELECTOR = [
    "button:not([disabled])",
    "[tabindex]:not([tabindex=\"-1\"])",
    "input:not([disabled])",
    "[role=\"button\"]",
].join(", ")

// Is the element actually visible and on-screen? Filters out display:none /
// zero-size / off-screen nodes so focus never lands on something the player
// cannot see. Uses getBoundingClientRect (zero area => hidden) plus an
// offsetParent check for display:none ancestors.
function isVisible(el: HTMLElement): boolean {
    if (el.offsetParent === null && el.style.position !== "fixed") return false
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    if (rect.bottom < 0 || rect.right < 0) return false
    if (rect.left > window.innerWidth || rect.top > window.innerHeight) return false
    return true
}

// Whether a modal is currently open (its backdrop is in the DOM). When a modal is
// open, UI nav is always appropriate even mid-match - the modal sits over the
// game and the player is interacting with it, not flying.
function isModalOpen(): boolean {
    return document.querySelector(MODAL_BACKDROP_SELECTOR) !== null
}

// Is there a live, in-play game container? GameView mounts "#game-container" for
// the duration of a lobby/match. Its presence alone does not mean live play (the
// lobby/results phases also mount it), so this is only one input to the gate.
function hasGameContainer(): boolean {
    return document.getElementById("game-container") !== null
}

// THE GATE. UI navigation should drive focus only when it will not fight the
// in-match gameplay controls. It is appropriate when ANY of:
//   - a modal is open (the player is interacting with an overlay), OR
//   - there is no live game container (home screen / menus outside a match), OR
//   - the current phase is not MATCH (SETUP lobby, COUNTDOWN, RESULTS).
// It is therefore INACTIVE in exactly one situation: a live MATCH with the game
// container mounted and no modal open - i.e. real gameplay, where processInputs
// owns the stick and buttons. Pure given its inputs, so it is unit-testable.
export function isNavActive(
    phase: PipPipGamePhase,
    modalOpen: boolean,
    gameContainerPresent: boolean,
): boolean {
    if (modalOpen) return true
    if (!gameContainerPresent) return true
    return phase !== PipPipGamePhase.MATCH
}

// How long (ms) to hold a direction before it auto-repeats, and the interval
// between repeats while held. Tuned so a tap moves exactly one cell and a hold
// scrolls at a comfortable, non-frantic pace.
export const NAV_REPEAT_DELAY_MS = 400
export const NAV_REPEAT_INTERVAL_MS = 120

// Per-direction hold bookkeeping for the auto-repeat. `since` is the timestamp
// the direction first went down; `lastFire` is when it last produced a move.
type DirectionHold = {
    held: boolean
    since: number
    lastFire: number
}

function createHold(): DirectionHold {
    return { held: false, since: 0, lastFire: 0 }
}

// Should a held direction fire a move THIS frame? Fires immediately on the
// initial press (edge), then nothing until NAV_REPEAT_DELAY_MS has passed, then
// every NAV_REPEAT_INTERVAL_MS. Pure given the hold + now, so it is testable.
export function shouldFireDirection(
    hold: DirectionHold,
    pressed: boolean,
    now: number,
): boolean {
    if (!pressed) {
        hold.held = false
        return false
    }
    if (!hold.held) {
        // Fresh press: fire once, start the hold clock.
        hold.held = true
        hold.since = now
        hold.lastFire = now
        return true
    }
    // Held: wait out the delay, then repeat on the interval.
    if (now - hold.since < NAV_REPEAT_DELAY_MS) return false
    if (now - hold.lastFire < NAV_REPEAT_INTERVAL_MS) return false
    hold.lastFire = now
    return true
}

// The class the service can also stamp on the focused element so the focus ring
// shows even where :focus-visible heuristics are stingy. Cleared off the previous
// target each move. global.sass styles this.
export const NAV_FOCUS_CLASS = "gamepad-nav-focus"

export type GamepadNav = {
    start: () => void
    stop: () => void
}

// Build the navigation service. Guards typeof window/navigator so importing or
// constructing it under SSR/node is harmless; start() simply no-ops there.
export function createGamepadNav(deps?: Partial<GamepadNavDeps>): GamepadNav {
    const readPad: () => NavGamepadLike | null = deps?.readPad ?? readNavGamepad
    const getPhase: () => PipPipGamePhase = deps?.getPhase ?? (() => PipPipGamePhase.SETUP)

    let rafId = 0
    let running = false

    // Edge state for the action buttons (act once per press, not every frame).
    let aDown = false
    let bDown = false

    // Hold state per direction for d-pad + stick auto-repeat.
    const holds: Record<NavDirection, DirectionHold> = {
        up: createHold(),
        down: createHold(),
        left: createHold(),
        right: createHold(),
    }

    // The element this service last moved focus to, so we can clear the helper
    // class off it on the next move.
    let lastFocused: HTMLElement | null = null

    const clearFocusClass = () => {
        if (lastFocused !== null) {
            lastFocused.classList.remove(NAV_FOCUS_CLASS)
        }
    }

    // Collect the currently visible, focusable elements in DOM order. DOM order is
    // a stable, sensible default for "the first" element and for the focus index.
    const collectFocusable = (): HTMLElement[] => {
        const nodes = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        return nodes.filter(isVisible)
    }

    const moveFocus = (direction: NavDirection) => {
        const elements = collectFocusable()
        if (elements.length === 0) return

        const active = document.activeElement as HTMLElement | null
        const current = active === null ? -1 : elements.indexOf(active)

        const rects: NavRect[] = elements.map((el) => {
            const r = el.getBoundingClientRect()
            return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
        })

        const next = pickInDirection(rects, current, direction)
        if (next < 0) return

        const target = elements[next]
        if (target === active && current >= 0) return

        clearFocusClass()
        target.focus()
        target.classList.add(NAV_FOCUS_CLASS)
        lastFocused = target
    }

    // Activate the focused control (A / cross). .click() works for real <button>
    // elements AND the role=button cards (they carry an onClick). If nothing is
    // focused, focus the first focusable element so the next press activates it.
    const activate = () => {
        const active = document.activeElement as HTMLElement | null
        if (active !== null && typeof active.click === "function" && active !== document.body) {
            active.click()
            return
        }
        const elements = collectFocusable()
        if (elements.length === 0) return
        clearFocusClass()
        elements[0].focus()
        elements[0].classList.add(NAV_FOCUS_CLASS)
        lastFocused = elements[0]
    }

    // Back out (B / circle). Dispatch a keyup Escape on document.body so any open
    // Modal closes through its existing Escape handler (Modal.tsx listens for a
    // keyup with code "Escape" on document.body). No-op when no modal is open.
    const back = () => {
        const event = new KeyboardEvent("keyup", { code: "Escape", bubbles: true })
        document.body.dispatchEvent(event)
    }

    const frame = () => {
        if (!running) return
        rafId = window.requestAnimationFrame(frame)

        const pad = readPad()
        if (pad === null) {
            // No controller: reset edge/hold state so a future connect starts
            // clean, and skip the rest.
            resetInputState()
            return
        }

        // GATE: only drive UI focus when navigation is appropriate. Otherwise the
        // in-match gameplay controls own the pad, so return early without reading
        // any nav intent.
        if (!isNavActive(getPhase(), isModalOpen(), hasGameContainer())) {
            resetInputState()
            return
        }

        const now = performance.now()

        // Directional moves: d-pad OR left stick, whichever points somewhere.
        // Either source pressing a direction counts that direction as "down".
        const stickDir = stickToDirection(
            pad.axes[NAV_AXIS_X] ?? 0,
            pad.axes[NAV_AXIS_Y] ?? 0,
            NAV_STICK_THRESHOLD,
        )
        const directions: NavDirection[] = ["up", "down", "left", "right"]
        for (const dir of directions) {
            const dpadPressed = isPadButton(pad, dpadIndex(dir))
            const pressed = dpadPressed || stickDir === dir
            if (shouldFireDirection(holds[dir], pressed, now)) {
                moveFocus(dir)
            }
        }

        // Activate (A) - edge-triggered.
        const aPressed = isPadButton(pad, BUTTON_A)
        if (aPressed && !aDown) activate()
        aDown = aPressed

        // Back (B) - edge-triggered.
        const bPressed = isPadButton(pad, BUTTON_B)
        if (bPressed && !bDown) back()
        bDown = bPressed
    }

    const resetInputState = () => {
        aDown = false
        bDown = false
        for (const dir of ["up", "down", "left", "right"] as NavDirection[]) {
            holds[dir].held = false
        }
    }

    return {
        start: () => {
            if (running) return
            if (typeof window === "undefined" || typeof navigator === "undefined") return
            running = true
            rafId = window.requestAnimationFrame(frame)
        },
        stop: () => {
            running = false
            if (typeof window !== "undefined" && rafId !== 0) {
                window.cancelAnimationFrame(rafId)
            }
            rafId = 0
            clearFocusClass()
            resetInputState()
        },
    }
}

// Map a direction to its d-pad button index.
function dpadIndex(direction: NavDirection): number {
    if (direction === "up") return DPAD_UP
    if (direction === "down") return DPAD_DOWN
    if (direction === "left") return DPAD_LEFT
    return DPAD_RIGHT
}

// Whether a pad button at `index` is pressed, guarding out-of-range indices
// (controllers vary).
function isPadButton(pad: NavGamepadLike, index: number): boolean {
    if (index < 0) return false
    const button = pad.buttons[index]
    return button !== undefined && button.pressed === true
}

// Read the first connected pad from navigator.getGamepads(), or null under
// SSR/node or with no controller. Mirrors readFirstGamepad in ./gamepad but with
// our local structural type so this file stays self-contained.
function readNavGamepad(): NavGamepadLike | null {
    if (typeof navigator === "undefined") return null
    const nav = navigator as Navigator & {
        getGamepads?: () => (NavGamepadLike | null)[]
    }
    if (typeof nav.getGamepads !== "function") return null
    let pads: (NavGamepadLike | null)[]
    try {
        pads = nav.getGamepads()
    } catch {
        return null
    }
    for (const pad of pads) {
        if (pad !== null && pad !== undefined) return pad
    }
    return null
}
