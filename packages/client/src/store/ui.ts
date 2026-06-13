import { create } from "zustand"
import { GAME_CONTEXT } from "../game"
import { readAudioSettings, writeAudioSettings } from "./audioSettings"
import { readGraphicsSettings, writeGraphicsSettings } from "./graphicsSettings"

export interface UiStoreState {
    loading: boolean
    body: string
    setLoading: (loading: boolean, body?: string) => void

    audioVolume: number
    audioMuted: boolean
    setAudioVolume: (v: number) => void
    setAudioMuted: (b: boolean) => void
    toggleAudioMuted: () => void

    crtEnabled: boolean
    setCrtEnabled: (b: boolean) => void
    toggleCrtEnabled: () => void
}

const initialAudioSettings = readAudioSettings()
const initialGraphicsSettings = readGraphicsSettings()

export const useUiStore = create<UiStoreState>((set, get) => ({
    loading: false,
    body: "",
    setLoading: (loading, body = "") => set({ loading, body }),

    audioVolume: initialAudioSettings.volume,
    audioMuted: initialAudioSettings.muted,
    setAudioVolume: (v) => {
        set({ audioVolume: v })
        GAME_CONTEXT.audio.setMasterVolume(v)
        writeAudioSettings({ volume: v, muted: get().audioMuted })
    },
    setAudioMuted: (b) => {
        set({ audioMuted: b })
        GAME_CONTEXT.audio.setMuted(b)
        writeAudioSettings({ volume: get().audioVolume, muted: b })
    },
    toggleAudioMuted: () => get().setAudioMuted(!get().audioMuted),

    crtEnabled: initialGraphicsSettings.crt,
    setCrtEnabled: (b) => {
        set({ crtEnabled: b })
        GAME_CONTEXT.renderer?.setCrtEnabled(b)
        writeGraphicsSettings({ crt: b })
    },
    toggleCrtEnabled: () => get().setCrtEnabled(!get().crtEnabled),
}))
