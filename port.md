# React Port: `@pip-pip/client-react`

1:1 port of `packages/client-vue` to modern React. This document is a pickup guide for implementation.

---

## New packages to install (not in client-vue)

```
react
react-dom
react-router-dom        # replaces vue-router
zustand                 # replaces pinia — same mental model, minimal API
@vitejs/plugin-react    # replaces @vitejs/plugin-vue
@types/react            # dev
@types/react-dom        # dev
```

**Kept from client-vue:** `pixi.js`, `@pixi/assets`, `pixi-filters`, `sass`, `vite`, `vite-tsconfig-paths`, `typescript`

**Dropped:** `vue`, `vue-router`, `pinia`, `pug`, `@vitejs/plugin-vue`

---

## Directory structure to create

```
packages/client-react/
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── public/
│   ├── logo.png          (copy from client-vue/public/)
│   └── bg.png            (copy from client-vue/public/)
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── vite-env.d.ts
    ├── router.tsx
    ├── game/
    │   ├── index.ts      (port — swap Pinia refs to Zustand)
    │   ├── store.ts      (rewrite — Zustand instead of Pinia)
    │   ├── client.ts     (copy verbatim)
    │   ├── ui.ts         (copy verbatim)
    │   ├── chat.ts       (copy verbatim)
    │   ├── renderer.ts   (copy verbatim)
    │   ├── assets.ts     (copy verbatim)
    │   └── styles.ts     (copy verbatim)
    ├── components/
    │   ├── GameLoading.tsx
    │   ├── GameView.tsx
    │   ├── GameOverlaySetup.tsx
    │   ├── GameOverlayCountdown.tsx
    │   ├── GameOverlayMatch.tsx
    │   ├── GameChat.tsx
    │   ├── GameChatMessage.tsx
    │   ├── GamePlayerList.tsx
    │   ├── GameButton.tsx
    │   └── GameInput.tsx
    ├── views/
    │   ├── Index.tsx
    │   └── Game.tsx
    ├── store/
    │   └── ui.ts         (rewrite — Zustand)
    ├── styles/
    │   ├── _variables.sass  (copy verbatim)
    │   └── global.sass      (copy verbatim)
    └── assets/
        (copy entire assets/ directory from client-vue/src/assets/)
```

---

## Config files

### `package.json`
```json
{
  "name": "@pip-pip/client-react",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite --port 5174",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint . --ext .ts,.tsx --report-unused-disable-directives"
  },
  "dependencies": {
    "@pip-pip/core": "*",
    "@pip-pip/game": "*",
    "@pixi/assets": "^6.5.4",
    "pixi-filters": "^4.1.5",
    "pixi.js": "^6.5.4",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.18.0",
    "zustand": "^4.4.6"
  },
  "devDependencies": {
    "@types/react": "^18.2.37",
    "@types/react-dom": "^18.2.15",
    "@vitejs/plugin-react": "^4.1.1",
    "sass": "^1.55.0",
    "typescript": "^4.9.3",
    "vite": "^3.2.3",
    "vite-tsconfig-paths": "^4.0.0"
  }
}
```

### `vite.config.ts`
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
})
```

### `tsconfig.json`
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ESNext", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

### `index.html`
Same as client-vue but entry is `/src/main.tsx` instead of `/src/main.ts`. Keep the same Google Fonts links (Ubuntu Mono, VT323).

---

## Implementation todos

### 1. Scaffold package
- [ ] Create `packages/client-react/` with `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`
- [ ] Copy `public/` and `src/assets/` from client-vue
- [ ] Copy `src/styles/` verbatim
- [ ] Copy `src/vite-env.d.ts` verbatim
- [ ] Run `yarn install` from repo root to link the workspace

### 2. Copy game logic (no changes needed)
- [ ] `src/game/client.ts` — copy verbatim
- [ ] `src/game/ui.ts` — copy verbatim
- [ ] `src/game/chat.ts` — copy verbatim
- [ ] `src/game/renderer.ts` — copy verbatim
- [ ] `src/game/assets.ts` — copy verbatim
- [ ] `src/game/styles.ts` — copy verbatim

### 3. Port `src/game/store.ts` (Pinia → Zustand)

The Pinia store uses `defineStore('game', { state: () => ({...}), getters: {...}, actions: {...} })`.

Zustand equivalent:
```ts
import { create } from 'zustand'

interface GameStore { ... }

export const useGameStore = create<GameStore>()((set, get) => ({
  phase: PipPipGamePhase.SETUP,
  // ... all state fields
  sync() {
    // same logic as the Pinia sync() action
    set({ phase: game.phase, ... })
  },
}))
```

Key difference: computed getters (like `isPhaseSetup`) become plain fields set during `sync()`, or can be derived with `useGameStore(s => s.phase === PipPipGamePhase.SETUP)` at the call site.

### 4. Port `src/store/ui.ts` (Pinia → Zustand)

Simple store, straightforward conversion:
```ts
export const useUiStore = create<UiStore>()((set) => ({
  loading: false,
  body: '',
  setLoading: (loading, body = '') => set({ loading, body }),
}))
```

### 5. Port `src/game/index.ts`

- Replace `import { useGameStore } from './store'` with the Zustand version
- Replace `this.store = useGameStore()` — Zustand stores aren't instantiated, they're imported directly. Store the reference as `import { useGameStore } from './store'` and call `useGameStore.getState()` / `useGameStore.setState()` inside the class methods (outside React components you use the store API directly, not hooks)
- `store.sync()` call stays — it maps to the `sync` action on the Zustand store

**Note:** In `GameContext`, all store access is outside React lifecycle, so use `useGameStore.getState().sync()` pattern (Zustand supports this).

### 6. Entry: `src/main.tsx`
```tsx
import { SCALE_MODE } from 'pixi.js'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { GAME_CONTEXT } from './game'
import './styles/global.sass'

// Mirror client-vue: configure Pixi before anything else
SCALE_MODE.DEFAULT = SCALE_MODE.NEAREST

GAME_CONTEXT.initialize()

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

### 7. Router: `src/router.tsx`
```tsx
import { createBrowserRouter } from 'react-router-dom'
import Index from './views/Index'
import Game from './views/Game'

export const router = createBrowserRouter([
  { path: '/', element: <Index /> },
  { path: '/:id', element: <Game /> },
])
```

### 8. `src/App.tsx`

Port of `App.vue`. Handles:
- Asset bundle preloading (ui, ships, misc via `Assets.loadBundle`)
- Shows `<GameLoading>` during load with progress %
- On load complete, renders `<RouterProvider router={router} />`
- On error, shows retry prompt

Use `useState` for `{ loaded, progress, error }` and `useEffect` to trigger the load sequence.

### 9. Components

Each `.vue` → `.tsx`. Reactive state reads via Zustand hooks: `const phase = useGameStore(s => s.phase)`.

#### `GameButton.tsx`
- Custom 3D button: two `<div>` layers (top + bottom)
- `onMouseEnter` / `onMouseLeave` / `onMouseDown` / `onMouseUp` for hover/active state using `useState`
- Props: `onClick`, `accent?: boolean`, `children`

#### `GameInput.tsx`
- Controlled input: `value` + `onChange` props
- `onKeyDown`: Enter → emit `onEnter`, ArrowUp → emit `onUp`, Escape → blur ref
- Forward ref or use internal `useRef` for focus management
- Props: `value`, `onChange`, `onEnter`, `onUp`, `onFocus`, `onBlur`, `placeholder`

#### `GameChatMessage.tsx`
- Renders `ChatMessage` with styled text parts
- Each part has a `style` field (`space | player | info | bad | good`) → CSS class or inline style
- Props: `message: ChatMessage`

#### `GameChat.tsx`
- Reads `chatMessages` and `outgoingMessages` from `useGameStore`
- Input: T, Enter, or `/` to focus; Escape to blur
- On submit: calls `store.addOutgoingMessage(text)`, clears input
- Displays last 10 messages
- Use `useRef` + `useEffect` to scroll to bottom on new messages

#### `GamePlayerList.tsx`
- Table: Ping | Name | Ship | Damage | Kills | Deaths | Wins
- Sort order: client player first, then host, then by kills desc, idle last
- "You" and "Host" badges
- Color: accent for client player, dimmed for idle
- Reads `players`, `ping` from store

#### `GameLoading.tsx`
- Reads from `useUiStore`
- Shows loading overlay with message and progress

#### `GameView.tsx`
- `useRef<HTMLDivElement>` for canvas container
- `useEffect(() => { GAME_CONTEXT.mountGameView(ref.current); return () => GAME_CONTEXT.unmountGameView() }, [])` 
- Renders `#game-container` div
- Conditionally renders overlays based on `useGameStore(s => s.phase)`:
  - SETUP → `<GameOverlaySetup />`
  - COUNTDOWN → `<GameOverlayCountdown />`
  - MATCH → `<GameOverlayMatch />`

#### `GameOverlaySetup.tsx`
- Lobby phase overlay
- Start Game button (host only: `store.isHost`)
- Includes `<GamePlayerList />` and `<GameChat />`

#### `GameOverlayCountdown.tsx`
- Large countdown display: `store.countdownMs` formatted to seconds
- Blackout effect (semi-transparent overlay)
- Includes `<GameChat />`

#### `GameOverlayMatch.tsx`
- Player list shown when `store.showPlayerList` (Tab key managed in `GameView` or here via `useEffect` on keydown)
- Debug stats for client player
- Includes `<GameChat />`

### 10. Views

#### `views/Index.tsx`
Port of `Index.vue`:
- Logo + animated caption
- Buttons: Host Game → navigate to `/${nanoid()}` or similar random ID, Join Game, Settings, Credits (latter three unimplemented — same as Vue)
- Use `useNavigate()` from react-router-dom

#### `views/Game.tsx`
Port of `Game.vue`:
- Get lobby ID: `const { id } = useParams()`
- On mount: `GAME_CONTEXT.initializeClient()` then join lobby with the id
- On success: show `<GameView />`
- On failure: `navigate('/')` (use `useNavigate()`)
- Cleanup on unmount: disconnect client

---

## Important porting notes

### Zustand outside React components
In `GameContext` (a class, not a React component), access the store like:
```ts
// Read
const state = useGameStore.getState()
// Write
useGameStore.setState({ phase: ... })
// Or call an action
useGameStore.getState().sync()
```
This is the Zustand pattern for non-React contexts. Do NOT try to call `useGameStore()` hook inside the class.

### Vue `watch` → Zustand `subscribe`
If any game logic watches a store value reactively, use `useGameStore.subscribe()`. In practice `GameContext` drives state into the store (not the other way), so this may not be needed.

### Vue `v-model` on `GameInput`
In React, replace with controlled component pattern: `value` + `onChange` props.

### Vue scoped styles
Client-vue uses `<style lang="sass" scoped>`. In React, use CSS Modules (`.module.scss`) for component-scoped styles. Name them `ComponentName.module.scss` alongside the `.tsx` file.

### Pug templates
Client-vue uses Pug in some components (`lang="pug"` on `<template>`). When porting, convert the Pug structure to JSX directly — no Pug needed in React.

### `$el` / template refs
Vue's `ref="container"` → React's `useRef<HTMLDivElement>(null)` + `ref={containerRef}`.

### Lifecycle mapping
| Vue | React |
|---|---|
| `onMounted` | `useEffect(() => {...}, [])` |
| `onUnmounted` | cleanup return in `useEffect` |
| `computed` | `useMemo` or inline derived value |
| `watch` | `useEffect` with deps |
| `ref()` | `useState` or `useRef` |

### Port dev server port
Use port `5174` (client-vue uses `5173`) to run both simultaneously during development.

### Root workspace scripts
After creating the package, add to root `package.json` scripts:
```json
"react": "yarn workspace @pip-pip/client-react"
```
So `yarn react dev` works like `yarn client dev`.

---

## Verification

```sh
# Install new deps
yarn install

# Start server (separate terminal)
yarn server dev

# Start React client
yarn react dev
# → http://localhost:5174

# TypeScript check
yarn workspace @pip-pip/client-react tsc --noEmit
```

Smoke test checklist:
- [ ] Home page renders with logo and buttons
- [ ] "Host Game" navigates to `/:id` route
- [ ] Canvas mounts and renders the game
- [ ] WebSocket connects to server (port 8443)
- [ ] Chat input works (T / Enter / / shortcuts)
- [ ] Ship selection works (`/ship 2` etc.)
- [ ] Player movement renders
- [ ] Lobby → Countdown → Match phase transitions work
- [ ] Player list (Tab) shows in match phase
- [ ] Disconnect returns to home
