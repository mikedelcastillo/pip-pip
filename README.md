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
- **Dual-client architecture** — Vue 3 + Pixi.js client for production; a second React client in development. Shared game and core packages power both with zero duplication.

## Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict), Rust |
| Monorepo | Yarn workspaces |
| Server | Node.js, `ws` |
| Rendering | Pixi.js |
| Client framework | Vue 3, Vite |
| Map tooling | Rust (image → geometry) |

## Project structure

```
packages/
  core/        — physics, networking primitives, event emitter, math
  game/        — game logic, ships, bullets, maps, packet definitions
  server/      — Node entry: lobby management, tick loop, WebSocket I/O
  client-vue/  — Pixi.js renderer + Vue 3 UI
  client-react/— React client (in progress)
  map-maker/   — in-browser map authoring tool
tools/
  game_maps/   — Rust CLI: converts images to map geometry
```

## Running locally

```sh
yarn install
yarn server dev      # game server with hot reload
yarn client:vue dev  # client at localhost:5173
```

Latency simulation: `yarn server dev:latency` (30 ms) or `yarn server dev:jitter` (30 ms + 5 ms jitter).

## License

MIT
