// Pure, dependency-free helpers for persisting the player's audio settings to
// localStorage. This module MUST import nothing: it is consumed both by the UI
// store (which pulls in Pixi via ../game) and by the AudioManager, so keeping
// it import-free avoids an import cycle and keeps it safe to run under
// node/vitest where there is no DOM. All localStorage access is guarded by a
// `typeof localStorage !== "undefined"` check (also covers SSR).

export const AUDIO_SETTINGS_KEY = "pip-pip:audio"

export interface AudioSettings {
    volume: number
    muted: boolean
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
    volume: 0.8,
    muted: false,
}

// Parse a raw localStorage string into validated audio settings. Any malformed
// input (null, bad JSON, wrong shape) falls back to the defaults. Volume is
// clamped to [0, 1]; a non-finite or missing volume defaults; a non-boolean
// muted defaults.
export const parseAudioSettings = (raw: string | null): AudioSettings => {
    if (raw === null) return { ...DEFAULT_AUDIO_SETTINGS }

    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return { ...DEFAULT_AUDIO_SETTINGS }
    }

    if (typeof parsed !== "object" || parsed === null) {
        return { ...DEFAULT_AUDIO_SETTINGS }
    }

    const record = parsed as Record<string, unknown>

    const rawVolume = record.volume
    const volume = typeof rawVolume === "number" && Number.isFinite(rawVolume)
        ? Math.min(1, Math.max(0, rawVolume))
        : DEFAULT_AUDIO_SETTINGS.volume

    const rawMuted = record.muted
    const muted = typeof rawMuted === "boolean"
        ? rawMuted
        : DEFAULT_AUDIO_SETTINGS.muted

    return { volume, muted }
}

export const serializeAudioSettings = (s: AudioSettings): string => JSON.stringify({
    volume: s.volume,
    muted: s.muted,
})

// Read persisted settings. Returns defaults when there is no localStorage
// (node/SSR) or when reading throws.
export const readAudioSettings = (): AudioSettings => {
    if (typeof localStorage === "undefined") return { ...DEFAULT_AUDIO_SETTINGS }
    try {
        return parseAudioSettings(localStorage.getItem(AUDIO_SETTINGS_KEY))
    } catch {
        return { ...DEFAULT_AUDIO_SETTINGS }
    }
}

// Write settings. No-ops when there is no localStorage (node/SSR) or when
// writing throws (e.g. quota / private mode).
export const writeAudioSettings = (s: AudioSettings): void => {
    if (typeof localStorage === "undefined") return
    try {
        localStorage.setItem(AUDIO_SETTINGS_KEY, serializeAudioSettings(s))
    } catch {
        // Ignore write failures; persistence is best-effort.
    }
}
