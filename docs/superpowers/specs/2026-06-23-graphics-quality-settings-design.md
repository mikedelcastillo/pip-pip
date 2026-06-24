# Graphics Quality Settings (Simple / Normal / Max) with Auto-Scaling

Status: approved design, pending implementation plan
Date: 2026-06-23
Branch: graphics-quality-settings

## Problem and goal

A real player (the author's niece, in the Philippines on an older iPad) reports the
deployed game feels laggy. Investigation ruled out the server and the network:

- The Railway server is idle and healthy: CPU peaked at 0.04 of 8 vCPU (about 0 percent),
  memory 91 MB of 8 GB, HTTP p99 6 ms.
- Players are in the Philippines and the server is in Singapore (`asia-southeast1`),
  so round-trip time is roughly 30 to 50 ms. Network geography is not the cause.
- Client-side interpolation already exists for the local player, so input feel is not
  gated on server round-trips.

The cause is a client GPU/fill-rate regression introduced in the PIXI 8 rendering
overhaul (PR #15, deployed 2026-06-17, the same week the complaint arose). The renderer
runs an always-on full-screen post-processing stack with no way to turn it down and no
device adaptation:

- `AdvancedBloomFilter` is added to `app.stage.filters` unconditionally with
  `blur: 6, quality: 4` (`packages/client/src/game/renderer.ts:582-588`,
  `rebuildStageFilters` at `:1460-1474`). A high-quality bloom is a multi-pass
  full-screen effect.
- A `BulgePinchFilter` is also always-on in the same stack.
- The renderer resolution is `Math.min(window.devicePixelRatio, 2)`
  (`renderer.ts:856-877`). On a Retina iPad that is 2x, so every full-screen filter
  pass runs over four times the pixels.
- There is no quality setting, FPS cap, or adaptive degradation. The only existing
  graphics control is a CRT toggle, which *adds* another pass.

Bloom cost scales with screen pixels times passes times resolution squared, and it runs
every frame even in an idle world, independent of player count (which is why the "idle
server, low player count" facts do not exempt it). On a weak mobile GPU this drops the
frame rate from 60 fps to roughly 20 to 30 fps, which reads as "laggy."

Goal: give players a graphics quality control with three tiers and an automatic mode
that scales effects down on weak devices, so the game runs smoothly on old iPads while
keeping the current look on capable machines and offering a richer look on strong ones.

## Requirements

1. Three named tiers:
   - **Simple**: scaled-back effects for weak devices (old iPads).
   - **Normal**: exactly today's look. This is the baseline.
   - **Max**: Normal plus additional effects.
2. An **Auto** mode (the default) that:
   - picks an initial tier from cheap device signals at startup, and
   - watches frame rate during play and drops a tier if the game stays choppy.
3. Manual selection of a tier pins it and disables Auto.
4. The control appears both on the home page settings and in the in-game settings.
5. Settings persist across reloads (localStorage), matching the existing pattern.

## Non-goals (explicitly out of scope)

- Remote-player snapshot interpolation and local `renderError` smoothing. The
  investigation found these are scaffolded but unimplemented
  (`packages/client/src/game/client.ts` snapshot intake; `player.snapshots[]` never
  populated). They are latent and preexisting, only matter when multiple humans play
  under network jitter, and are unrelated to the iPad FPS symptom. Tracked as a separate
  follow-up.
- Multi-region or relocating the Railway deployment. Players are near Singapore; RTT is
  fine.
- The `harden-gpu-mutation-deferral` branch. It is useful hygiene (it coalesces
  redundant `setMap` GPU rebuilds and adds error isolation and hidden-tab handling) but
  it does not change the bloom or resolution cost, so it is not part of this fix. It can
  be deployed independently.
- Auto-upgrading the tier mid-session. The watchdog only ever lowers quality within a
  session, to avoid oscillation.

## Architecture

A single source of truth for "what each tier means," consumed by the renderer, the
store, and the watchdog. This follows the existing pure-module pattern already used by
`store/graphicsSettings.ts` and `store/audioSettings.ts` (dependency-free, DOM-free,
unit-testable under vitest).

### New module: `packages/client/src/store/graphicsQuality.ts` (pure, no imports)

Holds the tier vocabulary, the tier-to-profile map, and the two pure decision functions.

```ts
export type GraphicsQuality = "simple" | "normal" | "max"

// A QualityProfile is the full set of renderer knobs a tier controls. The renderer
// reads ONLY this; it never branches on the tier name itself.
export interface QualityProfile {
    // Renderer resolution cap. Effective resolution is min(devicePixelRatio, cap).
    resolutionCap: number
    // Full-screen stage filters.
    bloom: boolean
    bulge: boolean
    shockwave: boolean        // transient grenade ring (full-screen)
    displacement: boolean     // Max-only ambient space distortion
    glitchOnExplosions: boolean // Max-only transient glitch burst on big detonations
    // Per-ship and world effects.
    cloakShimmer: boolean     // RGB-split filter on a cloaked ship (else fade-only)
    shipTrails: boolean       // Max-only persistent motion trail behind ships
    thrusterParticles: boolean
    maxParticles: number      // cap fed into the particle system
    starCount: number
    // Bloom tuning (only read when bloom is true).
    bloomQuality: number
    bloomBlur: number
    bloomResolution: number   // render bloom at a fraction of screen res
    // Whether the CRT opt-in is honored at this tier (forced off on Simple).
    allowCrt: boolean
}

export const QUALITY_PROFILES: Record<GraphicsQuality, QualityProfile> = {
    simple: { /* no full-screen filters, resolutionCap 1, reduced particles/stars, crt off */ },
    normal: { /* today's look: bloom q4 blur6 res1, bulge, shockwave, cloak, full particles, 200 stars */ },
    max:    { /* normal plus displacement, glitchOnExplosions, shipTrails, richer bloom, higher caps */ },
}
```

Concrete profile values:

| Knob | Simple | Normal (today) | Max |
|---|---|---|---|
| resolutionCap | 1 | 2 | 2 |
| bloom | false | true | true |
| bloomQuality / bloomBlur / bloomResolution | n/a | 4 / 6 / 1.0 | 5 / 7 / 1.0 |
| bulge | false | true | true |
| shockwave | false | true | true |
| displacement | false | false | true |
| glitchOnExplosions | false | false | true |
| cloakShimmer | false | true | true |
| shipTrails | false | false | true |
| thrusterParticles | false | true | true |
| maxParticles | low (about 150) | current default | high |
| starCount | 80 | 200 | 200 |
| allowCrt | false | true | true |

Notes:
- Normal must reproduce today's behavior exactly. The current code has bloom always on
  (`quality 4, blur 6`, full resolution), bulge always on, shockwave and cloak active,
  thruster particles on, 200 stars. Normal's profile equals that. This is the safety
  anchor: a regression test asserts Normal renders the same filter stack as today.
- Simple removes every full-screen pass (bloom, bulge, shockwave) and per-ship cloak
  filter, and drops resolutionCap to 1. That combination is the order-of-magnitude GPU
  win on Retina iPads.
- Max layers on the effects the user chose: richer bloom, ambient displacement warp,
  glitch burst on big explosions, persistent ship trails, and higher particle/effect
  caps. The `DisplacementFilter` and `GlitchFilter` already exist and are tuned in the
  renderer constructor but are currently not added to the stage stack; Max wires them in.

### Pure decision functions in the same module

```ts
// Seed an initial tier from cheap, synchronous device signals. Pure: caller passes the
// signals in (no direct navigator/matchMedia access) so it is unit-testable.
export interface DeviceSignals {
    coarsePointer: boolean      // matchMedia("(pointer: coarse)").matches
    deviceMemoryGb?: number     // navigator.deviceMemory (may be undefined)
    hardwareConcurrency?: number
    maxScreenDim: number        // max(screen.width, screen.height) in CSS px
    devicePixelRatio: number
}
export const seedTierFromDevice = (s: DeviceSignals): GraphicsQuality => { /* ... */ }

// Decide the next tier given a window of recent FPS samples. Pure. Returns the same
// tier unless a sustained low-FPS condition warrants a one-step downgrade.
export interface WatchdogState {
    mode: "auto" | GraphicsQuality
    currentTier: GraphicsQuality
    samples: number[]           // recent per-second average FPS values
    warmedUp: boolean           // ignore the first couple seconds after mount
    tabVisible: boolean         // never downgrade while the tab is hidden
}
export const nextTierFromFps = (st: WatchdogState): GraphicsQuality => { /* ... */ }
```

`seedTierFromDevice` heuristic (first cut, tunable): coarse pointer and small screen and
low memory/concurrency seeds `simple`; coarse pointer alone seeds `normal`; otherwise
`normal`. Auto never seeds `max` (Max is opt-in by taste). The watchdog then corrects a
too-optimistic seed downward in the first few seconds of play.

`nextTierFromFps` rule (first cut, tunable): only acts when `mode === "auto"`,
`warmedUp`, and `tabVisible`. If the trailing roughly 3 seconds of samples average below
about 40 fps, return one tier lower (`max` to `normal` to `simple`); never below
`simple`. Otherwise return `currentTier`. Downgrade-only within a session.

### Extend `packages/client/src/store/graphicsSettings.ts`

Add the two new persisted fields next to the existing `crt`, reusing the existing
parse/serialize/read/write structure and its malformed-input fallbacks.

```ts
export interface GraphicsSettings {
    crt: boolean                       // unchanged, orthogonal to tiers
    mode: "auto" | GraphicsQuality     // default "auto"
    autoTier: GraphicsQuality          // tier Auto settled on; default "normal"
}
```

`autoTier` is the remembered result of the seed plus watchdog, persisted so a returning
old iPad starts at Simple without re-probing. When `mode` is a specific tier, that tier
is authoritative and `autoTier` is left untouched. Parsing validates each field against
the allowed strings and falls back to defaults on anything malformed.

### Extend the UI store `packages/client/src/store/ui.ts`

Mirror the existing `crtEnabled` / `setCrtEnabled` wiring:

- State: `graphicsMode` and `graphicsTier` (the resolved effective tier).
- `setGraphicsMode(mode)`: updates state, computes the effective tier (the mode itself,
  or `autoTier` when mode is auto), calls `renderer.applyQuality(profileFor(tier))`,
  and persists via `writeGraphicsSettings`.
- An internal `applyAutoTier(tier)` used by the watchdog: updates `autoTier` and the
  resolved tier and the renderer, persists, only while in auto mode.
- Seed on first load: if there is no persisted `mode` yet, run `seedTierFromDevice` and
  store the result as `autoTier`.

### Extend the renderer `packages/client/src/game/renderer.ts`

- Add a `currentProfile: QualityProfile` field (default the Normal profile) and
  `applyQuality(profile)`:
  - If `resolutionCap` changed, change renderer resolution via
    `this.app.renderer.resize(this.app.screen.width, this.app.screen.height, min(dpr, cap))`,
    queued through the existing `queueGpuMutation` so it drains on the render tick
    (resolution change reallocates GPU targets; this keeps it aligned with the submit,
    consistent with the existing GPU-mutation deferral pattern). Then
    `rebuildStageFilters`.
  - Store the profile and call `rebuildStageFilters`.
- `rebuildStageFilters` consults `currentProfile`: push `shockwaveFilter` only if
  profile.shockwave and active; push `bloomFilter` only if profile.bloom (and apply
  `bloomQuality/bloomBlur/bloomResolution`); push `buldgePinchFilter` only if
  profile.bulge; push `displacementFilter` if profile.displacement; push `crtFilter`
  only if `crtEnabled && profile.allowCrt`.
- Cloak: in the per-player loop, only attach `cloakFilter` when `profile.cloakShimmer`;
  otherwise rely on the alpha fade alone (the alpha logic already exists).
- Particles: feed `profile.maxParticles` into the particle system; skip thruster
  emission when `!profile.thrusterParticles`; set star count from `profile.starCount`
  at init (and when the profile changes, add or hide stars to match).
- Max extras:
  - Ship trails: a lightweight persistent trail behind each ship when
    `profile.shipTrails` (drawn from recent positions, similar to the existing bullet
    trail approach, or an additive particle stream). Gated entirely by the flag.
  - Glitch on explosions: when `profile.glitchOnExplosions`, briefly add `glitchFilter`
    to the stage stack on a grenade/kill detonation and pull it after a short duration,
    reusing the transient pattern already used by the shockwave filter.
  - Displacement: include `displacementFilter` in the stack when enabled; its sprite is
    already created in `init()`.
- CRT: `setCrtEnabled` continues to work but `rebuildStageFilters` only honors it when
  `profile.allowCrt`, so Simple never shows CRT even if the flag is set.

### Watchdog wiring in `packages/client/src/game/index.ts` (GameContext)

GameContext owns `renderTick` (a 60 Hz `Ticker`) which already exposes
`getPerformance().averageTPS` as the live FPS (the DebugOverlay reads it). Add a
once-per-second sampler (a small interval or a counter inside the existing render tick)
that:

- pushes `averageTPS` into a rolling sample window,
- builds the `WatchdogState` from the ui store (mode, current tier, visibility, warmup),
- calls `nextTierFromFps`, and
- if the result differs, calls the store's `applyAutoTier(next)` and shows a brief,
  non-blocking toast ("Lowered graphics for smoother play").

Warmup: ignore the first roughly 2 seconds after the game view mounts. Visibility: read
`document.visibilityState` (or the hidden-tab signal the harden branch introduces if it
lands first) so a backgrounded tab's naturally low FPS never triggers a downgrade.

### UI: `packages/client/src/components/SettingsModal.tsx`

Replace the lone CRT button in the Graphics section with:

- A tier selector row of four buttons: `Auto`, `Simple`, `Normal`, `Max`. The active
  one is accented (reuse `GameButton accent`). When mode is Auto, its label shows the
  resolved tier, for example `Auto - Simple` (using a hyphen, not an em dash).
- The existing CRT toggle remains below, disabled/greyed when the resolved tier is
  Simple (since `allowCrt` is false there).

Because this single modal is already rendered from the home page (`views/Index.tsx`),
the lobby menu (`components/LobbyMenu.tsx`), and the in-game pause menu
(`components/PauseMenu.tsx`), the selector automatically appears both on the home page
and in-game. No new entry points are needed.

## Data flow

1. On first load the ui store seeds `autoTier` from `seedTierFromDevice` (if no persisted
   mode), resolves the effective tier, and on renderer init calls
   `renderer.applyQuality(profileFor(tier))` (right next to where `setCrtEnabled` is
   applied today at `index.ts:141`).
2. During play, the per-second watchdog samples FPS and, in Auto, may lower the tier via
   `applyAutoTier`, which re-applies the profile and persists.
3. In Settings, choosing a tier calls `setGraphicsMode`, which re-applies the profile,
   persists, and (for a specific tier) disables Auto.
4. The renderer only ever reads `currentProfile`; it never knows about modes, the
   watchdog, or persistence.

## Edge cases

- No localStorage / SSR: existing guards in the settings modules already return defaults.
- Resolution change mid-session: routed through `queueGpuMutation` so it runs on the
  render tick, not the update tick, avoiding a GPU resource reallocation racing an
  in-flight submit (the reason the renderer already defers GPU mutations).
- Watchdog oscillation: prevented by downgrade-only-within-session plus the warmup and
  sustained-low-FPS debounce.
- Backgrounded tab: visibility gate prevents a spurious downgrade.
- Manual pin then later choosing Auto again: switching back to Auto resumes from the
  persisted `autoTier` and lets the watchdog adjust from there.
- Profile change while a transient effect is active (shockwave/glitch): `rebuildStageFilters`
  already rebuilds the whole array from current flags, so a tier change cleanly includes
  or drops transient passes.

## Testing

Unit (vitest, pure modules, no DOM), matching the existing `graphicsSettings` test style:

- `graphicsSettings` parse/serialize round-trip including the new `mode` and `autoTier`,
  plus malformed-input fallback for each field.
- `QUALITY_PROFILES` invariants: Simple has no full-screen filters and resolutionCap 1
  and allowCrt false; Normal equals the documented current values (the regression
  anchor); Max is a superset of Normal's effect flags.
- `seedTierFromDevice`: representative device signal sets map to the expected tier
  (old-iPad-like signals to Simple, desktop to Normal).
- `nextTierFromFps`: sustained low FPS downgrades exactly one step; pinned modes never
  change; never goes below Simple; warmup and hidden-tab states never downgrade; healthy
  FPS holds the tier.

Manual (Playwright, both desktop-click and mobile-touch per the mobile-UX rule):

- The selector renders in Settings from the home page and from the in-game pause menu.
- Choosing Simple visibly removes the bloom/glow and lowers crispness; the choice
  persists across a reload.
- Auto on a throttled profile downgrades and shows the toast.

## Build and verification notes

- Gate client changes with `yarn client build` before claiming a deploy passes (client
  TS is its own toolchain).
- Run `yarn clear` before `yarn lint` (stale `dist/*.d.ts` otherwise reports false
  errors).
- Run `yarn test` for the new unit tests.

## File touch list

New:
- `packages/client/src/store/graphicsQuality.ts` (pure: types, profiles, seed + watchdog
  decision functions)
- tests under `tests/` for the above and for the extended settings parsing

Modified:
- `packages/client/src/store/graphicsSettings.ts` (add `mode`, `autoTier`)
- `packages/client/src/store/ui.ts` (ui store: mode/tier state, setters, seed)
- `packages/client/src/game/renderer.ts` (`applyQuality`, profile-aware
  `rebuildStageFilters`, cloak/particle/star gating, Max extras)
- `packages/client/src/game/index.ts` (watchdog sampler; apply quality on init)
- `packages/client/src/components/SettingsModal.tsx` (tier selector UI)
- possibly `packages/client/src/game/particles.ts` (expose particle cap / thruster gate)
