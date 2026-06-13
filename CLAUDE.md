# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

Yarn workspaces monorepo. All packages share root `node_modules`. The packages under `packages/*`:

- `@pip-pip/core` — shared library: networking primitives (`Server`, `Client`, packet manager, lobby, websockets), physics (`PointPhysicsWorld`), math, event emitter, ticker, keyboard/mouse listeners. No game-specific code.
- `@pip-pip/game` — pure game logic built on `core` (no rendering, no IO). Exports `PipPipGame` (the world), ships, bullets, players, maps, and the typed packet manager shared by client and server.
- `@pip-pip/server` — thin Node entry. Creates a `Server` from `core`, registers the `default` lobby, runs a 20Hz `updateTick` that calls `processLobbyPackets` → `game.update()` → `sendPacketToConnection`. Separate `pingTick` updates per-player ping.
- `@pip-pip/client` — React + Vite + Pixi.js client. `src/game/index.ts` holds `GameContext`, which wires the `Client`, `PipPipGame`, `PipPipRenderer`, input listeners, and tickers. React/Zustand handle UI/store; Pixi handles the canvas. The bulk of the client (`src/game/*`) is framework-agnostic TS; React only renders the thin HUD (chat, player list, overlays) and routing.
- `@pip-pip/map-maker` — separate Vite/Vue app for authoring maps.

Plus `tools/game_maps` — Rust CLI (`cargo run`) that converts source images into `*.map.json` files consumed by `@pip-pip/game/src/maps`.

## Common commands

Run from repo root unless noted. Workspace scripts are proxied via `yarn <name> <script>`:

```sh
yarn server dev      # nodemon server, watches core/game/server src
yarn server dev:latency   # simulated 30ms latency
yarn server dev:jitter    # 30ms latency + 5ms jitter
yarn client dev      # vite dev server for the client
yarn map dev         # vite dev server for the map maker
yarn build           # full prod build: clear → core → game → server → fix-tsc-paths → client
yarn deploy          # reinstall, build, restart pm2 (server + client preview)
yarn lint            # eslint across client, core, game, server
yarn generate-maps   # runs the Rust map generator (tools/game_maps)
yarn clear-maps      # removes packages/game/src/maps/*.map.json
yarn clear           # remove all dist/ and tsbuildinfo
yarn uninstall       # remove all node_modules
```

Per-package lint: `yarn core lint`, `yarn game lint`, `yarn server lint`, `yarn client lint`.

There is **no test runner configured** — the entry files in `core` and `game` currently say `// TODO: Add tests`. Don't claim tests pass; there are none to run.

## Build pipeline gotcha

`core`, `game`, and `server` all import each other using `@pip-pip/core/src/...` paths (raw source). After `tsc` emits `dist/`, those paths are wrong. `scripts/fix-tsc-paths.js` rewrites `@pip-pip/<pkg>/src` → `@pip-pip/<pkg>/dist` in every emitted `.js` and `.d.ts`. **It must run after `tsc` and before starting the server in production** — `scripts/build.sh` already does this; don't bypass it. If you add a new TS package that's consumed by `server`, add it to both `packages` and `targets` arrays in `scripts/fix-tsc-paths.js`.

The client is bundled by Vite, which resolves the workspace `src/` imports directly, so the rewrite doesn't apply there.

## Game architecture

The same `PipPipGame` class runs on both server and client; what differs is the `PipPipGameOptions` flags passed in. The server constructs it with authoritative flags (`triggerDamage`, `triggerSpawns`, `setScores`, `shootPlayerBullets`, `considerPlayerPing`, etc.); the client constructs a non-authoritative instance and applies server state via packets. When changing game logic, think about which side owns the decision — gating with the options flag is the established pattern (see `packages/game/src/logic/index.ts`).

Communication uses a typed packet manager (`@pip-pip/game/src/networking/packets`). Both sides import the same `packetManager`, so packet shapes are checked at compile time. Server tick = 20Hz (`updateTick`); ping refresh = `PING_REFRESH` constant.

`Server` in `@pip-pip/core` is generic over a packet serializer map plus per-connection and per-lobby `Locals` types; the server entry parameterises it as `PipPipServer = Server<GamePacketManagerSerializerMap, GameConnectionLocals, GameLobbyLocals>`. Reuse those aliases (`PipPipServer`, `PipPipConnection`, `PipPipLobby`) rather than re-typing.

## TypeScript / module conventions

- TS target `es2016`, `module: commonjs`, `strict: true`. Decorators are enabled.
- Cross-package imports use the full `@pip-pip/<pkg>/src/<path>` form (not bare package imports). Preserve this convention or the `fix-tsc-paths` rewrite won't catch it.
- Client (`client`, `map-maker`) is ESM (`"type": "module"`) and uses `vite-tsconfig-paths` for resolution.
