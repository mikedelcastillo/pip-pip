import { create } from "zustand"

interface AlertState {
    // null = no alert showing. Any non-null message renders the AlertModal.
    message: string | null
    title: string
    show: (message: string, title?: string) => void
    clear: () => void
}

// A tiny global store so ANY code path - including non-React async handlers like
// the host/join flow in game/index.ts - can raise an on-brand modal instead of a
// native alert() (which steals focus and looks broken, especially on mobile).
export const useAlertStore = create<AlertState>((set) => ({
    message: null,
    title: "Heads up",
    show: (message, title = "Heads up") => set({ message, title }),
    clear: () => set({ message: null }),
}))

// Imperative helper for non-React callers. Components may also use the hook.
export const showAlert = (message: string, title?: string) =>
    useAlertStore.getState().show(message, title)
