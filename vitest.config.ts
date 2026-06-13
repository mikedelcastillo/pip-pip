import { resolve } from "path"
import { defineConfig } from "vitest/config"

// Tests live at the repo root under tests/ (NOT inside any package src/) so they
// never get pulled into a package's `tsc` build or emitted into dist/. They import
// the workspace packages through their raw `@pip-pip/<pkg>/src/...` source paths,
// the same convention the packages use between themselves. Vite resolves those via
// the aliases below (more reliable than leaning on the yarn workspace symlinks,
// some of which are stale after the client-vue/client-react retirement).
const root = process.cwd()

export default defineConfig({
    resolve: {
        alias: {
            "@pip-pip/core": resolve(root, "packages/core"),
            "@pip-pip/game": resolve(root, "packages/game"),
            "@pip-pip/server": resolve(root, "packages/server"),
        },
    },
    test: {
        include: ["tests/**/*.test.ts"],
        environment: "node",
    },
})
