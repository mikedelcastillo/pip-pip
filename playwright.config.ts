import { defineConfig, devices } from "@playwright/test"

// End-to-end UI/UX tests, run on TWO projects so every control is verified on
// both input modes the game must support:
//   - "mobile"  : phone viewport + touch (hasTouch/isMobile) — taps, twin-stick
//   - "desktop" : large viewport + mouse — clicks, hover-free
//
// The client (Vite) serves on 5173 and connects to the game server on 8443 in
// dev (see packages/client/src/game/index.ts). Both are booted by webServer
// below; reuseExistingServer lets a warm `yarn server dev` / `yarn client dev`
// be reused locally instead of relaunching.
export default defineConfig({
    testDir: "./e2e",
    // Fail fast in CI; allow focus locally.
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    // The in-game flow connects over websockets and boots Pixi — give it room.
    timeout: 30_000,
    expect: { timeout: 10_000 },
    reporter: process.env.CI ? "line" : "list",
    use: {
        baseURL: "http://localhost:5173",
        trace: "on-first-retry",
    },
    projects: [
        {
            name: "desktop",
            use: {
                ...devices["Desktop Chrome"],
                viewport: { width: 1280, height: 800 },
            },
        },
        {
            name: "mobile",
            use: {
                // Pixel 5: 393x851, hasTouch + isMobile, chromium.
                ...devices["Pixel 5"],
            },
        },
    ],
    // Only the Vite client is auto-managed — the home screen, modals and control
    // tap-target tests need no game server. Tests that drive an actual in-game
    // lobby additionally require `yarn server dev` (port 8443) to be running;
    // they guard for it themselves. reuseExistingServer lets a warm `yarn client
    // dev` be reused instead of relaunching.
    webServer: {
        command: "yarn client dev",
        url: "http://localhost:5173",
        reuseExistingServer: true,
        timeout: 60_000,
    },
})
