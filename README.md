# pip-pip

A real-time multiplayer browser game built from scratch — custom physics, custom networking, and a full authoring pipeline.

## What it is

pip-pip is a top-down multiplayer shooter where players pilot ships across hand-crafted maps. Everything from collision detection to packet serialization is purpose-built for this project.

**Play it in any modern browser — no install, no account.**

## Technical highlights

- **Custom physics engine** — `PointPhysicsWorld` handles velocity, drag, and collision against arbitrary map geometry. Runs identically on server and client for deterministic simulation.
- **Typed binary-style packet manager** — both client and server import the same typed `packetManager`, so packet shapes are enforced at compile time. No schema drift, no runtime surprises.
- **Authoritative server, predictive client** — the same `PipPipGame` class runs on both sides, controlled by `PipPipGameOptions` flags. The server owns damage, spawns, and scoring; the client predicts locally and reconciles from server state.
- **20 Hz tick loop** — WebSocket server processes packets, steps physics, and broadcasts state 20 times per second. Ping compensation is factored into hit detection.
- **Rust map compiler** — source images are compiled into optimized `.map.json` geometry by a Rust CLI (`tools/game_maps`). Maps live in the game package as typed data, not loose assets.
- **Framework-agnostic client core** — the bulk of the client (`src/game/*`: renderer, networking, ticker, state) is plain TypeScript built on the shared `core`/`game` packages. React only renders a thin HUD and routing on top, so the rendering and netcode are decoupled from the UI framework.

## Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict), Rust |
| Monorepo | Yarn workspaces |
| Server | Node.js, `ws` |
| Rendering | Pixi.js |
| Client framework | React, Vite |
| Map tooling | Rust (image → geometry) |

## Project structure

```
packages/
  core/        — physics, networking primitives, event emitter, math
  game/        — game logic, ships, bullets, maps, packet definitions
  server/      — Node entry: lobby management, tick loop, WebSocket I/O
  client/      — Pixi.js renderer + React UI
  map-maker/   — in-browser map authoring tool
tools/
  game_maps/   — Rust CLI: converts images to map geometry
```

## Running locally

```sh
yarn install
yarn server dev      # game server with hot reload
yarn client dev      # client at localhost:5173
```

Latency simulation: `yarn server dev:latency` (30 ms) or `yarn server dev:jitter` (30 ms + 5 ms jitter).

## Deployment (Railway)

pip-pip ships as a **single combined Railway service**. One service builds the repo via the root `Dockerfile` and runs the Node server, which serves both the game (HTTP REST under `/hrzn` plus the WebSocket on the same port) and the built React client as static files with SPA fallback. The browser connects same-origin, so there is no server URL to configure, and Railway's injected `PORT` is honored automatically. The service must run as a single replica, since connection and lobby state live in memory.

See [docs/deploy-railway.md](docs/deploy-railway.md) for the full guide.

## License

MIT
