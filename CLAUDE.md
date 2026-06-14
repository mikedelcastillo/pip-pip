# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repo.

## Repo layout

Yarn workspaces monorepo; all packages share root `node_modules`. Under `packages/*`:

- `@pip-pip/core`: shared library, no game code. Networking primitives (`Server`, `Client`, packet manager, lobby, websockets), physics (`PointPhysicsWorld`), math, event emitter, ticker, keyboard/mouse listeners.
- `@pip-pip/game`: pure game logic on `core` (no rendering, no IO). Exports `PipPipGame` (the world), ships, bullets, players, maps, and the typed packet manager shared by client and server.
- `@pip-pip/server`: thin Node entry. Builds a `Server` from `core`, registers the `default` lobby, runs a 20Hz `updateTick` (`processLobbyPackets` -> `game.update()` -> `sendPacketToConnection`). A separate `pingTick` refreshes per-player ping.
- `@pip-pip/client`: React + Vite + Pixi.js. `src/game/index.ts` holds `GameContext`, wiring the `Client`, `PipPipGame`, `PipPipRenderer`, input listeners, and tickers. Most of `src/game/*` is framework-agnostic TS; React/Zustand only do UI/store (thin HUD: chat, player list, overlays) and routing; Pixi owns the canvas.
- `@pip-pip/map-maker`: separate Vite/Vue map-authoring app.

Maps are authored in the in-app map editor and loaded through the TS grid map engine (`packages/game/src/logic/grid-map.ts` + `grid-map-migrate.ts`), which routes every map via `packages/game/src/maps/index.ts`. The legacy `*.map.json` files in `packages/game/src/maps` are still consumed at runtime through the migration adapter (`grid-map-migrate`).

## Common commands

Run from repo root; workspace scripts proxy via `yarn <name> <script>`:

```sh
yarn server dev      # nodemon server, watches core/game/server src
yarn server dev:latency   # simulated 30ms latency
yarn server dev:jitter    # 30ms latency + 5ms jitter
yarn client dev      # vite dev server, client
yarn map dev         # vite dev server, map maker
yarn build           # prod build: clear -> core -> game -> server -> fix-tsc-paths -> client
yarn deploy          # reinstall, build, restart pm2 (server + client preview)
yarn lint            # eslint across client, core, game, server
yarn test            # vitest run (suite at repo root under tests/)
yarn test:watch      # vitest watch mode
yarn clear           # remove all dist/ and tsbuildinfo
yarn uninstall       # remove all node_modules
```

Per-package lint: `yarn core lint`, `yarn game lint`, `yarn server lint`, `yarn client lint`.

Tests: a root-level vitest suite lives under `tests/` (core, game, server, client, audio). Run it with `yarn test` (or `vitest run`) before claiming tests pass.

## Build pipeline gotcha

`core`, `game`, and `server` import each other via raw-source `@pip-pip/<pkg>/src/...` paths, which break once `tsc` emits `dist/`. `scripts/fix-tsc-paths.js` rewrites `@pip-pip/<pkg>/src` -> `@pip-pip/<pkg>/dist` in every emitted `.js` and `.d.ts`. It must run after `tsc` and before starting the server in production; `scripts/build.sh` does this, so don't bypass it. Adding a new TS package consumed by `server`? Add it to both the `packages` and `targets` arrays in `scripts/fix-tsc-paths.js`.

Vite bundles the client and resolves workspace `src/` imports directly, so the rewrite doesn't apply there.

## Game architecture

One `PipPipGame` class runs on both sides; the `PipPipGameOptions` flags differ. The server passes authoritative flags (`triggerDamage`, `triggerSpawns`, `setScores`, `shootPlayerBullets`, `considerPlayerPing`, etc.); the client runs non-authoritative and applies server state via packets. When changing game logic, decide which side owns the decision and gate it with an options flag (see `packages/game/src/logic/index.ts`).

A typed packet manager (`@pip-pip/game/src/networking/packets`) handles comms; both sides import the same `packetManager`, so packet shapes are compile-time checked. Server tick = 20Hz (`updateTick`); ping refresh = `PING_REFRESH`.

`Server` in `@pip-pip/core` is generic over a packet serializer map plus per-connection and per-lobby `Locals` types; the server entry sets `PipPipServer = Server<GamePacketManagerSerializerMap, GameConnectionLocals, GameLobbyLocals>`. Reuse the aliases (`PipPipServer`, `PipPipConnection`, `PipPipLobby`) instead of re-typing.

## TypeScript / module conventions

- TS target `es2016`, `module: commonjs`, `strict: true`, decorators enabled.
- Cross-package imports use the full `@pip-pip/<pkg>/src/<path>` form (not bare imports), or `fix-tsc-paths` won't catch them.
- Client (`client`, `map-maker`) is ESM (`"type": "module"`), resolved via `vite-tsconfig-paths`.
