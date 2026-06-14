import { describe, expect, it } from "vitest"
import { PipPipGamePhase } from "../../packages/game/src/logic"
import {
    NavRect,
    buttonToDirection,
    isNavActive,
    pickInDirection,
    shouldFireDirection,
    stickToDirection,
    DPAD_UP,
    DPAD_DOWN,
    DPAD_LEFT,
    DPAD_RIGHT,
    NAV_REPEAT_DELAY_MS,
    NAV_REPEAT_INTERVAL_MS,
} from "../../packages/client/src/game/gamepadNav"

// Build an axis-aligned rect from its center + half-size, so the layouts below
// read in terms of where each control sits.
const rectAt = (cx: number, cy: number, half = 10): NavRect => ({
    left: cx - half,
    top: cy - half,
    right: cx + half,
    bottom: cy + half,
})

describe("pickInDirection", () => {
    // A small cross/grid layout:
    //   index 0: center (100,100)
    //   index 1: right  (200,100)
    //   index 2: left   (0,100)
    //   index 3: up     (100,0)
    //   index 4: down   (100,200)
    const grid: NavRect[] = [
        rectAt(100, 100),
        rectAt(200, 100),
        rectAt(0, 100),
        rectAt(100, 0),
        rectAt(100, 200),
    ]

    it("picks the nearest element in the pressed direction", () => {
        expect(pickInDirection(grid, 0, "right")).toBe(1)
        expect(pickInDirection(grid, 0, "left")).toBe(2)
        expect(pickInDirection(grid, 0, "up")).toBe(3)
        expect(pickInDirection(grid, 0, "down")).toBe(4)
    })

    it("ignores elements behind the current one (stays put at an edge)", () => {
        // From the right-most element (index 1) there is nothing further right, so
        // focus stays put rather than wrapping back.
        expect(pickInDirection(grid, 1, "right")).toBe(1)
        // From the top element (index 3) there is nothing further up.
        expect(pickInDirection(grid, 3, "up")).toBe(3)
    })

    it("does not mistake an element off to the side for one in the pressed direction", () => {
        // Two cells: current at origin, the other straight up. Pressing RIGHT must
        // not pick the up cell (it is not to the right), so focus stays put.
        const cells: NavRect[] = [rectAt(100, 100), rectAt(100, 0)]
        expect(pickInDirection(cells, 0, "right")).toBe(0)
        // And pressing UP does reach it.
        expect(pickInDirection(cells, 0, "up")).toBe(1)
    })

    it("prefers the nearer of two candidates in the same direction", () => {
        const cells: NavRect[] = [
            rectAt(0, 0),     // current
            rectAt(50, 0),    // near right
            rectAt(300, 0),   // far right
        ]
        expect(pickInDirection(cells, 0, "right")).toBe(1)
    })

    it("favours the element most directly in the pressed direction over a skewed one", () => {
        // From the current cell, one candidate is squarely to the right; another
        // is to the right but drifted far down. The square one wins.
        const cells: NavRect[] = [
            rectAt(0, 0),      // current
            rectAt(120, 0),    // squarely right
            rectAt(100, 80),   // right but skewed down
        ]
        expect(pickInDirection(cells, 0, "right")).toBe(1)
    })

    it("focuses the first element when nothing is focused yet (current = -1)", () => {
        expect(pickInDirection(grid, -1, "down")).toBe(0)
        expect(pickInDirection(grid, 99, "up")).toBe(0)
    })

    it("returns -1 for an empty list", () => {
        expect(pickInDirection([], 0, "down")).toBe(-1)
    })
})

describe("buttonToDirection", () => {
    it("maps the d-pad buttons to directions", () => {
        expect(buttonToDirection(DPAD_UP)).toBe("up")
        expect(buttonToDirection(DPAD_DOWN)).toBe("down")
        expect(buttonToDirection(DPAD_LEFT)).toBe("left")
        expect(buttonToDirection(DPAD_RIGHT)).toBe("right")
    })

    it("returns null for a non-d-pad button", () => {
        expect(buttonToDirection(0)).toBeNull()
        expect(buttonToDirection(7)).toBeNull()
    })
})

describe("stickToDirection", () => {
    it("is null while the stick rests inside the threshold", () => {
        expect(stickToDirection(0.3, 0.3, 0.6)).toBeNull()
    })

    it("resolves to the dominant axis past the threshold", () => {
        expect(stickToDirection(0.9, 0, 0.6)).toBe("right")
        expect(stickToDirection(-0.9, 0, 0.6)).toBe("left")
        expect(stickToDirection(0, -0.9, 0.6)).toBe("up")
        expect(stickToDirection(0, 0.9, 0.6)).toBe("down")
    })

    it("resolves a diagonal to its dominant axis", () => {
        // Slightly more horizontal than vertical → horizontal wins.
        expect(stickToDirection(0.9, 0.7, 0.6)).toBe("right")
        // More vertical than horizontal → vertical wins.
        expect(stickToDirection(0.7, 0.9, 0.6)).toBe("down")
    })
})

describe("isNavActive (the gate)", () => {
    it("is active whenever a modal is open, even mid-match", () => {
        expect(isNavActive(PipPipGamePhase.MATCH, true, true, false)).toBe(true)
    })

    it("is active whenever the loadout overlay is open, even mid-match", () => {
        // LoadoutOverlay is not a Modal, so the modal flag is false; the loadout
        // flag must still open the gate so a controller can reach Deploy/Spectate.
        expect(isNavActive(PipPipGamePhase.MATCH, false, true, true)).toBe(true)
    })

    it("is active when there is no live game container (home / menus)", () => {
        expect(isNavActive(PipPipGamePhase.SETUP, false, false, false)).toBe(true)
        expect(isNavActive(PipPipGamePhase.MATCH, false, false, false)).toBe(true)
    })

    it("is active in any non-MATCH phase with the container mounted", () => {
        expect(isNavActive(PipPipGamePhase.SETUP, false, true, false)).toBe(true)
        expect(isNavActive(PipPipGamePhase.COUNTDOWN, false, true, false)).toBe(true)
        expect(isNavActive(PipPipGamePhase.RESULTS, false, true, false)).toBe(true)
    })

    it("is INACTIVE during live MATCH gameplay with no modal or loadout (gameplay owns the pad)", () => {
        expect(isNavActive(PipPipGamePhase.MATCH, false, true, false)).toBe(false)
    })
})

describe("shouldFireDirection (edge + auto-repeat)", () => {
    const makeHold = () => ({ held: false, since: 0, lastFire: 0 })

    it("does not fire while the direction is not pressed", () => {
        const hold = makeHold()
        expect(shouldFireDirection(hold, false, 1000)).toBe(false)
    })

    it("fires once on the initial press (edge), then holds quiet until the repeat delay", () => {
        const hold = makeHold()
        // Fresh press at t=0 fires.
        expect(shouldFireDirection(hold, true, 0)).toBe(true)
        // Still held shortly after: no repeat yet (inside the delay).
        expect(shouldFireDirection(hold, true, 100)).toBe(false)
        expect(shouldFireDirection(hold, true, NAV_REPEAT_DELAY_MS - 1)).toBe(false)
    })

    it("auto-repeats on the interval once the delay has elapsed", () => {
        const hold = makeHold()
        shouldFireDirection(hold, true, 0) // initial fire
        // Just past the delay: first repeat fires.
        const firstRepeat = NAV_REPEAT_DELAY_MS + 1
        expect(shouldFireDirection(hold, true, firstRepeat)).toBe(true)
        // Immediately after: no fire (inside the interval).
        expect(shouldFireDirection(hold, true, firstRepeat + 1)).toBe(false)
        // After the interval: another repeat.
        expect(shouldFireDirection(hold, true, firstRepeat + NAV_REPEAT_INTERVAL_MS + 1)).toBe(true)
    })

    it("resets the hold on release so the next press is a fresh edge", () => {
        const hold = makeHold()
        shouldFireDirection(hold, true, 0)
        shouldFireDirection(hold, false, 50) // released
        expect(hold.held).toBe(false)
        // Next press fires immediately again.
        expect(shouldFireDirection(hold, true, 60)).toBe(true)
    })
})
