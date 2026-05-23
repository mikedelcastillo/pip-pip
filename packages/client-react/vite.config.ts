import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tsconfigPaths from "vite-tsconfig-paths"

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react(), tsconfigPaths()],
    build: {
        chunkSizeWarningLimit: 600,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes("node_modules/pixi-filters") ||
                        id.includes("node_modules/@pixi/filter-")) {
                        return "pixi-filters"
                    }
                    if (id.includes("node_modules/pixi.js") ||
                        id.includes("node_modules/@pixi/")) {
                        return "pixi"
                    }
                },
            },
        },
    },
})
