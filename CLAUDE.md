# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repo.

**Read first:** `CONVENTIONS.md` (coding standards) and `GLOSSARY.md` (canonical domain terms). Follow both so the codebase stays consistent across sessions.

## Repo layout

Yarn workspaces monorepo; all packages share root `node_modules`. Under `packages/*`:

- `@pip-pip/core`: shared library, no game code. Networking primitives, physics, math, events, ticker, input listeners.
- `@pip-pip/game`: pure game logic on `core` (no rendering, no IO). Entry `src/logic/index.ts` exports `PipPipGame`; also ships, bullets, players, maps, and the typed `packetManager` shared by client and server.
- `@pip-pip/server`: thin Node entry (`src/index.ts`). Builds a `Server`, registers the `default` lobby, runs a 20Hz `updateTick` and a separate `pingTick`.
- `@pip-pip/client`: React + Vite + Pixi.js. `src/game/index.ts` holds `GameContext` (wires `Client`, `PipPipGame`, renderer, input, tickers). `src/game/*` is framework-agnostic TS; React/Zustand only do thin HUD + routing; Pixi owns the canvas.

Maps are authored in the in-app editor and loaded through the grid map engine (`packages/game/src/logic/grid-map.ts` + `grid-map-migrate.ts`), routed via `packages/game/src/maps/index.ts`. Legacy `*.map.json` files are still consumed at runtime through the migration adapter.

## Common commands

Run from repo root (workspace scripts proxy via `yarn <pkg> <script>`):

- `yarn server dev` (nodemon; `dev:latency` and `dev:jitter` add simulated lag), `yarn client dev`.
- `yarn build` (prod build: clear -> core -> game -> server -> fix-tsc-paths -> client).
- `yarn test` (vitest run, suite under `tests/`). Run before claiming tests pass.
- `yarn clear` before `yarn lint` (stale `dist/*.d.ts` otherwise produces false errors).

## Build pipeline gotcha

`core`, `game`, and `server` import each other via raw-source `@pip-pip/<pkg>/src/...` paths, which break once `tsc` emits `dist/`. `scripts/fix-tsc-paths.js` rewrites `@pip-pip/<pkg>/src` -> `@pip-pip/<pkg>/dist` in every emitted `.js` and `.d.ts`. It must run after `tsc` and before starting the server in production; `scripts/build.sh` does this, so don't bypass it. Adding a new TS package consumed by `server`? Add it to both the `packages` and `targets` arrays in `scripts/fix-tsc-paths.js`. Vite bundles the client and resolves workspace `src/` imports directly, so the rewrite doesn't apply there.

## Game architecture

One `PipPipGame` class runs on both sides; the `PipPipGameOptions` flags differ. The server passes authoritative flags (`triggerDamage`, `triggerSpawns`, `setScores`, `shootPlayerBullets`, `considerPlayerPing`, etc.); the client runs non-authoritative and applies server state via packets. When changing game logic, decide which side owns the decision and gate it with an options flag (see `packages/game/src/logic/index.ts`).

A typed packet manager (`@pip-pip/game/src/networking/packets`) handles comms; both sides import the same `packetManager`, so packet shapes are compile-time checked. Server tick = 20Hz; ping refresh = `PING_REFRESH`.

`Server` in `@pip-pip/core` is generic over a packet serializer map plus per-connection and per-lobby `Locals`. Reuse the aliases (`PipPipServer`, `PipPipConnection`, `PipPipLobby`) instead of re-typing.

## TypeScript / module conventions

- TS target `es2016`, `module: commonjs`, `strict: true`, decorators enabled.
- Cross-package imports use the full `@pip-pip/<pkg>/src/<path>` form (not bare imports), or `fix-tsc-paths` won't catch them.
- Client is ESM (`"type": "module"`), resolved via `vite-tsconfig-paths`, and builds with an older `tsc` (4.8.4) than your local toolchain. Gate client changes with the client's own tsc before assuming a deploy passes.
