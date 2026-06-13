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
- [x] **Procedural audio system** — Web Audio SFX synth on game events + mute toggle + canonical "pip pip" chirp. (#7)
- [x] **Particle + screen-shake juice** — explosions, hit sparks, thruster trails. (#3)
- [ ] More weapons: grenades, different bullet/projectile types, more ship-specific kits.
- [ ] Different bullet **spray patterns** per weapon (spread/shotgun/burst); distinct projectiles per player/ship.
- [ ] Map power-ups (pickups: health, ammo, speed, shield).
- [ ] AI enemies / "training grounds" mode (the `calculateAi`/`shootAiBullets` flags exist, no brain yet). *(Apex training-grounds inspired)*
- [ ] Health regeneration (stats exist, not yet applied).
- [ ] Game-loop & movement polish — lean into fluid, skill-based **Apex-style movement** (the game's north star).

Maps:
- [ ] New maps + new backgrounds/themes; map selection screen (over existing `setMap`).

Networking / lobbies / multiplayer:
- [x] **Public-lobby foundation** — lobby metadata + `GET /lobbies` listing + create-with-options + `client.listPublicLobbies()`. (#9)
- [ ] Hosting settings screen (name, public/private, map, max players).
- [ ] Share-to-public toggle for hosts.
- [ ] Homepage "Join public match" button + public match browser screen.
- [ ] Spectator mode (spectate lobbies; `spectator`/`spectating` fields partly exist).
- [ ] Promote another player to admin/op of a lobby.
- [ ] Multiplayer experience: reconnect, emotes, lobby chat polish.

UI / UX:
- [ ] Character selection screen (UI over existing `setShip`; ships are named after the dev's birds).
- [x] **Homepage Settings + Credits** — volume + controls reference panel; credits (dev Mike Del Castillo, art Meg Del Castillo) + lore. (#10)
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

## Code audit backlog (from a read-only audit pass)

Verified, prioritized. `[x]` = fixed and shipped.

- [x] **C1 (critical)** `$varstring`/packet length prefix decoded only the LOW byte (`new Uint16Array(number[])`), so any payload ≥256 bytes was truncated AND desynced every following packet in the batch — chat/names are user input (emoji/CJK trip it). Fixed in core `serializer.ts` + `packet.ts` (3 sites), with regression tests. (#4)
- [ ] **C2 (critical, client)** Renderer/PIXI `Application` + input/audio document listeners never destroyed on `GameView` unmount → WebGL-context + listener leak (blank canvas after a few navigations). Needs `PipPipRenderer.destroy()`, real unmount teardown, the `destory`→`destroy` typo, and a fix to core keyboard/mouse `destroy()` (`.bind` makes `removeEventListener` a no-op).
- [x] **H1 (high)** Physics collision relative-velocity sign error (`core/physics` ~278) — fixed + regression test. (#11)
- [ ] **H2 (high, client)** `renderer.ts` far-distance snap guard typo `dx*dx + dy + dy` → `dy*dy`.
- [ ] **H3 (high)** WS connection cap uses `clients.values.length` (always 0) → uncapped sockets (DoS); use `clients.size`; `throw`→`return` after close.
- [ ] **H4 (high)** `routerAuthMiddleware` calls `next()` twice on 401 → unauth handler still runs (crash/bypass): `return next(err)`.
- [ ] **H5/H7** ping-timeout resolves as a real ~maxPing measurement (poisons lag comp); score kills/deaths are `$uint8` (wrap at 256).
- [ ] **M1** No finite/range validation on incoming `playerInputs` → a crafted `NaN` poisons other clients' sim.
- [ ] **M2** Map bounds ignore `wall_segments`; empty/segment-only maps get inverted bounds.
- [ ] **M5/M6** `$quant16` can't represent exact 0 (asymmetric); `$string` pads by char not byte.
- [ ] **misc** EventEmitter `destroy()` doesn't clear `subscribers`; `BulletGraphic.cleanUp` keeps stale trail; 20Hz debug `console.log` spam; dead/typo cleanups (`SHIP_DAIMETER`, `normalizeToPositiveRadians`, etc.).

## Decision log

- **D5 — particle refinement from author feedback.** Particles are now physics-based:
  they bounce off wall segments (reflect velocity off the segment normal via core's
  `nearestPointFromSegment`, with restitution), keeping the sim pure/testable by passing
  wall data into `update`. Screen shake is gated to ONLY when the local player is hit
  (`target.id === clientPlayerId`), wall-hit shake removed, kill explosion toned down
  (28→14 particles). Particles draw as pixel squares (`drawRect`) instead of circles to
  fit the pixel-art theme.
- **D4 — fixing the reported "can't damage players" bug (two root causes).** (1) The
  lag-comp rewind looked back a *fixed* offset from the current tick every frame, so the
  rewound target hitbox slid forward with a moving target and bullets aimed where the
  shooter saw them never connected — fixed by anchoring the lookback to the bullet's
  `spawnTick` (freeze the hitbox at fire time for the whole flight). (2) The swept-circle
  test solved for the EXIT root and skipped start-of-tick overlaps, so a bullet co-moving
  with / sitting on a target dealt 0 damage — fixed with an overlap check + the canonical
  entry-root quadratic. Both reproduced with failing headless tests first
  (`tests/game/damage-collision.test.ts`), then fixed; existing weapon damage values
  (primary 4, tactical 40) preserved.
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
| 3  | `8300290`   | Particle + screen-shake juice system          | `git revert 8300290`|
| 4  | `aa8a98e`   | Fix variable-length packet framing (>=256 bytes) | `git revert aa8a98e`|
| 5  | `17539f0`   | Fix player damage misses (lag-comp + swept collision) | `git revert 17539f0`|
| 6  | `95aa379`   | Particle refinement: wall bounce, pixel squares, local-only shake | `git revert 95aa379`|
| 7  | `72d7b18`   | Procedural Web-Audio SFX system + mute toggle | `git revert 72d7b18`|
| 8  | `f1f5b01`   | chore: stop tracking compiled .js.map in client src | `git revert f1f5b01`|
| 9  | `b94a9de`   | Public-lobby foundation (metadata + GET /lobbies + create opts) | `git revert b94a9de`|
| 10 | `7b04254`   | Homepage Settings + Credits modals                | `git revert 7b04254`|
| 11 | (latest)    | Fix physics collision relative-velocity sign (H1) | `git revert <sha>`  |
