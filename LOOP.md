# LOOP.md — autonomous feature loop log

This document is the running decision log for an autonomous "improve the game" loop
(started 2026-06-13). It records **what** shipped, the **commit id** for each feature
(so any change is easy to find and revert), and the **why** behind each decision.

Read this top-to-bottom to understand the state of the work.

---

## Mission

Continuously improve and add features to Pip-Pip (a top-down multiplayer space
shooter): controls, graphics, audio, UI, more weapons/maps, multiplayer features,
game-loop polish, animations, particle effects, and automated testing.

## Working agreement (the rules this loop runs under)

1. **One complete feature per commit.** Nothing is committed until it is finished and
   working. Each commit is self-contained and easy to revert (`git revert <sha>`).
2. **Push directly to `main`** — no branches, no PRs (per request).
3. **Tested locally before commit.** Prefer fast unit tests over browser automation.
   `yarn test` (vitest) must pass; typecheck/lint for touched packages must pass.
4. **Review model.** Because commits go straight to `main`, every commit is kept small
   and individually revertible so it can be reviewed after the fact and rolled back in
   isolation if rejected. The commit log below is the review surface.
5. **Assets:** author an Aseprite master → export PNG → register it in the sprite map.
   See "Asset workflow" below for how this maps onto the *actual* repo layout.
6. **This log is updated on every commit**, with the feature, the reasoning, and the
   commit id. SHAs are backfilled one commit behind (a commit cannot contain its own
   final hash); the most recent row is marked `(latest)` until the next commit fills it.

## Asset workflow (reconciled with the real repo)

The request describes `assets/ (masters) → src/assets/art → src/assets/sprites.ts`.
The repo as it stands does **not** have those exact paths, so this loop uses the
nearest existing convention and documents the mapping:

| Requested              | Actual in this repo                                              |
| ---------------------- | --------------------------------------------------------------- |
| `assets/` masters      | `assets/` at repo root (new) — Aseprite `.aseprite` masters     |
| `src/assets/art`       | `packages/client/src/assets/<category>/*.png` (exported PNGs)   |
| `src/assets/sprites.ts`| `packages/client/src/game/assets.ts` (Pixi `Assets` bundle map) |

Existing map masters already live at `packages/game/maps/*.aseprite`. String texture
ids (e.g. `"ship_1"`, `"tile_default"`) bridge the game logic and the renderer.

## Architecture cheat-sheet (insertion points, from the initial code survey)

- **Client UI:** React + react-router. Routes: `/` (`views/Index.tsx`), `/:id`
  (`views/Game.tsx`). Zustand stores: `store/ui.ts` (loading), `game/store.ts`
  (per-tick game state). New full screens = new view + route; in-game panels = new
  component rendered by a phase overlay (`components/GameOverlay*.tsx`). Styling is
  SASS modules + `styles/_variables.sass`; retro VT323 font.
- **Renderer:** `client/src/game/renderer.ts` (`PipPipRenderer`), Pixi v7, manual
  60fps render tick vs 20Hz update tick. Pooled graphics (`GraphicPool` /
  `PoolableGraphic`). Containers: stars, bullets, mapBackground, players,
  mapForeground, damages. Clean effect/audio hooks via `game.events`: `addPlayer`,
  `playerSetShip`, `removePlayer`, `setMap`, `addBullet`, `removeBullet`, `dealDamage`.
  No audio system and no particle system existed before this loop.
- **Networking:** `core` `Server<T,R,P>` + `Lobby`; typed `packetManager` in
  `game/src/networking/packets.ts`. `GET /lobbies` (listing) is currently a
  "Not yet implemented" stub — this is the foundation needed for public matches.
- **Game logic:** `game/src/logic/index.ts` (`PipPipGame`); authoritative behavior is
  gated by `PipPipGameOptions` flags. Ships in `game/src/ships/index.ts` (`PIP_SHIPS`,
  6 types); `player.setShip(i)` already exists. The **tactical/secondary weapon is
  stubbed** (`useTactical` input + `stats.tactical` exist, no firing logic) — clean
  path to a second weapon. Health regen stats exist but are not yet applied.

## Feature backlog (prioritized; ordered to build foundations first)

Requested across the session (incl. follow-up ideas). Done = shipped to main.

Engine / gameplay:
- [x] **Test infrastructure** (vitest) — foundational, enables the rest. (#1)
- [x] **Secondary/tactical weapon** — implemented the stubbed cannon. (#2)
- [ ] Procedural audio system (Web Audio synthesis; SFX on game events; mute toggle). *(implemented, integrating)*
- [x] **Particle + screen-shake juice** — explosions, hit sparks, thruster trails. (#3)
- [ ] More weapons: grenades, different bullet/projectile types, more ship-specific kits.
- [ ] Map power-ups (pickups: health, ammo, speed, shield).
- [ ] AI enemies / "training grounds" mode (the `calculateAi`/`shootAiBullets` flags exist, no brain yet). *(Apex training-grounds inspired)*
- [ ] Health regeneration (stats exist, not yet applied).
- [ ] Game-loop & movement polish — lean into fluid, skill-based **Apex-style movement** (the game's north star).

Maps:
- [ ] New maps + new backgrounds/themes; map selection screen (over existing `setMap`).

Networking / lobbies / multiplayer:
- [ ] Public-lobby foundation: lobby metadata + implement `GET /lobbies` listing. *(blueprint ready)*
- [ ] Hosting settings screen (name, public/private, map, max players).
- [ ] Share-to-public toggle for hosts.
- [ ] Homepage "Join public match" button + public match browser screen.
- [ ] Spectator mode (spectate lobbies; `spectator`/`spectating` fields partly exist).
- [ ] Promote another player to admin/op of a lobby.
- [ ] Multiplayer experience: reconnect, emotes, lobby chat polish.

UI / UX:
- [ ] Character selection screen (UI over existing `setShip`; ships are named after the dev's birds).
- [ ] Homepage Settings content + Credits (dev **Mike Del Castillo**, art **Meg Del Castillo**).
- [ ] Improved in-game UI modes (kill feed, minimap, scoreboard, tactical/ammo HUD).
- [ ] Debug screen for inspecting entities / multiplayer state (positions, ping, prediction error).
- [ ] Stretch: controller support; couch co-op / split-screen. (Explicitly optional.)

## Design north-star & lore (from the author)

- **Movement is the soul.** Inspiration is **Apex Legends movement** — fluid, fast,
  skill-expressive. Author also loves Minecraft, Stardew, Starbound; enjoyed Overwatch;
  less into Fortnite/Valorant. Bias feel/controls toward fluid momentum over twitchy.
- **The name & the ships.** "Pip-Pip" comes from a 2-week-old lovebird that loved the
  double "pip pip" beep of an infrared thermometer; the bird "Blu" mimicked it. **Every
  ship is named after one of the author's birds** (Mono, Hugo, Gotchi, Blu, Flora,
  Djibouti). Keep audio/art faithful — the spawn/UI "pip pip" chirp is canonical.
- **Credits:** game developer **Mike Del Castillo**, art **Meg Del Castillo**.

## Decision log

- **D3 — parallel design, serial integration.** To get throughput without risking the
  "one complete, tested feature per commit" rule, design work is fanned out to
  background architect subagents (audio, particles, public-lobby blueprints are done and
  stored), while implementation + tests + the atomic commit stay serial and owned here.
  Parallel file edits in a yarn-workspace monorepo (shared root `node_modules`,
  cross-cutting files like `renderer.ts`/`router.tsx`) would create merge/test-env
  friction that endangers commit atomicity, so we trade a little parallelism for clean,
  revertible commits. The client also has tracked compiled `.js.map` artifacts in
  `src/`; always `git status` before committing and revert any artifact churn.
- **D2 — tactical weapon is server-authoritative + headless-testable.** The second
  weapon reuses the existing fire path: the server independently creates authoritative
  bullets from each player's already-networked `useTactical` input, so no new
  client-trust surface. Bullets now carry their own `damage` + `type` (set by the firing
  weapon) and `dealDamage` uses the bullet's damage, so primary (4) and tactical (40)
  hit differently. `playerShootBullet` gained `radius`+`bulletType` so remote clients
  render the heavy cannon as a thick amber trail. Bound to right-click / Left-Shift.
  Validated by a headless `PipPipGame` integration test (two players in an empty arena)
  plus pure cooldown/reload unit tests — no browser needed. Fixed the `tactical.capcity`
  typo while there.
- **D1 — vitest at the repo root, tests under `/tests`.** Chose vitest (Vite-native,
  fast, TS out of the box) over jest. Tests live at the repo root (not inside any
  package `src/`) so they are never swept into a package's `tsc` build or emitted into
  `dist/`. A root `vitest.config.ts` aliases `@pip-pip/*` to the package source dirs
  (more reliable than the yarn workspace symlinks, some of which are stale). First
  tests cover the highest-leverage pure logic: core math (physics helpers), packet
  serializers + the `PacketManager` stream, ship-stat deep-merge, and the real game
  `packetManager` wire format (a regression guard against silent netcode desyncs).

## Commit log

| #  | Short SHA   | Feature                                       | Revert with         |
| -- | ----------- | --------------------------------------------- | ------------------- |
| 1  | `d5a6969`   | Add vitest test infra + first unit tests      | `git revert d5a6969`|
| 2  | `fb9205a`   | Secondary/tactical cannon weapon              | `git revert fb9205a`|
| 3  | (latest)    | Particle + screen-shake juice system          | `git revert <sha>`  |
