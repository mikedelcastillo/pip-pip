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
- [ ] New map geometry + tile-art themes (more variety; authored via the in-app map editor or hand-authored *.map.json + tile art).

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
  https://pip-pip.mikedc.io (WITH the hyphen - this is the live Railway domain; the old
  note said `pippip.mikedc.io` without a hyphen, which is NOT attached to the service and
  returns Railway's "Application not found" fallback 404, so do not smoke-test that one).
  `main` AUTO-DEPLOYS there. Verified live 2026-06-14: pip-pip.mikedc.io serves HTTP 200,
  /hrzn healthcheck 200, and its built JS asset hash matches a local `yarn build` of HEAD,
  so the session's commits are deployed. A read-only browser smoke-test subagent runs
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
| 72 | `2fac305`   | Optional Telegram analytics/control bot (+ deploy commit broadcast) | `git revert 2fac305` |
| 73 | `273f2b9`   | Bindings: mouse buttons + wheel + multiple bindings per action | `git revert 273f2b9` |
| 74 | `b0497bb`   | FIX infinite respawn at match start (stranded-despawn + leftover timer) | `git revert b0497bb` |
| 75 | `b93470c`   | Optional Google Analytics (GA4, gated by VITE_GA_MEASUREMENT_ID) | `git revert b93470c` |
| 76 | `f0339e8`   | Remove redundant SFX toggle from home menu (in Settings) | `git revert f0339e8` |
| 77 | `dbaae59`   | FIX touch sticks never worked (HUD overlay ate the touches) | `git revert dbaae59`|
| 78 | `296a0c1`   | Branded asset-load retry screen (replaces native alert/prompt) | `git revert 296a0c1`|
| 79 | `10c0944`   | Three new maps: Drift (open BR), Clash (TDM arena), Nexus (symmetric) + generator | `git revert 10c0944`|
| 80 | `ef1ddcf`   | Game modes: Deathmatch + Kill Frenzy, win conditions, RESULTS screen, objective HUD, host mode picker | `git revert ef1ddcf`|
| 81 | `89e044b`   | One-page Apex/Krunker lobby overhaul (fix host-covered, SFX into Settings) | `git revert 89e044b`|
| 82 | `59b9500`   | Tame harsh audio: default volume 0.8->0.35, master limiter + low-pass, softer SFX | `git revert 59b9500`|
| 83 | `907faf1`   | Fix mobile lobby panels not scrolling (grid stretch -> flex column on phone) | `git revert 907faf1`|
| 84 | `8801893`   | Credits: drop the false "ships named after birds" line (Meg's correction) | `git revert 8801893`|
| 85 | `38c30da`   | In-lobby game mode switching (host changes mode/target without re-hosting) | `git revert 38c30da`|
| 86 | `8cf6dc9`   | In-match chat hidden until "/" or "T" (editable bind) + mobile chat button | `git revert 8cf6dc9`|
| 87 | `67f7be1`   | CS2/Krunker-style public match browser (server-browser rows, players bar) | `git revert 67f7be1`|
| 88 | `8fe317a`   | Replace native alert() with an on-brand AlertModal (global alert store) | `git revert 8fe317a`|
| 89 | `60ffd4b`   | FIX public match list 401 "Connection lost" (ensure connection before GET /lobbies) | `git revert 60ffd4b`|
| 90 | `03bbe41`   | Match HUD: Deathmatch king/progress meter + prominent Kill Frenzy timer + powerup feed like kill feed | `git revert 03bbe41`|
| 91 | `79cb9b5`   | Mid-game join loadout screen (pick ship / Deploy / Spectate) + respawn "Change Loadout" | `git revert 79cb9b5`|
| 92 | `2b5af09`   | Subtle UI click SFX on every button press (app-wide, soft, muteable) | `git revert 2b5af09`|
| 93 | `84e3a36`   | Host "Close Lobby" (disband + send everyone home with a notice) | `git revert 84e3a36`|
| 94 | `04b117d`   | Ricochet powerup: timed buff, bullets bounce off walls (max 3 bounces) | `git revert 04b117d`|
| 95 | `454fbf2`   | FIX loadout ship pick not reaching server in-match (playerSetShip was SETUP-gated) | `git revert 454fbf2`|
| 96 | `7f807f3`   | Powerup overhaul: longer durations + Minecraft-style buff HUD + tactical countdown feed + networked ricochet timer | `git revert 7f807f3`|
| 97 | `7c44072`   | Loadout buttons: Spectate small on the left, Deploy prominent on the right | `git revert 7c44072`|
| 98 | `59c8553`   | Prompt for a name (modal) on entering a lobby/match when none is saved | `git revert 59c8553`|
| 99 | `1838461`   | Lobby hamburger menu (Settings/Leave/Close Lobby) + Close Lobby confirm modal (ConfirmModal, Modal hideClose) | `git revert 1838461`|
| 100| `fdccbbb`   | Multi-kill banners (Double/Triple/Multi/Monster Kill) for the local player | `git revert fdccbbb`|
| 101| `635b86b`   | End-of-match top-3 podium + MVP on the results screen | `git revert 635b86b`|
| 102| `f671ae8`   | Rapid Fire powerup: timed buff that speeds up weapon fire (networked) | `git revert f671ae8`|
| 103| `a133d7b`   | A suicide counts as a death only (no kill, no damage-dealt credit, no kill feed) | `git revert a133d7b`|
| 104| `1890c6e`   | Gamepad UI navigation (focus all buttons/cards/menus with a controller) + focus ring | `git revert 1890c6e`|
| 105| `6cd84c2`   | Suicides show in the kill feed as "killed themselves" (still no kill/score; not a multi-kill) | `git revert 6cd84c2`|
| 106| `9fa1791`   | FIX infinite respawn (spectator desync): client auto-re-asserts not-spectator when stranded | `git revert 9fa1791`|
| 107| `52f7193`   | Gamepad reaches the mid-match Loadout overlay (gate opens on showLoadout; it is not a Modal) | `git revert 52f7193`|
| 108| `60b34e4`   | Team Deathmatch mode (2 balanced teams, team scoring to maxKills, friendly-fire off, team HUD + player list grouping, host/lobby config) | `git revert 60b34e4`|
| 109| `de27b53`   | FIX infinite reboot loop: Telegram bot skips its backlog on startup, so a stale /reboot is acknowledged (not re-run) instead of redelivered forever | `git revert de27b53`|
| 110| `8dc077b`   | Ready-up: non-host Ready toggle in the lobby footer + host Start Game shows N/M ready (force-start still unrestricted); player-list ready ticks | `git revert 8dc077b`|
| 111| `f6168cc`   | FIX aim snapping back on touch/gamepad stick release: latch aim, mouse only re-takes it when it actually moves | `git revert f6168cc`|
| 112| `af852d2`   | Hard cap of 8 bots per match (MAX_BOTS), enforced authoritatively in addBot so every add path is bounded (CPU/RAM) | `git revert af852d2`|
| 113| `837f633`   | Host bot config (add/remove/fill, all modes) + per-bot difficulty (Easy/Med/Hard/Mixed) with ~20% per-bot skill variance; respects the 8-bot cap | `git revert 837f633`|
| 114| `123bbb0`   | Chat-command registry: config (/mode /kills /minutes /teams /friendlyfire /map /settotalteams), team (/jointeam /leaveteam /join @player), moderation (/kick /kill @player), @mentions, auto /help, N-team (2-6) support | `git revert 123bbb0`|
| 115| `da82dfc`   | Bots target the NEAREST enemy with no bot-vs-human priority (was preferring real players) | `git revert da82dfc`|
| 116| `83c24cb`   | Player names rendered above the health bar (upright, fades with cloak) | `git revert 83c24cb`|
| 117| `e686064`   | Bot A* pathfinding around walls (nav-grid cached per map, path throttled, AI runs on a 3-tick cadence) - net CPU REDUCTION | `git revert e686064`|
| 118| `9c4c959`   | Bot reaction time (50-120ms by difficulty) + wandering aim error; fire gate now uses the perceived target so jitter actually misses (EASY no longer laser-accurate) | `git revert 9c4c959`|
| 119| `9d23f36`   | FIX hosting dropped you into an existing game: joinLobby only reuses the current lobby when its id matches the requested one (was returning any current lobby) | `git revert 9d23f36`|
| 120| `1c17991`   | Bots fire on their ACTUAL (off-centre) aim so wander really misses, + trigger discipline (reaction-scaled fire cooldown; no fire between decision ticks) so they no longer machine-gun on sight | `git revert 1c17991`|
| 121| `fe5fc35`   | FIX A* nav over-blocked corridors (bots got stuck / drove into walls): cell-CENTRE sampling + correct clearance (ship radius + wall radius, was a full diameter) + finer cells (0.75x, was 1.75x wider than a corridor) | `git revert fe5fc35`|
| 122| `92cadad`   | Bots seek + grab powerups (health when hurt, close buffs/ammo opportunistically) while still aiming at enemies | `git revert 92cadad`|
| 123| `d6b1326`   | TDM team health-bar colors (teammate green / enemy red) + debug bot-path overlay (` toggles; client-side A* display of each bot's route + target) | `git revert d6b1326`|
| 124| `82da816`   | Harden bot nav: stuck detection + unstick escape (BFS to nearest open cell) + wall-avoidance nudge + escape when path unreachable, so bots stop wedging in pockets | `git revert 82da816`|
| 125| `62f41b4`   | Spectator controls: Space/Right/Left (+pad) cycle watched players, WASD free-roams the camera, bottom Deploy panel to return (fixes top objective overlap) | `git revert 62f41b4`|
| 126| `8c82a46`   | Map engine Phase 1: new GridMapData format (palette of block types + 45 degree diagonal tile shapes), greedy-meshed rect collision (Clash 89->9 walls), diagonal->segWall, all 8 maps migrated losslessly | `git revert 8c82a46`|
| 127| `a68a028`   | FIX Railway client build (TS 4.8.4): narrow BotGoal via direct goal.kind check, not an aliased bool (older client TS would not narrow the union, breaking the prod build) | `git revert a68a028`|
| 128| `d663252`   | FIX spawn-outside-map: migration now carries the legacy origin (originCol/Row) so converted maps sit at the EXACT old world coords (was shifted to +quadrant, so a stale client + new server disagreed on positions) | `git revert d663252`|
| 129| `d6c433a`   | Retire the Rust map generator (maps now load via the TS grid engine + in-app editor); drop dead generate-maps/clear-maps scripts; remove stray editor screenshots + gitignore them | `git revert d6c433a`|
| 130| `c40b739`   | Map render Phase 2: tiles carry shape+block; renderer draws diagonals as triangles (matching segWalls) + block variety, as ONE cacheAsBitmap layer rebuilt only on setMap (fast big maps) | `git revert c40b739`|
| 131| `8949aa2`   | Map editor Phase 3: homepage /editor route + Map Maker button; paint grid (full/4 slopes/deco/spawn) via pointer events (touch), name/size, collision preview, download/import GridMapData JSON | `git revert 8949aa2`|
| 132| `b9bcb8a`   | Map editor pan/zoom: native Mac trackpad scroll=pan + ctrl/pinch=zoom (passive:false wheel), two-finger touch pinch/pan, one-finger paints; Fit view button | `git revert b9bcb8a`|
| 133| `87028e7`   | FIX bots wiggling in place instead of chasing: stuck-detector only fires when actually TRAVELING (not orbit/retreat), measures progress over the full window, and clamps the progress unit so coarse grids dont flag a moving bot | `git revert 87028e7`|
| 134| `69fbe90`   | FIX bots cant navigate complex 1-tile corridors/mazes: nav grid now TILE-ALIGNED (one cell per map tile, centred on tiles) + clearance = ship+wall radius + raised cell cap, so corridor tiles are open cells (maze now REACHABLE end to end) | `git revert 69fbe90`|
| 135| `2522fc0`   | Aseprite-style map editor: full-screen canvas + checkerboard, vertical tool rail, options popover, keyboard shortcuts + tooltips, click-drag, leave-confirm (ConfirmModal + beforeunload), localStorage autosave/restore | `git revert 2522fc0`|
| 136| `b8db2ff`   | Auto-slope editor tool: picks the slope direction from neighbouring walls (autoSlopeShape, pure+tested); the 4 explicit directions tucked in a dropdown (fixed-positioned to escape rail clip) under it; shortcut S=auto, Q/W/A/X directions | `git revert b8db2ff`|
| 137| `1e093c6`   | Editor polish: UNBOUNDED canvas (sparse Map model, no size inputs; bbox computed at export so the map is as large as you paint), portal Tooltip (createPortal to body so it escapes the tool-rail overflow clip), spawn/block mutual exclusion both ways | `git revert 1e093c6`|
| 138| `9a1267d`   | PERF (mobile): editor redraw is now O(viewport), not O(painted extent). The unbounded-canvas draw window no longer unions the painted bbox (which made grid-line + checkerboard loops span the whole map every frame when cells were painted far apart); painted tiles were already culled to the window, and a Fit lands content inside the viewport, so nothing visible is lost | `git revert 9a1267d`|
| 139| `c54cbd5`   | Editor tooltip no longer flashes on touch: onFocus is gated to keyboard focus (:focus-visible) so a tap's residual button focus does not pop the bubble; hover path was already touch-gated. Mobile-UX polish on the portal tooltip from #137 | `git revert c54cbd5`|
| 140| `4976674`   | CUSTOM MAPS PLAYABLE end to end: editor JSON now loads into a live match. New $largejson wire primitive (uint32 prefix, 256KB cap, hostile-length-guarded) + customMap packet carries full GridMapData; validateGridMapData (shared, caps cols*rows at 62500) gates editor upload + server + client; game.setCustomMap builds geometry via the same loadGridMap; server broadcasts custom geometry to late joiners (encodeActiveMap, CUSTOM_MAP_INDEX=-1 sentinel); host-only mobile upload UI + "Play this map" editor->lobby handoff via localStorage stash | `git revert 4976674`|
| 141| `73573e3`   | FIX bullets pass through full-tile (rect) walls: updateBulletPhysics only swept segWalls; custom maps greedy-mesh "full" tiles into rectWalls, so bullets flew through solid blocks. Added swept bullet-vs-AABB (distanceSegmentToRect, Minkowski-inflated by bullet radius, true segment test catches fast-bullet tunnelling) + axis-aligned rect-face normal for ricochet; one-contact-per-tick guard across both wall types; deterministic (server/client lockstep) | `git revert 73573e3`|
| 142| `0c92cc4`   | Map editor UNDO/REDO (Aseprite-style): one stroke/gesture = one step (snapshot at pointer-down, commit at up if changed), bounded 100-step history in the pure model (deep-copied sparse tiles+spawns, no aliasing); Cmd/Ctrl+Z, +Shift+Z, +Y shortcuts (suppressed in the name field) + top-bar Undo/Redo buttons (46px, portal tooltip, disabled states for mobile where there is no keyboard); autosave-aware so a restored state survives reload | `git revert 0c92cc4`|
| 143| `f7e2203`   | Map editor SHAPE TOOLS (Aseprite-style): draw mode (freehand/rect/line/fill) orthogonal to brush; rect+line preview during drag and commit on pointer-up as one undo step (pure rectCells/lineCells helpers, 8-connected Bresenham); bounded Fill bucket (4-connected, double-bounded by painted-bbox+2 clamp AND 20000-cell cap so it can never run away on the unbounded canvas); click-only 46px mode strip with portal tooltips; preserves pan/pinch, auto-slope, spawn/tile exclusion, undo/redo | `git revert f7e2203`|
| 144| `e19f2c2`   | PERF collision: wall BROADPHASE (uniform-grid spatial hash) in PointPhysicsWorld. resolveWallCollisions + the bullet sweep now query only walls near the object/motion-segment instead of scanning ALL walls (was O(objects*walls) per tick, a CPU problem on the large custom maps now playable). Behavior byte-identical (conservative query AABB + candidate order matches V8 Object.values via insertion-ordinal sort; exact-equality vs brute force proven over 700+ randomized + corner trials), deterministic server/client. queryOrdered is O(candidates), not O(all walls) | `git revert e19f2c2`|
| 145| `7dbfdad`   | COLLISION revamp: remove diagonal-wall ENDCAP bumps (the cause of ships catching on corners + bots wedging on diagonals). segWalls gained opt-in cappedEnds (default true = unchanged full capsule); diagonal-tile segWalls now set cappedEnds=false so contact is span-clamped (skip the rounded endcap region beyond t in [0,1]) while the face stays fully solid. Every existing/straight wall is byte-identical (default capped); nav grid + bullets intentionally untouched; deterministic | `git revert 7dbfdad`|
| 146| `60a14bc`   | Map editor EYEDROPPER / pick tool (Aseprite parity): pure brushAtCell(map,col,row) returns the cell's brush (spawn wins, else tile shape, else empty; never "auto"); a 5th "Pick" mode in the mode strip (46px, portal tooltip) where a tap adopts the cell's brush then auto-returns to freehand; Alt+click one-shot picks in any mode; reads only (no map mutation, no undo step) | `git revert 60a14bc`|
| 147| `b77edcc`   | Map editor BLOCK COLORS (more block variety): a right-side material rail of 8 selectable block colors (tile_default/slate/rust/accent/teal + new cobalt/moss/mauve) drawn from the renderer's TILE_BLOCK_STYLES so editor preview == in-game look; tile = shape + material; APPEND-ONLY stable palette (shape+color -> entry, never reindexed) so undo/redo + loaded maps keep valid indices; eyedropper adopts color too; deco stays hidden/non-colorable. CLIENT-ONLY, zero game/wire change (any palette key was already valid map data) | `git revert b77edcc`|
| 148| `c9cb4c0`   | FIX editor mobile layout: the draw-mode strip + brush tool rail were two separately-anchored left panels that OVERLAPPED once the mode strip hit 5 items (eyedropper), occluding Line/Fill/Pick (caught via Playwright at 393px). Merged into one scrollable .leftRail column (modes, divider, brushes), Aseprite-style; verified clean via Playwright at 360x640, 393x852, 1280x800 | `git revert c9cb4c0`|
| 149| `f883d64`   | Map editor HALF-TILE block shapes (more shape variety): half_top/bottom/left/right each fill half a cell and collide as ONE axis-aligned half-cell rectWall (reuses the proven rect path, no new collision math; render polygon == collision box exactly). Exposed via a "Half" tool + direction flyout (mirrors the auto-slope flyout). Widened TileShape so TS enforced every switch site; not greedy-meshed with full tiles; round-trips through custom-map JSON; deterministic shared sim | `git revert f883d64`|
| 150| `4b5921d`   | Map editor PLAYABILITY gate: pure editorMapIssue(map) returns the one blocking reason a map cannot be played (no spawn, or bounding box over MAX_CUSTOM_CELLS) or null; shown live in the status bar + options panel; "Play this map" refuses an unplayable map (shows why); Download still works but appends the warning so a saved file is never silently broken. Unit-tested | `git revert 4b5921d`|
| --  | `bf2b67a`   | (docs) Correct prod domain to pip-pip.mikedc.io (WITH hyphen); pippip.mikedc.io 404s. Verified prod live + serving HEAD. Gitignore e2e-/game- Playwright screenshots | `git revert bf2b67a`|
| 151| `e1b0bb6`   | Map editor KEYBOARD SHORTCUTS + controls reference: a collapsed <details> in the Options panel listing every tool key (derived from SHORTCUT_FOR/LABEL_FOR so it stays in sync) + undo/redo/fit/options/save + pointer gestures (paint, two-finger pan/pinch, alt-click eyedropper, the Half/Auto-slope flyouts). No always-visible chrome; Playwright-verified at 393px | `git revert e1b0bb6`|
| 152| `631bdff`   | Map editor MIRROR action (build symmetric arenas in one click, Aseprite-like): Options buttons "Mirror left/right" + "Mirror top/bottom" reflect everything painted across the bbox centre, flipping each shape (pure mirrorShape: diag/half flips per axis, full/deco unchanged) and reflecting spawns, via setCell/toggleSpawn so palette + spawn/tile exclusion hold; one undo step; centre-line cells map to themselves. Pure + unit-tested (involution + reflections); Playwright-verified at 393px | `git revert 631bdff`|
| 153| `76a9466`   | Map editor EXPORT-BOUNDS outline: a dashed amber rectangle around the painted bounding box on the unbounded canvas so authors SEE exactly what will export (the status bar only showed the size as a number). Pure draw() addition (no model/logic change); Playwright-verified at 393px | `git revert 76a9466`|
| 154| `26fb920`   | Freehand FIX: continuous pencil stroke. paintAt only painted the cell under each pointermove, so a fast drag left GAPS; now it interpolates last->current via lineCells (8-connected, gap-free) so freehand draws a solid stroke like a pencil. Reuses the tested lineCells; one undo step (gesture wraps history); Playwright-verified a fast drag paints a gap-free line | `git revert 26fb920`|
| 155| `ad6e150`   | MOBILE FIX: paint applies on RELEASE, not press; pinch no longer drops a tile/spawn. Freehand/fill tap was applied on pointer-DOWN, so the first finger of a pinch painted before the 2nd landed (and the 2nd-finger handler then COMMITTED it). Now a tap paints on pointer-UP, a freehand drag only starts once the pointer leaves its start cell, and a 2nd finger CANCELS a gesture that has not drawn yet (pinch never paints). Playwright-verified: pinch=no paint, tap=one cell on release, drag=continuous stroke | `git revert ad6e150`|
| 156| `1d5937a`   | Map editor SELECTION / TRANSFORM tool (Aseprite-style): "select" mode marquees a rect, then move/copy/cut/paste/rotate-90/flip-H/flip-V/delete + commit-on-deselect via a floating clip. Pure model (extractClip/clearRegion/stampClip/rotateClipCW/flipClip/rotateShapeCW, all unit-tested incl rotate-4x=identity + flip round-trips + append-only stamp); each op is ONE undo step; cyan selection + translucent floating overlay; bottom action toolbar (44px, portal tooltips, Paste disabled when empty); integrates with the deferred-paint/pinch pointer handlers without regressing them. Adversarial review caught a pinch-during-lift undo-loss bug (fixed: guard the terminal cancel on floatingHistoryOpenRef). Playwright-verified at 393px (marquee, toolbar, rotate) | `git revert 1d5937a`|
| 157| `454a337`   | PERF (server CPU): encode each player's SHARED broadcast packets (playerPosition/playerInputs/playerPing) + serverTickHeader ONCE per tick and reuse the bytes across all connections, instead of re-encoding per recipient. Cuts position/input encodes from O(connections*players) to O(players) per tick (the Railway CPU concern). Per-connection-only packets (ownPlayerState, targeted damage, positionSync, reload tracking) still composed per recipient; self-exclusion + wire ORDER byte-identical (proven by a per-connection byte-equivalence test vs the old path) | `git revert 454a337`|
| 158| `2ec2bdc`   | PERF (client FPS): cache-gate the per-player health-bar overlay so it only redraws (clear()+lineStyle/geometry) when its state CHANGES (health/maxHealth/bar-colour) instead of every frame for every player; pure healthOverlayChanged helper unit-tested. Animated buff rings moved to a separate per-frame buffGraphic so they are NOT frozen; buffPulse clock hoisted to once-per-frame. Frame-for-frame identical output | `git revert 2ec2bdc`|
| 159| `5a37004`   | Map editor MAPS LIBRARY: save the current map under a name + load/delete any saved map, all in localStorage (own key pip-pip:map-library, never clobbers the autosave draft or play stash). Pure mapLibrary.ts (injectable Storage, no Date.now; save/overwrite/list-newest-first/load-validated/delete; 50-entry LRU cap + 4MiB guard + quota/corrupt tolerance) unit-tested; Options-panel "Library" section, Load reuses the Import/leave-guard path, Delete is ConfirmModal-guarded. CLIENT-ONLY | `git revert 5a37004`|
| 160| `3553892`   | Lobby SAVED-MAP picker: completes make->save->play. Host-only "Saved maps" section in MapSelect lists the editor's localStorage library (read-only); tapping a row loads + validates it (loadMapFromLibrary) and applies via the same GAME_CONTEXT.setCustomMap path as upload/editor-stash; corrupt entry shows an inline error and sends nothing. Empty library renders nothing; 44px scrollable rows at 393px; key-isolated read-only. CLIENT-ONLY | `git revert 3553892`|
| 161| `7501e40`   | PERF (server CPU/GC): hoist the ~9 repeated Object.values(this.players) rebuilds per tick to ONE cached array threaded through updateSystems/updatePhysics/updateBulletPhysics/updatePowerupPickups (defaulted param so off-tick/test callers unchanged). Strictly behavior-preserving (same Object.values result reused -> identical iteration order; player set is only mutated by lobby/connection events BETWEEN ticks, never mid-update). Proven by a 200-tick full-state byte-identical equivalence test (seeded Math.random + crypto) that ALSO matched a golden digest on the OLD code path | `git revert 7501e40`|
| 162| `b339283`   | QoL: PERSIST last-used ship. setShip now writes the chosen index to localStorage (pip-pip:last-ship); on the first lobby (SETUP) where the local player exists, the cached ship is restored once via the normal setShip path (PipPlayer.setShip clamps, so a stale value is safe). Returning players keep their ship instead of getting a random/default one. CLIENT-ONLY; Playwright-verified save (pick Djibouti -> stored 5) + restore (re-host -> Djibouti auto-selected) | `git revert b339283`|
| 163| `0a5a767`   | Feature: SPECTATOR mini-HUD. While spectating, the spectate panel now shows the watched player's live health bar + primary/tactical ammo + active buff chips (data already client-side). Extracted a pure playerStats(player) mapper so self-HUD + spectate-HUD share ONE source of truth; target selected by spectateTargetId via getSpectateTarget; null on free-roam/despawn/no-target so the panel cleanly collapses (no stale/crash). Mobile-stacked. CLIENT-ONLY, unit-tested mapper | `git revert 0a5a767`|
| 164| `56afcde`   | Feature: ASSISTS. The PlayerScores.assists field existed + was networked but never incremented; now credited server-authoritatively (under triggerDamage): a victim's recent attackers (within ASSIST_WINDOW_TICKS=100/5s, tracked by tick) each get +1 on a kill, excluding the killer + suicides, one per kill; cleared on death/reset; win conditions unchanged (display-only stat). Scoreboard "A" column. Adversarial review caught that a bystander assister's score was not broadcast that tick (connection-out ignored playerScoreChanged) - fixed by a playerScoreChanged->playerScores track loop. Unit-tested (7 cases) | `git revert 56afcde`|
| 165| `e92391a`   | HUD readout polish (client-only, surfaces existing data): (1) "DMG: N" line on each RESULTS podium block; (2) small per-player active-buff DOTS beside the scoreboard name (playerActiveBuffs helper off the existing buffRemaining map, colors/labels shared); (3) the KILLER's ship icon in the kill feed (KillEntry gains killerShipIndex; killerShipImage falls back to no-icon when the killer left/unknown). Suicide rendering + assists column preserved; unit-tested helpers; near-zero risk | `git revert e92391a`|
| 166| `9094428`   | PERF (server CPU/GC): cut per-encode allocation churn in the packet serializer. $varstring.encode now writes the 2-byte LE length prefix + UTF-8 body into ONE preallocated Uint8Array (was ~4 allocs); Packet.encode appends field bytes via an indexed loop instead of output.push(...arr) variadic spread. Strictly BYTE-IDENTICAL wire (decode/framing/number-serializers untouched), proven by an exhaustive equivalence test: every serializer + all 41 packets (single+batch) + round-trip framing vs a golden captured from the pristine base | `git revert 9094428` |
| 167| `eed2b4a`   | MOBILE A11Y: floor the in-game touch controls at the 44px minimum tap target. The two STANDALONE touch controls bypassed the 44px floor GameButton enforces: the coarse-pointer chat opener (2.2em square) and the Tac/Reload action buttons (min-height 2.4em) both resolved to ~35-43px on phones at the clamp font floor (worse on smaller devices), under a comfortable thumb. Added min-width/min-height:44px to the chat button and min-height:max(2.4em,44px) to the action buttons (tablets keep the larger 2.4em). CSS-ONLY, zero logic/wire change; box-sizing:border-box makes the floor exact. Verified: client tsc(4.8.4)+vite build compile the max() pass-through into the bundle, 1100 tests pass, lint clean, and a Playwright probe at the 16px clamp floor measured both controls at exactly 44px | `git revert eed2b4a` |
| 168| `038cbf7`   | DATA HYGIENE: cap player display names at 16 chars (MAX_PLAYER_NAME_LENGTH). Names were unbounded (only the 4096 $varstring wire cap), so a long or abusive name could overflow tight HUD layouts (spectate panel, scoreboard, kill feed, player list) or flood the UI from a hand-crafted client. New pure clampPlayerName() slices by CODE POINT (never splits an emoji into a lone surrogate) and is applied in PipPlayer.setName -- the single chokepoint every name path routes through (own client, server-applied incoming, remote broadcast) -- so the cap is enforced server-authoritatively and IDENTICALLY on every side (server broadcasts the already-clamped name; client+server run the same code, no lockstep divergence). Display-only (player.id is the identity key) so ZERO gameplay/determinism impact; bot names (<=9 chars) untouched. NameModal input also gains maxLength as UX (GameInput now forwards it). Unit-tested (6 cases incl. emoji-boundary + UTF-8 round-trip + bot-name headroom); client tsc(4.8.4) + game tsc + vite build all green, 1106 tests pass | `git revert 038cbf7` |
| 169| `65d920d`   | DEFENSE-IN-DEPTH (mobile): harden the spectate panel so a watched player's name can never overflow it on a narrow phone. .target now truncates with an ellipsis (min-width:0 + overflow:hidden + text-overflow:ellipsis on the flex child), .label is flex-shrink:0 (the "Spectating" label stays whole), and .spectateInfo is max-width:100% so the row can never push past the panel. With the #168 16-char cap a real name ALREADY fits (Playwright-probed at 393px: 16 widest "W" glyphs = 115px inside a 362px panel, NO truncation), so this is purely a safety net against a cap bypass / client desync / a future higher cap; verified the recipe DOES engage (a forced 60-char string ellipsizes within the panel, label intact, no overflow). CSS-ONLY, zero behavior change in normal play; vite build green, compiled rule confirmed in the bundle | `git revert 65d920d` |
| 170| `e5175f1`   | BUGFIX (high severity, found by an adversarial bug-hunt workflow): kill/death OVER-CREDIT on multiple hits in one tick. dealDamage had no guard against an already-dead target, so when several hits overlapped the SAME target on ONE tick (a multi-pellet spread like Flora's 5 pellets fired point-blank, or two players' shots arriving together) each EXTRA hit re-entered the death block -- the lethal hit drops health to 0, later hits clamp damage to Math.min(raw,0)=0 (health stays 0) while the `health===0` kill guard is still true -- so a kill + a death + another playerKill event were re-credited PER extra hit. One real kill could score up to 5 kills / 5 deaths, corrupting the scoreboard + kill feed AND ending DEATHMATCH/TDM early (kills feed checkWinCondition). FIX: one early return `if(target.ship.capacities.health === 0) return` at the top of dealDamage -- the single chokepoint ALL damage routes through (bullets AND grenade AoE) -- so it covers every source. Server-only (sits after the triggerDamage gate, so the client path is unchanged and lockstep holds). Keyed on health (not spawned) so a despawned-but-alive bot stays farmable for training. Regression-tested (2 cases, PROVEN to fail without the guard via neutralize-and-run); 1108 tests + game tsc + game lint green | `git revert e5175f1` |
| 171| `1a0640c`   | BUGFIX (medium, found by the same bug-hunt workflow): chat rate-limiter NEUTRALIZED across 2+ lobbies. chatRateStates is ONE server-wide token-bucket Map, but pruneChatState pruned against a SINGLE lobby's game.players and runs once per lobby per 20Hz tick -- so every OTHER lobby's bucket was deleted ~every 50ms, and takeChatToken then re-seeded the missing connection with a full CHAT_BURST. Net: any player in a multi-lobby server (defaultLobby maxInstances=128, userCreatable) could sustain ~CHAT_BURST*20=100 msg/s instead of the intended ~3/s, defeating the only chat-flood defense for everyone in their lobby. FIX: prune against lobby.server.connections (every live connection server-wide) so a bucket is dropped only once its connection has left the WHOLE server, not merely this lobby. Single-lobby behavior unchanged (existing chat-hardening tests still green); test/headless contexts with no lobby skip pruning (short-lived, no unbounded growth). Regression-tested (2 cases, one PROVEN to fail against the old game.players prune via neutralize-and-run); 1110 tests + server tsc + server lint green | `git revert 1a0640c` |
| 172| `b5dcea5`   | BUGFIX (low, completes the bug-hunt findings 3/3): normalizeToPositiveRadians returned [2pi, 4pi) instead of [0, 2pi). The body `radians % 2pi + 2pi` already lands in (-2pi, 2pi) from the modulo, so unconditionally adding 2pi shifted EVERY result up a full turn (norm(0)=2pi, norm(pi)=3pi). It is currently DEAD CODE (zero callers in the monorepo; exported since 2022), so impact today is nil -- fixed CONSERVATIVELY (correct the formula, keep the export) rather than deleted, so a future consumer trusting the [0,2pi) contract is not silently handed an angle up to 4pi. New: `((radians % 2pi) + 2pi) % 2pi`. Unit-tested (range in [0,2pi) + angle-preserved-mod-2pi + norm(0)=0 regression). CORE-only, no behavior change anywhere today; 1113 tests + core tsc + core lint (0 errors) green | `git revert b5dcea5` |
| 173| `a24b28d`   | BUGFIX (medium, found by bug-hunt #2): Connection.destroy() leaked the connection + a live timer for ~10 min on EVERY disconnect/kick/lobby-close. destroy() -> removeWebSocket() -> startIdle(), and startIdle() armed a setTimeout(connectionIdleLifespan = 10 min) with NO destroyed guard; the timer's closure captures `this` (and via it the whole server), so a torn-down connection could not be GC'd and held an active timer for the full idle lifespan. On a busy prod server with player churn this is a slow per-disconnect memory + timer leak. FIX: (1) guard startIdle with `if(this.destroyed) return` so a destroyed connection can never re-arm; (2) clear any pending idle timer in destroy() right after removeWebSocket(). CORE-only. Unit-tested with a real Connection + stub server (3 cases, 2 PROVEN to fail without the fix via neutralize-and-run); 1116 tests + core tsc + core lint (0 errors) green | `git revert a24b28d` |
| 174| `1892f01`   | BUGFIX (medium, found by bug-hunt #2): a respawned ship could not fire its TACTICAL for ~2s. PipShip.reset() (called on respawn) refilled ammo + cleared buff timers but left the weapon/tactical reload+rate timers. ship.update() ticks tacticalReload down EVERY tick even while despawned, and the tactical reload (100 ticks) outlasts the 60-tick respawn window, so a reload begun shortly before death survived the respawn: the fresh ship showed FULL tactical ammo yet canUseTactical was false (isTacticalReloading true) for up to ~40 ticks (~2s). Worst for the Djibouti grenadier whose tactical IS its identity. FIX: reset() now also zeroes weaponReload / weaponRate / tacticalReload / tacticalRate so a respawn is immediately fire-ready and matches the refilled-ammo HUD; invincibility (deliberate spawn protection) + health-regen timers are intentionally left untouched. Runs identically on client + server (networked via playerShipTimings) so lockstep holds. Unit-tested (3 cases incl. the buggy precondition + spawn-protection-preserved); 1119 tests + game tsc + game lint green | `git revert 1892f01` |
| 175| `79e579c`   | BUGFIX (medium, found by bug-hunt #3): bots fought TEAMMATES in TEAM_DEATHMATCH. findNearestEnemy only skipped self + despawned, never team, yet bots ARE assigned to teams in TDM (assignTeams / smallerTeam). So a TDM bot whose nearest spawned player was an ally locked onto it -- approaching, orbiting and firing at the friendly (dealDamage blocks teammate damage, so zero effect) -- contributing nothing to its side until an enemy happened to become the nearest player. FIX: findNearestEnemy + updateBotInputs gain an optional useTeams param (defaulted false, so FFA and the existing pure bot tests are unchanged) and skip same-team players, mirroring the dealDamage team guard; the server passes this.settings.useTeams at the callsite. AI runs server-only, so no determinism/lockstep impact. Unit-tested (3 cases: skips ally for the enemy, FFA still nearest-wins, all-teammates -> no target); 1122 tests + game tsc + game lint green | `git revert 79e579c` |
| 176| `ecbad1d`   | BUGFIX (medium, found by bug-hunt #3): position DESYNC on oversized custom maps. World positions go on the wire via $quant16(WORLD_QUANT_RANGE=8192), which SILENTLY saturates any coordinate beyond +/-8192. validateGridMapData (the single gate for editor upload / server customMap / client) capped only cell COUNT (<=62500), never world EXTENT, so a structurally-valid custom map (e.g. 200x200 @ cellSize 72 = ~14400 units, inside the cell cap) could place ships/bullets/powerups past +/-8192: the server kept the true coordinate while every client decoded the saturated 8192, permanently disagreeing by thousands of units. Built-in maps top out at 4608, so only custom maps (a host-controllable, server-applied feature) were affected. FIX: validateGridMapData now rejects any map whose worst-case world bound (cell extent +/- half a cell, shifted by the optional origin) exceeds WORLD_QUANT_RANGE, so an out-of-range map can never load to desync. Unit-tested (rejects oversized + origin-shifted, accepts in-range + a compact at-cap map; the old at-cap test was a 1x62500 strip that legitimately busts the extent, now a 250x250 square @ small cellSize). 1125 tests + game tsc + game lint green | `git revert ecbad1d` |
| 177| `72868ec`   | BUGFIX (medium, found by bug-hunt #3): TEAM_DEATHMATCH could declare a TRAILING team the winner. A single tick can credit kills to players on different teams (the bullet + grenade loops resolve several lethal hits per tick), so two teams can cross the combined kill cap before the once-per-tick checkWinCondition runs. The TDM branch used teamIndices(numTeams).find(t => teamScore(t) >= target), i.e. the LOWEST-INDEX team that reached the cap -- so with team 1 at 11 and team 0 at 10, team 0 (the loser) was declared the winner. FIX: among the teams that reached the cap, pick the HIGHEST combined score (reduce with strict >, so a genuine tie keeps the lower index), mirroring the DEATHMATCH path's topScorers selection. Unit-tested (highest-team-wins, exact-tie -> lower index, no-winner-before-cap); 1128 tests + game tsc + game lint green | `git revert 72868ec` |
| 178| `a8a8688`   | BUGFIX (medium, found by bug-hunt #3, completes 4/4): editor MIRROR destroyed originals on a tile/spawn collision. mirrorMap documents a UNION (originals kept + mirror images added) but tiles and spawns are mutually exclusive per cell: a mirrored TILE written onto an existing spawn evicted it (setCell->removeSpawn), and a mirrored SPAWN written onto an existing tile evicted it (setCell('spawn')->toggleSpawn); the spawn loop only guarded spawn-onto-spawn. So a tile and a spawn symmetric about the bbox centre (a routine balanced-arena layout) mirrored onto each other and BOTH originals were silently destroyed, leaving the arena asymmetric. FIX: skip a mirror image whose destination already holds the OPPOSITE content type (tile loop skips a cell that hasSpawn; spawn loop also skips a cell with tileAt>0), so originals are never evicted -- such a cell simply cannot be made symmetric. CLIENT-ONLY (editor model). Unit-tested (tile+spawn mirror onto each other -> both survive); client tsc(4.8.4) + 147 editor tests + full suite + client lint green | `git revert a8a8688` |
| 179| `b54ffe4`   | BUGFIX (high, found by bug-hunt #4): the #176 world-extent guard was INCOMPLETE -- it bounded only the CELL GRID, not the SPAWN cells or SEGMENT endpoints, which ALSO set ship spawn positions + map bounds. So a custom map like {cols:1, spawns:[[1000,0]]} or {segments:[[0,0,1000,0]]} still validated and placed entities at ~72000 world units, far past +/-WORLD_QUANT_RANGE (8192) -- the exact $quant16 saturation desync #176 set out to prevent (server keeps the true coord while every client decodes 8192). FIX: fold cells + spawns + segment endpoints into ONE combined min/max col/row (segments validation moved above the guard), then run the single extent check on that range. Reproduced by the hunt; unit-tested (rejects out-of-grid spawn, rejects out-of-grid segment, accepts in-grid spawns+segments within range). full suite + game tsc + game lint green | `git revert b54ffe4` |
| 180| `d05dec8`   | BUGFIX (medium, found by bug-hunt #4): timed-buff PICKUP never networked the buff. On a powerup pickup the broadcast tracked only shipCapacities (health/ammo), but the five TIMED buffs (haste/shield/invisibility/ricochet/rapidfire) mutate ship.timings, carried by the SEPARATE playerShipTimings packet. So a buff applied server-side was invisible to clients: (1) the PICKER's own movement prediction read timings.haste=0 and rubber-banded against the 1.5x server for the whole ~10s haste window (a persistent reconcile correction every tick); (2) NO client rendered the buff visual (shield/cloak/haste ring) or the powerup-feed countdown, until the picker next reloaded/respawned (the only other shipTimings broadcast paths). FIX: track shipTimings alongside shipCapacities in the powerupPickup broadcast loop (connection-out.ts) so the buff is networked the same tick it is applied. SERVER-ONLY broadcast change. Regression-tested (a remote recipient's broadcast now contains the picker's playerShipTimings packet; PROVEN to fail without the track via neutralize-and-run); full suite + server tsc + server lint green | `git revert d05dec8` |
| 181| `24639a8`   | BUGFIX (high, found by bug-hunt #4, completes 3/3): a STALE socket's late close tore down the freshly-RECONNECTED socket. handleSocketClose + removeWebSocket operated on whatever connection.ws CURRENTLY was (never the socket that fired), and setWebSocket adopted a new socket WITHOUT detaching/closing the old one, binding the SAME shared close handler to every socket. On a half-open reconnect (flaky/mobile network: socket A lingers, the client reopens socket B reusing the same Connection via the reused websocketToken), A's OS-level close finally fires SECONDS later -> ran removeWebSocket() against connection.ws=B -> B.close() + startIdle -> the fresh session is killed and the player stranded in IDLE (anti-farm despawn), where the race can recur. FIX: each adopted socket gets its OWN identity-guarded close handler (tears down ONLY if it is still connection.ws when it fires); setWebSocket now detaches the old socket's listeners + closes it on replace (a superseded socket can neither leak nor fire a stale close/message); removeWebSocket clears connection.ws + the tracked handler. CORE-only. Unit-tested with stub sockets (4 cases: replace discards old, stale close ignored -> B survives, stale message not forwarded, current-socket close still tears down; 3 PROVEN to fail without the guards via neutralize-and-run). core tsc + core lint (0 err) + full suite green | `git revert 24639a8` |
| 182| (latest)    | BUGFIX (medium, found by bug-hunt #5 - client tier): renderer LEAKED a PlayerGraphic on every player/bot removal. The removePlayer handler did delete + playersContainer.removeChild but never destroyed the graphic; PlayerGraphic had NO destroy() and was never destroyed anywhere. removeChild only DETACHES, so each removed player orphaned its name PIXI.Text (a canvas-backed GPU texture) + two PIXI.Graphics geometry buffers, unreclaimable for the session (and the teardown app.destroy passes texture:false, so it never freed the Text textures either). Bot churn (add/clear/fill) fires removePlayer repeatedly -> a GPU/memory leak that can blank the canvas / OOM a phone (mobile is a priority). FIX: added PlayerGraphic.destroy() -- detaches + destroys nameText WITH its texture, then container.destroy({children:true}) frees the Graphics + sprite display objects while the default texture:false PRESERVES the SHARED ship texture -- called from the removePlayer handler AND for every player still present in renderer.destroy(). CLIENT-ONLY. client tsc(4.8.4) + vite build + full suite + client lint green | `git revert <sha>` |
