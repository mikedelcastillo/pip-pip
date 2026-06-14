import { create } from "zustand"
import { GAME_CONTEXT } from "../game"
import { readAudioSettings, writeAudioSettings } from "./audioSettings"
import { readGraphicsSettings, writeGraphicsSettings } from "./graphicsSettings"
import {
    ControlBindings,
    DEFAULT_KEYBINDINGS,
    DEFAULT_GAMEPAD_BINDINGS,
    GameAction,
    KeyBindings,
    GamepadBindings,
    readControlBindings,
    writeControlBindings,
} from "./keybindings"

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

    // Custom control bindings (keyboard + gamepad), seeded from localStorage.
    // processInputs reads these every tick via useUiStore.getState(); the
    // KeyBindingsModal mutates them through the setters below, each of which
    // persists to localStorage.
    keyBindings: KeyBindings
    gamepadBindings: GamepadBindings
    setKeyBinding: (action: GameAction, code: string) => void
    setGamepadBinding: (action: GameAction, index: number) => void
    resetBindings: () => void
}

const initialAudioSettings = readAudioSettings()
const initialGraphicsSettings = readGraphicsSettings()
const initialBindings = readControlBindings()

// Persist the current bindings back to localStorage. Pulled out so every
// binding setter shares one code path.
const persistBindings = (b: ControlBindings) => writeControlBindings(b)

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

    keyBindings: initialBindings.keys,
    gamepadBindings: initialBindings.gamepad,
    setKeyBinding: (action, code) => {
        const keyBindings = { ...get().keyBindings, [action]: code }
        set({ keyBindings })
        persistBindings({ keys: keyBindings, gamepad: get().gamepadBindings })
    },
    setGamepadBinding: (action, index) => {
        const gamepadBindings = { ...get().gamepadBindings, [action]: index }
        set({ gamepadBindings })
        persistBindings({ keys: get().keyBindings, gamepad: gamepadBindings })
    },
    resetBindings: () => {
        const keyBindings = { ...DEFAULT_KEYBINDINGS }
        const gamepadBindings = { ...DEFAULT_GAMEPAD_BINDINGS }
        set({ keyBindings, gamepadBindings })
        persistBindings({ keys: keyBindings, gamepad: gamepadBindings })
    },
}))
