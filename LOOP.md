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
- [x] **Grenades** — AoE explosion projectile (linear distance falloff, owner self-damage) fired via Djibouti's tactical (`bulletKind: "grenade"`, radius 220). (#28)
- [ ] More projectile types / more ship-specific kits.
- [x] **Bullet spray patterns** per weapon (count+angle cone, pellet-damage split; Mono=twin-barrel, Flora=5-pellet scatter). (#15)
- [x] **Map power-ups** — server-spawned health/ammo pickups (gated by `spawnPowerups`, MATCH-scoped, capped), collected on overlap, networked (`powerupSpawn`/`powerupPickup`) + rendered as a glowing diamond. (#35)
- [x] **Speed (haste) + shield power-ups** — timed ship buffs: haste ×1.5 movement (applied in the shared client/server prediction step), shield zeroes damage (and finally gives the dormant `invincibility` timer a purpose; grenades blocked too); networked via `playerShipTimings`; shield-ring + haste-halo visuals. (#40)
- [x] **AI / training-grounds bots** — host adds bots (`/bot`, `/bots N`, `/clearbots`); server brain chases/aims/shoots nearest; bots broadcast to clients as normal players. (#18)
- [ ] Health regeneration (stats exist, not yet applied).
- [ ] Game-loop & movement polish — lean into fluid, skill-based **Apex-style movement** (the game's north star).
- [ ] **Dash / movement tech** (north-star aligned, NEEDS author greenlight on feel + keybind): a cooldown dash — burst of velocity in the movement/aim direction, server-authoritative + client-predicted (new `dash` input on the playerInputs packet + a `dash` cooldown ship-timing networked via playerShipTimings), with a dash trail particle effect and a mobile dash button. Changes feel/balance + needs a free keybind (Space/LMB=fire, RMB/LShift=tactical, R=reload, Tab=scoreboard are taken), so confirm with the author before shipping.

Maps:
- [x] **Map selection screen** — host-only "Map" tab in the lobby SETUP overlay, over `setMap` (live highlight via synced `mapIndex`). (#25)
- [x] **Per-map background themes** — each of the 5 maps gets a distinct on-theme canvas colour, applied on `setMap` (data on `PipMapType.background`). (#41)
- [ ] New map geometry + tile-art themes (more variety; needs the Rust map tool or hand-authored *.map.json + tile art).

Networking / lobbies / multiplayer:
- [x] **Public-lobby foundation** — lobby metadata + `GET /lobbies` listing + create-with-options + `client.listPublicLobbies()`. (#9)
- [x] **Hosting settings screen** — modal: lobby name, public/private, max players → `createLobby` with options. (#20)
- [x] **Share-to-public** — public/private toggle in the hosting settings modal. (#20)
- [x] **Join public match button + public match browser** — homepage button → browser listing `listPublicLobbies()` → join. (#20)
- [x] **Spectator mode** — `/spectate` toggle + lobby UI; server spawn-gating + `playerSpectate` broadcast; camera follows a cyclable target (←/→); HUD shows a spectating banner; "Spec" tag in the player list. (#34)
- [x] **Promote another player to host (lobby admin/op)** — host-only `/op`/`/makehost <name|id>`, server-handled like `/bot` (echo-suppressed), registered in `/help`. (#33)
- [ ] Multiplayer experience: reconnect, emotes, lobby chat polish.

UI / UX:
- [x] **Character selection screen** — ship picker tab in the lobby SETUP overlay (sprite + stats, live highlight), over the existing setShip/`/ship` path. (#17)
- [x] **Homepage Settings + Credits** — volume + controls reference panel; credits (dev Mike Del Castillo, art Meg Del Castillo) + lore. (#10)
- [x] **Persist audio settings** — volume + mute saved to localStorage and reapplied on load (matches how the player name persists). (#44)
- [x] Improved in-game UI modes — kill feed (#42), scoreboard (#22), tactical/ammo HUD (#29), minimap radar (#43).
- [x] **Revamp the in-game HUD** — decluttered + mobile-responsive MATCH HUD (HP/ammo bars + ping, collapsible chat, control cluster); host-only "Stop Game" control (→ lobby where settings live). (#29) *(full in-match settings editing still needs runtime lobby-metadata updates — open.)*
- [ ] Surface ping in the in-match HUD / player stats (ping already shows in the player list; show the local player's ping in the HUD too).
- [x] **Slash-command autocomplete** — suggestion list as you type `/`, Arrow/Tab/Enter/click to complete. (#23)
- [x] **Improved players screen** — ship icons, ping color-coding, you/host chips, K/D, sorting, on-brand panel. (#22)
- [x] **Debug overlay** — backquote-toggled panel: tick/phase/map/players/bullets, fps/tps, local prediction (pos/vel/renderError/predicted/snapshots), per-remote ping. 4Hz, no per-frame churn. (#31)
- [x] a11y: `GameInput` now sets `name`/`id` + `autoComplete="off"` (fixes the prod a11y warning). (#32)
- [x] Removed the redundant `body { background-image: url(/bg.png) }` in global.sass (HomeBackground renders the bg now). (#32)
- [x] **Mobile twin-stick touch controls** — left stick moves, right stick aims+fires, Tac/Reload buttons; touch-only (coarse pointer), merged into processInputs without affecting desktop; pure stick math unit-tested. (#30)
- [ ] Revamp the homepage to be mobile / small-screen friendly (responsive layout, touch-sized buttons, scales down cleanly).
- [ ] Stretch: controller support; couch co-op / split-screen. (Explicitly optional.)

Art / assets (use the pixel-mcp Aseprite workflow → export → map):
- [x] **Animated homepage background** — recreated Meg's `public/bg.png` as a 256×256 tileable Aseprite master (`assets/homepage-bg.aseprite`, 12-frame twinkle loop) via pixel-mcp, exported to `src/assets/art`, mapped in `src/assets/sprites.ts` (feeds the Pixi "art" bundle), integrated as a responsive parallax bg (reduced-motion aware). (#26)

## Design north-star & lore (from the author)

- **Movement is the soul.** Biggest inspirations: **Apex Legends movement** (fluid, fast,
  skill-expressive) and **Krunker** (fast, web-first, instant-play browser arena shooter).
  Bias feel/controls toward fluid momentum over twitchy, and toward low-friction
  instant play that runs great in the browser / on small screens. Author also loves
  Minecraft, Stardew, Starbound; enjoyed Overwatch; less into Fortnite/Valorant.
- **The name & the ships.** "Pip-Pip" comes from a 2-week-old lovebird that loved the
  double "pip pip" beep of an infrared thermometer; the bird "Blu" mimicked it. **Every
  ship is named after one of the author's birds** (Mono, Hugo, Gotchi, Blu, Flora,
  Djibouti). Keep audio/art faithful — the spawn/UI "pip pip" chirp is canonical.
- **Credits:** game developer **Mike Del Castillo**, art **Meg Del Castillo**.

## Code audit backlog (from a read-only audit pass)

Verified, prioritized. `[x]` = fixed and shipped.

- [x] **C1 (critical)** `$varstring`/packet length prefix decoded only the LOW byte (`new Uint16Array(number[])`), so any payload ≥256 bytes was truncated AND desynced every following packet in the batch — chat/names are user input (emoji/CJK trip it). Fixed in core `serializer.ts` + `packet.ts` (3 sites), with regression tests. (#4)
- [x] **C2 (critical, client)** Renderer/PIXI app + input + audio-resume listeners now fully torn down on unmount (`PipPipRenderer.destroy()`, rewritten `unmountGameView`, `destory`→`destroy`); core keyboard/mouse store bound handlers so `removeEventListener` matches. Regression test asserts add/remove symmetry. (#16)
- [x] **H1 (high)** Physics collision relative-velocity sign error (`core/physics` ~278) — fixed + regression test. (#11)
- [x] **H2 (high, client)** `renderer.ts` player-snap guard typo `dx*dx + dy + dy` (=> dx²+2·dy) → squared distance; large VERTICAL respawns/teleports failed to snap and slid across the map. Extracted to a pure `exceedsSnapDistance` helper + regression test. (#46)
- [x] **H3 (high)** WS connection cap (`clients.values.length`→`clients.size`; `throw`→`return`) — fixed. (#12)
- [x] **H4 (high)** `routerAuthMiddleware` double `next()` on 401 — fixed with `return next(err)`. (#12)
- [ ] **H5** ping-timeout resolves as a real ~maxPing measurement (poisons lag comp).
- [x] **H7** score kills/assists/deaths widened `$uint8`→`$uint16` (no wrap at 256) + test. (#19)
- [x] **M1** Sanitize incoming `playerInputs` floats (finite + clamp amount + wrap angles) before queueing — fixed + test. (#13)
- [x] **M2** Map bounds now include `wall_segment` endpoints + fall back to a default box for empty maps + test. (#19)
- [x] **M6** `$string` now pads/truncates to exactly `length` BYTES (was chars → UTF-8 encode, so a multi-byte value overflowed its fixed slot and desynced the packet, C1 class). Wire-compatible for the ASCII connection/powerup ids that use it; byte-length invariant pinned by tests. (#47)
- [ ] **M5** `$quant16` can't represent exact 0 (round(0.5·0xFFFF)=32768 → decodes to ≈range·1.5e-5). Negligible numerically; deferred (changing the lattice is wire-format risk for ~zero visible gain).
- [ ] **misc** EventEmitter `destroy()` doesn't clear `subscribers`; `BulletGraphic.cleanUp` keeps stale trail; 20Hz debug `console.log` spam; dead/typo cleanups (`SHIP_DAIMETER`, `normalizeToPositiveRadians`, etc.).

### Round-2 audit (this session's new code)

A second read-only audit verified the new code is largely correct (bullet pooling,
grenade ordering, wire mappings, powerup pool, spectator safety, bot ids, branding/sass,
listener cleanup, touch-vs-desktop all confirmed). Findings:

- [x] `/map` used a 0-based index while `/ship` is 1-based — players picked the wrong map. Unified to 1-based + range check. (#36)
- [x] HostSettings public/private toggle highlighted the UNSELECTED option (off-brand vs the app's `accent`=active convention) — fixed. (#37)
- [x] Homepage "Join Game" by code was a dead button (`notYetImplemented`) — now navigates to `/:code` (Enter works too). (#37)
- [x] Per-tick packet `console.log` now gated behind `import.meta.env.DEV` (was spamming the prod console). (#37)
- [x] Bots now fire their tactical/grenade when aimed + in range + `canUseTactical` (`ai.ts`) + tests. (#38)
- [x] Particle wall-list cached and rebuilt only on `setMap` (was per-frame in `renderer.ts`). (#39)
- [ ] (latent) grenade client decode passes primary `speed` (inert today — the velocity vector wins).
- [ ] (info) `friendlyFire`/`useTeams` ship over the wire but no damage path enforces them (FFA by design); `invincibility` timing gates nothing (both pre-existing).

## Decision log

- **D12 — HOTFIX: reconcile runaway ("tossed corner to corner").** D11's `reconcileTo`
  shifted the current position by the prediction error at the acked seq but left the
  retained (unacknowledged) `predictedStates` on their OLD base. So whenever the client
  ran on a *persistent* offset from the server (constant prediction error — e.g. spawn
  quantization, or server input-queue cadence ≠ client cadence), the SAME error was
  re-measured against the stale-based predictions and re-applied EVERY tick. It compounded
  and the ship flew off screen on the slightest movement. Caught by a new multi-tick
  regression test (60 ticks, constant offset) that diverged to x≈111525 instead of ~600.
  Fix: after correcting, re-base the retained predictions by the same error so the next
  ack measures ~0 in steady state (and clear the stale tail on a hard-resync). My D11 unit
  tests only exercised single reconcile calls, which is why they missed it — the new tests
  cover the multi-tick loop. Lesson: netcode correctness needs multi-tick/integration
  tests, not just per-call assertions.
- **D11 — finished the client-side prediction & reconciliation (THE mid-join/respawn
  offset bug).** The netcode rework (e9fa70b) built all the scaffolding — server-side
  authoritative sim from a queued input stream, the owner-only `ownPlayerState` packet
  (float32 pos + `lastInputSeq`), `predictedStates`/`renderError`/`resetNetworkState`,
  and a `DebugOverlay` that reads them — but the CLIENT side was never wired. Two
  concrete defects: (1) `inputSeq` was never advanced, so every `playerInputs` went out
  as seq 0 and the server's wrap-safe dedupe (`pushInputFrame`) collapsed any batch that
  arrived in one tick (jitter / the burst right after a join or respawn / bad wifi) down
  to a single input — the server barely moved the player while the client predicted full
  motion, so everyone else saw the player frozen/severely offset. (2) `ownPlayerState`
  had no client handler at all, so the local ship free-ran its prediction with zero
  server correction. Fix: `ui.ts` advances `inputSeq` once per tick; `sendPackets`
  records the predicted post-sim position keyed by that seq and stops sending the
  now-unused (server-ignored) client `playerPosition`; `client.ts` consumes
  `ownPlayerState` and calls the new `PipPlayer.reconcileTo`, which measures the
  prediction error at the acked seq and shifts the current position by it (collision-free
  reset-and-replay), hard-resyncing on a cold start / post-spawn gap. `playerPosition` is
  now applied to REMOTE players only. 9 headless regression tests pin the seq/dedup +
  reconcile math (218 total). Game-logic + client only (no homepage) → no prod
  smoke-test. The author can't easily test two clients; verified headlessly first.
- **D10 — opt-in graphics effects are persisted + OFF by default.** The renderer already
  constructed CRT/Glitch/Pixelate/Bulge filters but only the bulge was wired into
  `app.stage.filters`; CRT was configured with an untested `curvature = 100` (extreme).
  Shipped a player-facing CRT toggle in Settings → Graphics, mirroring the audio-settings
  persistence pattern exactly: a pure, import-free `store/graphicsSettings.ts`
  (`pip-pip:graphics` key, `parse`/`serialize`/`read`/`write`, `crt: false` default) +
  ui-store `crtEnabled`/`setCrtEnabled`/`toggleCrtEnabled` that persists and calls
  `renderer.setCrtEnabled`. The renderer owns the on/off mechanism via
  `rebuildStageFilters()` — CRT is *appended* to the filter array only when enabled, so OFF
  costs zero GPU passes (not a disabled-filter-in-array). Retuned CRT to a tasteful
  curvature 2 / gentle vignette / animated scanlines so the HUD corners stay legible.
  Default OFF because it is a stylistic choice, not the baseline look. In-game-only change
  (no homepage), so no prod smoke-test re-run. 9 new pure tests.
- **D9 — the asset workflow is now real (pixel-mcp/Aseprite).** Exercised the author's
  requested pipeline for the homepage bg: Aseprite master under repo-root `assets/`
  (`*.aseprite`) → export PNGs to `packages/client/src/assets/art/` → register in
  `packages/client/src/assets/sprites.ts` (single source of truth for art URLs) which
  feeds both the React/CSS layer and the Pixi `"art"` bundle in `game/assets.ts`. pixel-mcp
  works in this environment. Commit the master + the USED exports; skip review-only
  previews. Use this same flow for future art.
- **D8 — production smoke-testing runs in the loop.** Production is
  https://pippip.mikedc.io and `main` AUTO-DEPLOYS there — a smoke test confirmed the
  session's commits are already live. A read-only browser smoke-test subagent runs
  occasionally (homepage renders, no console errors / blank-screen, recent features
  present). First run (after 23 commits): PASS — homepage renders, all menu modals work,
  the only console message is a cosmetic a11y warning (a form input missing id/name).
  Since main → prod is live and unreviewed, keep commits atomic/revertible and lean on
  this smoke test + the audit pass to catch regressions.
- **D7 — every added command must be registered in the client `/help` (rule).** The client
  (`GameChat`) rejects any `/command` not in `GAME_COMMANDS` as "Command not found" and
  never forwards it, so a server-only command is both invisible in `/help` AND unreachable
  from the UI. Rule: any new command MUST be added to `GAME_COMMANDS` (which `/help`
  enumerates). Retro-fix: the AI `/bot`/`/bots`/`/clearbots` commands (server-handled) are
  now registered client-side — host-gated, forwarding the raw text to the server. Also
  queued: slash-command autocomplete in the chat input.
- **D6 — checks/audit must also flag branding & style consistency.** Per author
  feedback, the read-only audit pass now also reports UI that's off-brand (wrong
  button/typography/color vs the established components and `_variables.sass`). First
  instance fixed: the SFX mute toggle was a one-off flat pill — re-rendered as the shared
  `GameButton` (3D layered, accent = sound on) so it matches the rest of the UI. Future
  audit-agent prompts include a "branding consistency" dimension.
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
| 11 | `bbb52bb`   | Fix physics collision relative-velocity sign (H1) | `git revert bbb52bb`|
| 12 | `dd89c90`   | Harden server: WS connection cap + auth short-circuit (H3/H4) | `git revert dd89c90`|
| 13 | `8958fee`   | Sanitize hostile player inputs (M1)               | `git revert 8958fee`|
| 14 | `65cf503`   | Brand the SFX toggle as a GameButton              | `git revert 65cf503`|
| 15 | `2f37b01`   | Per-weapon bullet spray patterns                  | `git revert 2f37b01`|
| 16 | `8fa7cd4`   | Fix renderer/input/WebGL leak on unmount (C2)     | `git revert 8fa7cd4`|
| 17 | `ab3f4b4`   | Character selection screen (lobby ship picker)    | `git revert ab3f4b4`|
| 18 | `5a50d96`   | AI training-grounds bots (host commands + brain)  | `git revert 5a50d96`|
| 19 | `02e0c65`   | Audit fixes: score widths (H7) + map bounds (M2)  | `git revert 02e0c65`|
| 20 | `3e8899a`   | Public matches: hosting settings + browser + join | `git revert 3e8899a`|
| 21 | `a3ba1c3`   | Register /bot commands in slash help (+reachable) | `git revert a3ba1c3`|
| 22 | `ae4f6ee`   | Improved players screen (scoreboard)              | `git revert ae4f6ee`|
| 23 | `2c09b70`   | Slash-command autocomplete in chat                | `git revert 2c09b70`|
| 24 | `df27462`   | docs(loop): production verification + cadence     | `git revert df27462`|
| 25 | `e1559ed`   | Map selection screen (lobby Map tab)              | `git revert e1559ed`|
| 26 | `2fb4a36`   | Animated pixel-art homepage background            | `git revert 2fb4a36`|
| 27 | `ce782c8`   | chore: untrack src-root .js.map + ignore previews | `git revert ce782c8`|
| 28 | `fcfa691`   | Grenade AoE weapon (Djibouti tactical)            | `git revert fcfa691`|
| 29 | `7d5d44f`   | In-game HUD revamp + host Stop-Game control       | `git revert 7d5d44f`|
| 30 | `4331f35`   | Mobile twin-stick touch controls                  | `git revert 4331f35`|
| 31 | `810374a`   | Debug overlay (entities/multiplayer state)        | `git revert 810374a`|
| 32 | `21ec1b1`   | Polish: input a11y name/id + drop redundant bg.png | `git revert 21ec1b1`|
| 33 | `198f0c0`   | Lobby host promotion (/op, /makehost)             | `git revert 198f0c0`|
| 34 | `e76603b`   | Spectator mode (toggle, camera follow, broadcast) | `git revert e76603b`|
| 35 | `8e9b83a`   | Map power-ups (health/ammo pickups)               | `git revert 8e9b83a`|
| 36 | `55108fd`   | Fix /map to be 1-based like /ship                 | `git revert 55108fd`|
| 37 | `416166e`   | Polish: host toggle highlight, join-by-code, dev log | `git revert 416166e`|
| 38 | `a0efae8`   | Bots use their tactical/grenade weapon            | `git revert a0efae8`|
| 39 | `c0cc86b`   | Cache particle wall-list (rebuild on setMap)      | `git revert c0cc86b`|
| 40 | `e28313a`   | Speed/shield power-ups (timed buffs)              | `git revert e28313a`|
| 41 | `2c3fcd2`   | Per-map background themes                         | `git revert 2c3fcd2`|
| 42 | `569b0e6`   | HUD kill feed                                     | `git revert 569b0e6`|
| 43 | `fc70843`   | HUD minimap radar                                 | `git revert fc70843`|
| 44 | `6ab9738`   | Persist audio settings to localStorage            | `git revert 6ab9738`|
| 45 | `2e1d903`   | Opt-in CRT graphics toggle (Settings, persisted)  | `git revert 2e1d903`|
| 46 | `576f962`   | Fix H2 player-snap distance typo (vertical jumps) | `git revert 576f962`|
| 47 | `766f7b2`   | Harden $string to fixed byte width (M6, C1 class) | `git revert 766f7b2`|
| 48 | `1882b8d`   | Fix client prediction/reconciliation (mid-join + respawn offset) | `git revert 1882b8d` |
| 49 | `9d9d626`   | Playwright e2e harness (mobile-touch + desktop-click)   | `git revert 9d9d626` |
| 50 | `dfd8635`   | Translucent player-list background (see game behind)    | `git revert dfd8635` |
| 51 | `b65e461`   | HOTFIX reconcile runaway (ship flew corner-to-corner)   | `git revert b65e461` |
| 52 | `79bc833`   | Tunable movement/physics config (friction/accel/agility) | `git revert 79bc833` |
| 53 | `4d5dc7d`   | Homepage parallax star field (slow upward drift)        | `git revert 4d5dc7d` |
| 54 | `a12bb6f`   | Leave Lobby button (return to home, mobile + desktop)   | `git revert a12bb6f` |
| 55 | `ae9d305`   | Tactical keybind Q/E (+ controls help)                  | `git revert ae9d305` |
| 56 | `6aad0bc`   | Invisibility (cloak) power-up (timed buff)              | `git revert 6aad0bc` |
| 57 | `d84027c`   | Map preview thumbnails in the map selector             | `git revert d84027c` |
| 58 | `131826c`   | Host hand-off to active player + disconnect anti-farm  | `git revert 131826c` |
| 59 | `d0d1134`   | Graceful "Lobby Not Found" modal (replaces alert)      | `git revert d0d1134` |
| 60 | `f20dfd3`   | Buff/shield/tactical HUD (bars w/ duration, bottom-right) | `git revert f20dfd3` |
| 61 | `c08fa7f`   | Mobile UI/UX overhaul (tap targets, a11y button, modal fit) | `git revert c08fa7f` |
| 62 | `97260ee`   | Netcode security hardening (DoS/abuse: payload/varstring/chat/input caps + crypto ids) | `git revert 97260ee` |
| 63 | `012cb85`   | On-screen powerup pickup announcements (feed)          | `git revert 012cb85` |
| 64 | `d732eb5`   | Disconnect warning modal (reconnect / home)           | `git revert d732eb5` |
| 65 | `a83cf4f`   | PWA: web manifest + icons (installable, fullscreen)   | `git revert a83cf4f` |
| 66 | `6e309f0`   | Custom keyboard + controller (gamepad) mapping UI     | `git revert 6e309f0` |
| 67 | `2200ad9`   | First-launch ALPHA notice modal + homepage banner     | `git revert 2200ad9` |
| 68 | `411f73f`   | Copy: remove em-dashes from user-facing text (rule)   | `git revert 411f73f` |
| 69 | `1528cad`   | In-game HUD overhaul: pause menu + floating sticks + declutter | `git revert 1528cad` |
| 70 | `f95e39c`   | Condense repo docs (CLAUDE/README/deploy), fix stale tests note | `git revert f95e39c` |
| 71 | `aca4c39`   | Apex-style HUD redesign + "Respawning in N" overlay   | `git revert aca4c39` |
| 72 | (latest)    | Optional Telegram analytics/control bot (+ deploy commit broadcast) | `git revert <sha>` |
