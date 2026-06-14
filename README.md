# pip-pip

A real-time multiplayer browser game built from scratch: custom physics, custom networking, full authoring pipeline.

## What it is

A top-down multiplayer shooter where players pilot ships across hand-crafted maps. Everything from collision detection to packet serialization is purpose-built. Runs in any modern browser, no install, no account.

## Technical highlights

- **Custom physics engine**: `PointPhysicsWorld` (velocity, drag, collision against arbitrary map geometry) runs identically on server and client for deterministic simulation.
- **Typed packet manager**: client and server import the same `packetManager`, so packet shapes are enforced at compile time. No schema drift.
- **Authoritative server, predictive client**: one `PipPipGame` class runs on both sides, gated by `PipPipGameOptions` flags. The server owns damage, spawns, and scoring; the client predicts locally and reconciles from server state.
- **20 Hz tick loop**: the WebSocket server processes packets, steps physics, and broadcasts state 20x/sec, with ping compensation in hit detection.
- **In-app map editor + TS grid map engine**: maps are authored in the in-app editor and loaded through the TypeScript grid map engine (`packages/game/src/logic/grid-map.ts`); maps live in the game package as typed data.
- **Framework-agnostic client core**: most of the client (`src/game/*`: renderer, networking, ticker, state) is plain TypeScript on the shared `core`/`game` packages. React only renders a thin HUD and routing, keeping rendering and netcode decoupled from the UI framework.

## Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict) |
| Monorepo | Yarn workspaces |
| Server | Node.js, `ws` |
| Rendering | Pixi.js |
| Client framework | React, Vite |
| Map tooling | In-app editor + TS grid map engine |

## Project structure

```
packages/
  core/        physics, networking primitives, event emitter, math
  game/        game logic, ships, bullets, maps, packet definitions
  server/      Node entry: lobby management, tick loop, WebSocket I/O
  client/      Pixi.js renderer + React UI
  map-maker/   in-browser map authoring tool
```

## Running locally

```sh
yarn install
yarn server dev      # game server with hot reload
yarn client dev      # client at localhost:5173
```

Latency simulation: `yarn server dev:latency` (30 ms) or `yarn server dev:jitter` (30 ms + 5 ms jitter).

Tests: `yarn test` (vitest suite under `tests/`).

## Deployment (Railway)

pip-pip ships as a **single combined Railway service**. One service builds the repo via the root `Dockerfile` and runs the Node server, which serves both the game (HTTP REST under `/hrzn` plus the WebSocket on the same port) and the built React client as static files with SPA fallback. The browser connects same-origin, so there's no server URL to configure, and Railway's injected `PORT` is honored automatically. Run a single replica only, since connection and lobby state live in memory.

See [docs/deploy-railway.md](docs/deploy-railway.md) for the full guide.

## License

MIT
