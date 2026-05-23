# React Port: `@pip-pip/client-react`

1:1 port of `packages/client-vue` to modern React. This document is the pickup guide for implementation.

---

## New packages to install (not in client-vue)

```jsonc
// dependencies
"react": "^18.2.0",
"react-dom": "^18.2.0",
"react-router-dom": "^6.18.0",   // replaces vue-router
"zustand": "^4.4.6",             // replaces pinia

// devDependencies
"@types/react": "^18.2.37",
"@types/react-dom": "^18.2.15",
"@vitejs/plugin-react": "^4.1.1" // replaces @vitejs/plugin-vue
```

**Kept verbatim from client-vue:**
`@pixi/assets@^6.5.5`, `@pixi/basis@^6.5.5`, `pixi-filters@^4.2.0`, `pixi.js@^6.5.4`, `sass@^1.55.0`, `vite-tsconfig-paths@^3.5.1`, `vite@^3.1.0`, `typescript@^4.6.4`, `eslint`, `@typescript-eslint/*`

**Dropped:**
`vue`, `vue-router`, `pinia`, `pug`, `@vitejs/plugin-vue`, `vue-tsc`, `eslint-plugin-vue`

> **Why Zustand and not plain React state?** `chat.ts` and `client.ts` write to `GAME_CONTEXT.store` from outside React (the game tick loop). We need a store API that works both inside React (via hooks for re-render) and outside (`getState()` / `setState()`). Zustand is ~1KB, has both APIs, and matches Pinia's mental model closely. The minimal-deps alternative (`useSyncExternalStore` + a hand-rolled observable) is more code and reinvents the same surface — not worth it.

---

## ⚠️ Key architectural change: Pinia mutation → Zustand actions

This is the **biggest semantic difference** in the port. Pinia setup-style stores expose reactive `ref`s that game code mutates directly:

```ts
// client-vue/src/game/chat.ts (works because chatMessages is a ref)
GAME_CONTEXT.store.chatMessages.push(message)
GAME_CONTEXT.store.chatMessages = []
```

Zustand stores require mutations to go through `setState`. So `game/chat.ts` and `game/store.ts` need explicit **action methods**, and call sites must change:

```ts
// client-react/src/game/store.ts
addChatMessage: (msg) => set(s => ({ chatMessages: [...s.chatMessages, msg] })),
clearChatMessages: () => set({ chatMessages: [] }),

// client-react/src/game/chat.ts (adapted)
useGameStore.getState().addChatMessage(message)
useGameStore.getState().clearChatMessages()
```

**Files needing this adaptation (not pure copy):**
- `game/store.ts` — full rewrite (Pinia → Zustand)
- `game/chat.ts` — replace 9 direct mutations with action calls
- `game/index.ts` — `this.store = useGameStore` (store the *hook* itself, not the result), use `this.store.getState().sync()` in the tick loop
- `game/client.ts` — check for any `GAME_CONTEXT.store.*` writes; replace with actions
- `game/ui.ts` — read-only access to keyboard/mouse, no store writes (verify)
- `game/renderer.ts` — read-only access (verify)
- `game/assets.ts` — no store access (verbatim)
- `game/styles.ts` — no store access (verbatim)

**Store shape stays identical** to `client-vue/src/game/store.ts` — same fields (`phase`, `countdownMs`, `isHost`, `ping`, `clientPlayerShipIndex`, `clientPlayerStats`, `players`, `chatMessages`, `outgoingMessages`, `showPlayerList`, plus method `addOutgoingMessage`, `sync`). The Pinia `computed` getters (`isPhaseSetup`, etc.) become inline selectors at call sites: `useGameStore(s => s.phase === PipPipGamePhase.SETUP)`.

---

## ⚠️ Other architectural concerns

### 1. `hostGame()` navigates the router from outside a React component

`client-vue/src/game/index.ts` exports `hostGame()` which calls `router.push(...)`. Vue's `router` is a module-level singleton, so this works. **React Router v6 `useNavigate()` only works inside components.**

**Fix:** Refactor `hostGame()` to accept `navigate` as a parameter:

```ts
// game/index.ts
export async function hostGame(navigate: NavigateFunction) { ... navigate(`/${lobby.lobbyId}`) }

// views/Index.tsx
const navigate = useNavigate()
<GameButton onClick={() => hostGame(navigate)}>Host Game</GameButton>
```

### 2. `GameInput` exposes its internal `<input>` ref to `GameChat`

`GameChat.vue` does `e.target !== inputComponent.value.input` to detect whether keystrokes happened inside the chat input. Vue exposes the `input` ref via `defineExpose`.

**React equivalent:** `forwardRef` + `useImperativeHandle`:

```ts
const GameInput = forwardRef<{ focus: () => void; input: HTMLInputElement | null }, Props>(
  (props, ref) => {
    const inputRef = useRef<HTMLInputElement>(null)
    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      get input() { return inputRef.current },
    }))
    ...
  }
)
```

### 3. `GAME_CONTEXT.initialize()` order in `main.tsx`

`client-vue/main.ts` order is: `createPinia()` → `app.use(pinia)` → `GAME_CONTEXT.initialize()` → `app.mount()`. This is important because `GAME_CONTEXT.initialize()` calls `useGameStore()`, which requires Pinia to be active.

In React with Zustand, the store is a module-level singleton — no provider needed. Just import and use. So order simplifies: `GAME_CONTEXT.initialize()` can run any time before the first render.

### 4. Pixi.js global config

`client-vue/main.ts` line 2: `PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST` — must run before any Pixi rendering. Copy verbatim to `main.tsx`.

### 5. React.StrictMode WILL break GameContext

StrictMode double-mounts components in dev. `GameView`'s `useEffect` calls `GAME_CONTEXT.mountGameView(container)` → `unmountGameView()` → `mountGameView()` again. This is fine for `unmountGameView` (it cleans up game/events/tickers) but **the Pixi renderer mount/unmount cycle may leak**. The current `unmountGameView()` doesn't destroy the renderer (see line 64 in `game/index.ts`: `// this.renderer?.destroy()` is commented out).

**Decision:** Disable StrictMode for now (`<App />` not `<React.StrictMode><App /></React.StrictMode>`). Note this as a TODO to fix renderer cleanup later.

### 6. Sass `@import` vs CSS Modules

Vue's `<style scoped>` becomes per-file scoped CSS. The React equivalent is **CSS Modules**: `Component.module.sass` → `import styles from './Component.module.sass'` → `<div className={styles.button}>`. Vite handles `.module.sass` out of the box (with `sass` installed).

Global styles (`styles/global.sass`, `styles/_variables.sass`) stay unchanged. Inside `.module.sass` files, `@import "../styles/_variables"` still works.

---

## Directory structure to create

```
packages/client-react/
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json           # for vite.config.ts
├── vite.config.ts
├── .eslintrc.cjs
├── public/                       # copy from client-vue/public/
│   ├── logo.png
│   └── bg.png
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── vite-env.d.ts
    ├── router.tsx
    ├── game/
    │   ├── index.ts              # adapt: store is the hook itself
    │   ├── store.ts              # rewrite: Zustand
    │   ├── client.ts             # adapt: store writes → actions
    │   ├── ui.ts                 # verify read-only; likely verbatim
    │   ├── chat.ts               # adapt: store writes → actions
    │   ├── renderer.ts           # verify read-only; likely verbatim
    │   ├── assets.ts             # verbatim
    │   └── styles.ts             # verbatim
    ├── components/
    │   ├── GameLoading.tsx
    │   ├── GameLoading.module.sass
    │   ├── GameView.tsx
    │   ├── GameView.module.sass
    │   ├── GameOverlaySetup.tsx
    │   ├── GameOverlaySetup.module.sass
    │   ├── GameOverlayCountdown.tsx
    │   ├── GameOverlayCountdown.module.sass
    │   ├── GameOverlayMatch.tsx
    │   ├── GameOverlayMatch.module.sass
    │   ├── GameChat.tsx
    │   ├── GameChat.module.sass
    │   ├── GameChatMessage.tsx
    │   ├── GameChatMessage.module.sass
    │   ├── GamePlayerList.tsx
    │   ├── GamePlayerList.module.sass
    │   ├── GameButton.tsx
    │   ├── GameButton.module.sass
    │   ├── GameInput.tsx
    │   └── GameInput.module.sass
    ├── views/
    │   ├── Index.tsx
    │   ├── Index.module.sass
    │   └── Game.tsx
    ├── store/
    │   └── ui.ts                 # Zustand
    ├── styles/
    │   ├── _variables.sass       # verbatim from client-vue
    │   └── global.sass           # verbatim from client-vue
    └── assets/
        # copy entire client-vue/src/assets/ tree
```

---

## Config file specifics

### `package.json`
```jsonc
{
  "name": "@pip-pip/client-react",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite --port 5174",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "lint": "eslint . --ext .ts,.tsx"
  },
  "dependencies": {
    "@pixi/assets": "^6.5.5",
    "@pixi/basis": "^6.5.5",
    "pixi-filters": "^4.2.0",
    "pixi.js": "^6.5.4",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.18.0",
    "sass": "^1.55.0",
    "vite-tsconfig-paths": "^3.5.1",
    "zustand": "^4.4.6"
  },
  "devDependencies": {
    "@types/react": "^18.2.37",
    "@types/react-dom": "^18.2.15",
    "@typescript-eslint/eslint-plugin": "^5.39.0",
    "@typescript-eslint/parser": "^5.39.0",
    "@vitejs/plugin-react": "^4.1.1",
    "eslint": "^8.24.0",
    "typescript": "^4.6.4",
    "vite": "^3.1.0"
  },
  "peerDependencies": {
    "@pip-pip/core": "*",
    "@pip-pip/game": "*"
  }
}
```

### `vite.config.ts`
```ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tsconfigPaths from "vite-tsconfig-paths"

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
})
```

### `tsconfig.json` (mirror client-vue with React tweaks)
```jsonc
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "target": "ESNext",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "strict": true,
    "jsx": "react-jsx",
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "lib": ["ESNext", "DOM"],
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.d.ts"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

### `tsconfig.node.json` — copy from client-vue verbatim

### `index.html` — copy from client-vue verbatim, change `/src/main.ts` → `/src/main.tsx`

### Root `package.json` — add a workspace script proxy
```jsonc
"react": "yarn workspace @pip-pip/client-react"
```
This gives `yarn react dev`, `yarn react build`, etc., matching the `yarn client`, `yarn server` pattern.

---

## Step-by-step implementation order

### Phase 1: Scaffold
- [ ] `mkdir packages/client-react/`
- [ ] Create `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `.eslintrc.cjs`
- [ ] Copy `client-vue/public/` → `client-react/public/`
- [ ] Copy `client-vue/src/assets/` → `client-react/src/assets/` (full tree)
- [ ] Copy `client-vue/src/styles/` → `client-react/src/styles/` (verbatim, no changes)
- [ ] Copy `client-vue/src/vite-env.d.ts` → `client-react/src/vite-env.d.ts`
- [ ] Add `"react"` script to root `package.json`
- [ ] Run `yarn install` from repo root

### Phase 2: Game logic layer (no store)
- [ ] Copy `assets.ts` verbatim
- [ ] Copy `styles.ts` verbatim
- [ ] Copy `renderer.ts` verbatim (verify no store writes — should be read-only)
- [ ] Copy `ui.ts` verbatim (verify no store writes — should be read-only)

### Phase 3: Store rewrite
- [ ] Write `store/ui.ts` as Zustand (`loading: boolean`, `body: string`, setters)
- [ ] Write `game/store.ts` as Zustand. Keep identical field names and types. Add actions for every mutation that game-side code does:
  - `addChatMessage(msg)`
  - `clearChatMessages()`
  - `addOutgoingMessage(text)`
  - `consumeOutgoingMessages(): string[]` (atomically read + clear, for `sendPackets`)
  - `setSnapshot(partial)` — used by `sync()` to bulk-update phase/countdown/isHost/ping/clientPlayer*/players/showPlayerList
  - `sync()` itself

### Phase 4: Adapt game logic with store dependencies
- [ ] Port `game/index.ts`:
  - `this.store = useGameStore` (the hook itself, used for `.getState()` / `.setState()`)
  - `this.store.getState().sync()` in the tick loop
  - Refactor `hostGame()` to accept `navigate: NavigateFunction`
- [ ] Port `game/chat.ts`: find all `GAME_CONTEXT.store.chatMessages.push(...)` → `useGameStore.getState().addChatMessage(...)`. Find all `GAME_CONTEXT.store.chatMessages = []` → `useGameStore.getState().clearChatMessages()`. Reads like `GAME_CONTEXT.store.isHost` → `useGameStore.getState().isHost`.
- [ ] Port `game/client.ts`: same treatment as chat.ts. Check `sendPackets` for outgoing message consumption — likely needs `consumeOutgoingMessages()`.

### Phase 5: Entry + router
- [ ] `main.tsx`:
  ```tsx
  import * as PIXI from "pixi.js"
  PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST
  import React from "react"
  import ReactDOM from "react-dom/client"
  import { RouterProvider } from "react-router-dom"
  import { router } from "./router"
  import { GAME_CONTEXT } from "./game"
  import App from "./App"
  import "./styles/global.sass"

  GAME_CONTEXT.initialize()
  ReactDOM.createRoot(document.getElementById("app")!).render(<App />)
  // NOTE: not wrapping in StrictMode — see port.md "React.StrictMode" note
  ```
- [ ] `router.tsx`:
  ```tsx
  import { createBrowserRouter } from "react-router-dom"
  import Index from "./views/Index"
  import Game from "./views/Game"
  export const router = createBrowserRouter([
    { path: "/", element: <Index /> },
    { path: "/:id", element: <Game /> },
  ])
  ```
- [ ] `App.tsx`: port `App.vue` logic — `useEffect` triggers `assetLoader.loadBundle(["ui","ships","misc"], onProgress)`, sets `useUiStore` loading/body during load. After load, renders `<RouterProvider router={router} />`. Always renders `<GameLoading />` on top (it self-hides when `loading === false`).

### Phase 6: Primitive components
- [ ] `GameButton.tsx` — accepts `className?: string` for `accent` variant (or boolean prop). Children render in `.top .text`.
- [ ] `GameInput.tsx` — `forwardRef` exposing `{ focus(), input }`. Props: `value`, `onChange`, `onEnter`, `onUp`, `onFocus`, `onBlur`, `placeholder`, `type`. Internal keyup handler does Escape→blur, Enter→onEnter, ArrowUp→onUp. Document body click handler blurs when target ≠ input.
- [ ] `GameChatMessage.tsx` — renders `message.text.map(part => <span className={styles[part.style ?? '']}>...</span>)`.

### Phase 7: Composite components
- [ ] `GameLoading.tsx` — `useUiStore(s => s.loading)` gates rendering; shows `body` text.
- [ ] `GamePlayerList.tsx` — `useGameStore(s => s.players)`, sort with `getPlayerListPriority`. Table identical to Vue.
- [ ] `GameChat.tsx` — local state for `chatMessage`. `useRef<GameInputHandle>()` for the input. `useEffect` to attach window keyup listener (T / Enter / Slash focus shortcut). Renders last 10 messages from `useGameStore(s => s.chatMessages.slice(-10))` (use shallow equality or it'll churn — see Zustand `shallow` if needed).

### Phase 8: Overlays
- [ ] `GameOverlaySetup.tsx` — tabs state (`useState` for active index), conditional Host/Players. Includes `<GamePlayerList />` and `<GameChat />`.
- [ ] `GameOverlayCountdown.tsx` — read `countdownMs`, format `(ms/1000).toFixed(2)`.
- [ ] `GameOverlayMatch.tsx` — `useGameStore(s => s.showPlayerList)` toggles `<GamePlayerList />`. `<pre>{JSON.stringify(clientPlayerStats, null, 2)}</pre>` for debug.

### Phase 9: GameView + views
- [ ] `GameView.tsx`:
  ```tsx
  const containerRef = useRef<HTMLDivElement>(null)
  const phase = useGameStore(s => s.phase)
  useEffect(() => {
    if (!containerRef.current) return
    GAME_CONTEXT.mountGameView(containerRef.current)
    return () => {
      GAME_CONTEXT.unmountGameView()
      GAME_CONTEXT.client.disconnect()
    }
  }, [])
  return <>
    {phase === PipPipGamePhase.SETUP && <GameOverlaySetup />}
    {phase === PipPipGamePhase.COUNTDOWN && <GameOverlayCountdown />}
    {phase === PipPipGamePhase.MATCH && <GameOverlayMatch />}
    <div id="game-container" ref={containerRef} />
  </>
  ```
- [ ] `Index.tsx` — port `Index.vue` template, use `useNavigate()` to pass into `hostGame(navigate)`.
- [ ] `Game.tsx`:
  ```tsx
  const { id } = useParams<{id: string}>()
  const navigate = useNavigate()
  const setUi = useUiStore(s => s.setLoading)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      setUi(true, "Connecting...")
      try {
        await GAME_CONTEXT.client.connect()
        setUi(true, "Joining lobby...")
        await GAME_CONTEXT.client.joinLobby(id)
        if (!cancelled) setReady(true)
      } catch (e) {
        console.warn(e)
        alert("Could not join lobby.")
        navigate("/")
      } finally {
        setUi(false, "")
      }
    })()
    return () => { cancelled = true }
  }, [id])
  return ready ? <GameView /> : null
  ```

### Phase 10: Polish
- [ ] Compare visually against client-vue side-by-side (different ports)
- [ ] Smoke test: see Verification below

---

## Verification

```sh
yarn install                            # picks up new workspace
yarn server dev                         # in one terminal
yarn react dev                          # in another → http://localhost:5174
yarn workspace @pip-pip/client-react tsc --noEmit  # type check
```

Smoke test (compare against `yarn client dev` at :5173):
- [ ] Home page renders with logo + 4 buttons
- [ ] "Host Game" creates a lobby and navigates to `/:id`
- [ ] Canvas mounts and renders ships, map, stars
- [ ] Chat input works: T / Enter / `/` shortcuts focus it
- [ ] `/help`, `/ships`, `/ship 2`, `/name Foo` all work
- [ ] Setup → Countdown → Match phase transitions render correct overlay
- [ ] Tab key in match shows player list
- [ ] Player list sort: you first, then host, then by kills, idle last
- [ ] Disconnect (back to home) cleans up — no leaked tickers in console
