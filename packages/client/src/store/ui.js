import { create } from "zustand";
export const useUiStore = create((set) => ({
    loading: false,
    body: "",
    setLoading: (loading, body = "") => set({ loading, body }),
}));
//# sourceMappingURL=ui.js.map