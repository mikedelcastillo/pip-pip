import { create } from "zustand"

export interface UiStoreState {
    loading: boolean
    body: string
    setLoading: (loading: boolean, body?: string) => void
}

export const useUiStore = create<UiStoreState>((set) => ({
    loading: false,
    body: "",
    setLoading: (loading, body = "") => set({ loading, body }),
}))
