// Pure, dependency-free helpers for persisting whether the player has already
// seen the first-launch ALPHA notice. Like ./audioSettings and
// ./graphicsSettings this module MUST import nothing: it is exercised directly
// under node/vitest where there is no DOM, and is imported by the homepage view.
// All localStorage access is guarded by a `typeof localStorage !== "undefined"`
// check (also covers SSR).

export const ALPHA_NOTICE_KEY = "pip-pip:alpha-seen"

// Whether the first-launch ALPHA notice has already been shown to this player.
// Defaults to false (not seen) so a brand-new visitor gets the auto-popup once.
export const DEFAULT_ALPHA_SEEN = false

// Parse a raw localStorage string into the "seen" flag. The flag is stored as
// the literal "true"; anything else (null, "false", malformed) reads as not
// seen, so a fresh or corrupted entry safely re-shows the notice.
export const parseAlphaSeen = (raw: string | null): boolean => raw === "true"

export const serializeAlphaSeen = (seen: boolean): string => (seen ? "true" : "false")

// Read the persisted flag. Returns the default (not seen) when there is no
// localStorage (node/SSR) or when reading throws.
export const readAlphaSeen = (): boolean => {
    if (typeof localStorage === "undefined") return DEFAULT_ALPHA_SEEN
    try {
        return parseAlphaSeen(localStorage.getItem(ALPHA_NOTICE_KEY))
    } catch {
        return DEFAULT_ALPHA_SEEN
    }
}

// Write the flag. No-ops when there is no localStorage (node/SSR) or when
// writing throws (e.g. quota / private mode).
export const writeAlphaSeen = (seen: boolean): void => {
    if (typeof localStorage === "undefined") return
    try {
        localStorage.setItem(ALPHA_NOTICE_KEY, serializeAlphaSeen(seen))
    } catch {
        // Ignore write failures; persistence is best-effort.
    }
}
