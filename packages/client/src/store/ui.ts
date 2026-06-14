import { create } from "zustand"
import { GAME_CONTEXT } from "../game"
import { readAudioSettings, writeAudioSettings } from "./audioSettings"
import { readGraphicsSettings, writeGraphicsSettings } from "./graphicsSettings"
import {
    Binding,
    ControlBindings,
    cloneDefaultKeys,
    DEFAULT_GAMEPAD_BINDINGS,
    GameAction,
    KeyBindings,
    GamepadBindings,
    bindingsEqual,
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
    // persists to localStorage. Each action now holds a LIST of bindings (key /
    // mouse button / wheel), so one action can be triggered by several inputs.
    keyBindings: KeyBindings
    gamepadBindings: GamepadBindings
    addBinding: (action: GameAction, binding: Binding) => void
    removeBinding: (action: GameAction, index: number) => void
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
    addBinding: (action, binding) => {
        const existing = get().keyBindings[action]
        // Skip an exact duplicate within the same action's list (the player
        // pressed an input already bound to this action). Duplicates ACROSS
        // actions are allowed and merely flagged by the modal.
        if (existing.some((b) => bindingsEqual(b, binding))) return
        const keyBindings = { ...get().keyBindings, [action]: [...existing, binding] }
        set({ keyBindings })
        persistBindings({ keys: keyBindings, gamepad: get().gamepadBindings })
    },
    removeBinding: (action, index) => {
        const existing = get().keyBindings[action]
        const keyBindings = {
            ...get().keyBindings,
            [action]: existing.filter((_, i) => i !== index),
        }
        set({ keyBindings })
        persistBindings({ keys: keyBindings, gamepad: get().gamepadBindings })
    },
    setGamepadBinding: (action, index) => {
        const gamepadBindings = { ...get().gamepadBindings, [action]: index }
        set({ gamepadBindings })
        persistBindings({ keys: get().keyBindings, gamepad: gamepadBindings })
    },
    resetBindings: () => {
        const keyBindings = cloneDefaultKeys()
        const gamepadBindings = { ...DEFAULT_GAMEPAD_BINDINGS }
        set({ keyBindings, gamepadBindings })
        persistBindings({ keys: keyBindings, gamepad: gamepadBindings })
    },
}))
