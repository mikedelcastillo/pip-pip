// Pure decision helper for the app-wide UI click sound. Kept free of Web Audio
// and React so it is trivially unit-testable in the plain-node vitest env: it
// only walks up the DOM from an event target and answers a yes/no.
//
// The rule: play a click when the user pressed something that is, or sits
// inside, a real <button> or an [role=button], UNLESS that element is the game
// canvas (#game-container) or one of the floating touch sticks. Disabled
// buttons stay silent so the cue never lies about an inert control.

// The minimal slice of an Element we actually read. Declared structurally (not
// as the DOM lib's HTMLElement) so tests can hand us plain mock objects without
// constructing a real DOM - the suite runs under node, where Element is absent.
export interface ClickableLike {
    tagName: string
    getAttribute(name: string): string | null
    closest(selector: string): ClickableLike | null
    // `disabled` only exists on form controls; optional here so plain elements
    // (a <span> inside a button, say) still satisfy the shape.
    disabled?: boolean
    parentElement: ClickableLike | null
}

// Selectors that mark an element as "a clickable control" for the purposes of
// the click sound. A real button or anything the author opted in via ARIA.
const BUTTON_SELECTOR = "button, [role=\"button\"]"

// Selectors whose subtree must never play the click sound: the Pixi game canvas
// container and the floating touch-stick / touch-action overlay. Matched by
// closest() so anything nested inside them is excluded too.
const EXCLUDED_SELECTOR = "#game-container, [data-no-click-sfx]"

// Should a UI click sound play for this event target? `target` is whatever the
// document-level listener handed us (event.target); it may be a text node host,
// a deep child of a button, or null. We treat a non-element target as "no".
export function shouldPlayClickFor(target: ClickableLike | null): boolean {
    if (target === null) return false

    // Find the nearest button-like ancestor (or self). No button in the chain
    // means this was a click on plain UI - stay silent.
    const button = target.closest(BUTTON_SELECTOR)
    if (button === null) return false

    // Never fire inside the game canvas or the touch overlay, even if some
    // button-role element lives in there.
    if (button.closest(EXCLUDED_SELECTOR) !== null) return false

    // A disabled control is inert; clicking it does nothing, so neither should
    // the sound. Only native form controls carry `disabled`; ARIA buttons can
    // mark themselves via aria-disabled, which we honour too.
    if (button.disabled === true) return false
    if (button.getAttribute("aria-disabled") === "true") return false

    return true
}
