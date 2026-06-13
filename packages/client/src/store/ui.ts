import { create } from "zustand"
import { GAME_CONTEXT } from "../game"

export interface UiStoreState {
    loading: boolean
    body: string
    setLoading: (loading: boolean, body?: string) => void

    audioVolume: number
    audioMuted: boolean
    setAudioVolume: (v: number) => void
    setAudioMuted: (b: boolean) => void
    toggleAudioMuted: () => void
}

export const useUiStore = create<UiStoreState>((set, get) => ({
    loading: false,
    body: "",
    setLoading: (loading, body = "") => set({ loading, body }),

    audioVolume: 0.8,
    audioMuted: false,
    setAudioVolume: (v) => {
        set({ audioVolume: v })
        GAME_CONTEXT.audio.setMasterVolume(v)
    },
    setAudioMuted: (b) => {
        set({ audioMuted: b })
        GAME_CONTEXT.audio.setMuted(b)
    },
    toggleAudioMuted: () => get().setAudioMuted(!get().audioMuted),
}))
