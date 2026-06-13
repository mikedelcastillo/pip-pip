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
                    // Keep all pixi packages — including pixi-filters and the
                    // @pixi/filter-* packages — in a SINGLE chunk. Splitting
                    // filters into their own chunk breaks class inheritance:
                    // pixi-filters classes `extend` base classes (e.g. Filter)
                    // from @pixi/core, and across a forced chunk boundary that
                    // base binding resolves to `undefined` at evaluation time
                    // ("Object prototype may only be an Object or null"),
                    // crashing the bundle on load. One chunk keeps Rollup's
                    // topological init order intact.
                    if (id.includes("node_modules/pixi.js") ||
                        id.includes("node_modules/@pixi/") ||
                        id.includes("node_modules/pixi-filters")) {
                        return "pixi"
                    }
                },
            },
        },
    },
})
