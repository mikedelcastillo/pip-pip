// Pure, dependency-free helpers for persisting the player's graphics settings
// to localStorage. Like ./audioSettings this module MUST import nothing: it is
// consumed by the UI store (which pulls in Pixi via ../game) and is exercised
// directly under node/vitest where there is no DOM. All localStorage access is
// guarded by a `typeof localStorage !== "undefined"` check (also covers SSR).

export const GRAPHICS_SETTINGS_KEY = "pip-pip:graphics"

export interface GraphicsSettings {
    // Opt-in retro CRT post-processing (scanlines + curvature + vignette).
    // OFF by default — it is a stylistic choice, not the intended baseline look.
    crt: boolean
}

export const DEFAULT_GRAPHICS_SETTINGS: GraphicsSettings = {
    crt: false,
}

// Parse a raw localStorage string into validated graphics settings. Any
// malformed input (null, bad JSON, wrong shape) falls back to the defaults. A
// non-boolean crt flag defaults to OFF.
export const parseGraphicsSettings = (raw: string | null): GraphicsSettings => {
    if (raw === null) return { ...DEFAULT_GRAPHICS_SETTINGS }

    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return { ...DEFAULT_GRAPHICS_SETTINGS }
    }

    if (typeof parsed !== "object" || parsed === null) {
        return { ...DEFAULT_GRAPHICS_SETTINGS }
    }

    const record = parsed as Record<string, unknown>

    const crt = typeof record.crt === "boolean"
        ? record.crt
        : DEFAULT_GRAPHICS_SETTINGS.crt

    return { crt }
}

export const serializeGraphicsSettings = (s: GraphicsSettings): string => JSON.stringify({
    crt: s.crt,
})

// Read persisted settings. Returns defaults when there is no localStorage
// (node/SSR) or when reading throws.
export const readGraphicsSettings = (): GraphicsSettings => {
    if (typeof localStorage === "undefined") return { ...DEFAULT_GRAPHICS_SETTINGS }
    try {
        return parseGraphicsSettings(localStorage.getItem(GRAPHICS_SETTINGS_KEY))
    } catch {
        return { ...DEFAULT_GRAPHICS_SETTINGS }
    }
}

// Write settings. No-ops when there is no localStorage (node/SSR) or when
// writing throws (e.g. quota / private mode).
export const writeGraphicsSettings = (s: GraphicsSettings): void => {
    if (typeof localStorage === "undefined") return
    try {
        localStorage.setItem(GRAPHICS_SETTINGS_KEY, serializeGraphicsSettings(s))
    } catch {
        // Ignore write failures; persistence is best-effort.
    }
}
