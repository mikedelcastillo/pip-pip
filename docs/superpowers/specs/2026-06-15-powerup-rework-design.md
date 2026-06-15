# Power-up rework design

Date: 2026-06-15
Branch: map-recovery-tools

## Goal

Rework when and where power-ups appear: tile-based spawning across the whole map,
a configurable density + cadence, weighted type frequency, longer/stackable timed
buffs, power-ups shown on the minimap, and a cloak bug fix.

## Decisions (from brainstorming)

- **Fill rate:** one power-up every 6 seconds, filling gradually toward a density
  target (not batch-fill, not seed-at-start).
- **Density:** 1 power-up per 8x8 tile block (1 per 64 empty tiles). This density
  target replaces the old hard cap of 4 active.
- **Durations** (timed buffs only; these override the original "15 min" idea with
  the values the user gave): haste 10s, shield 15s, invis 20s, rapidfire 30s,
  ricochet 30s.
- **Stacking:** all timed buffs stack -- re-grabbing the same buff adds to the
  remaining time (clamped to uint16).
- **Shield:** kept as full damage immunity (chaos accepted; short enough at 15s).
- **"On the map":** add power-up dots to the minimap/radar (main view already
  draws them; also reconcile its missing rapidfire color).
- **Cloak fix:** a cloaked ship's health bar (and buff rings) stay visible -- gate
  them on the same alpha as the ship sprite.

## Config (single source of truth)

`packages/game/src/logic/powerup-config.ts`:

| Name | Value | Meaning |
|---|---|---|
| `POWERUP_BLOCK_SIZE` | 8 | 1 power-up per 8x8 tiles |
| `POWERUP_SPAWN_INTERVAL_TICKS` | 120 (6s) | spawn attempt cadence |
| `POWERUP_SPAWN_PER_INTERVAL` | 1 | placed per interval |
| `POWERUP_SPAWN_WEIGHTS` | health 5, shield 5, ammo 3, haste 3, rapidfire 2, ricochet 1, invis 1 | weighted type pool |
| `MAX_BUFF_TICKS` | 65535 | uint16 stack clamp |
| `HASTE/SHIELD/INVIS/RICOCHET/RAPIDFIRE_TICKS` | 200/300/400/600/600 | per-pickup buff durations |

Duration constants live here and are re-exported from `powerup.ts` so existing
importers keep working.

## Changes

1. **`powerup-config.ts`** (new) -- the table above.
2. **`powerup.ts`** -- import durations + `MAX_BUFF_TICKS` from config; re-export
   durations; remove the old in-file duration constants + the stale `<=255`
   comment; `applyPowerupEffect` stacks the 5 timed buffs (`+=`, clamped to
   `MAX_BUFF_TICKS`). health = capped-add, ammo = refill (unchanged).
3. **`index.ts`** -- replace `randomPowerupPosition` (spawn-point based) with
   tile-based placement: read `GridMapData` off the live `GridPipGameMap`
   (`instanceof`), cache the list of empty (palette 0) tile centers per map load,
   pick a random free (unoccupied) tile, center = `(col+originCol+0.5)*cellSize`.
   `deco` excluded (collision-safe). Replace `POWERUP_MAX_ACTIVE` with a density
   target `floor(emptyTiles / BLOCK_SIZE^2)`. Source interval/weights from config.
   Invalidate the tile cache in `setMap`/`setCustomMap`.
4. **`networking/packets.ts`** -- `playerShipTimings`: widen the 5 buff fields
   (`haste`, `shield`, `invisibility`, `ricochet`, `rapidfire`) from `$uint8` to
   `$uint16`. Leave `invincibility` (spawn protection) and the weapon timers as
   `$uint8`.
5. **client `renderer.ts`** -- after the name-alpha line, gate the health bar
   (`overlayGraphic.alpha = shipContainer.alpha`) and buff rings
   (`buffGraphic.alpha = shipContainer.alpha`) on the cloak alpha. Add the missing
   `rapidfire` color to `PowerupGraphic.COLORS`.
6. **client `Minimap.tsx`** -- draw a colored dot per active power-up
   (`game.powerups.getActive()`, `worldToMinimap`), under the player dots, using
   the store's `POWERUP_COLORS`.
7. **client `store.ts`** -- clamp the buff-bar fraction to [0,1] so a stacked buff
   (ticks > single-pickup max) doesn't overflow the bar. Durations follow the
   re-exported config values automatically.
8. **tests** -- rewrite the 2 `POWERUP_MAX_ACTIVE` assertions; add tile placement
   (never on a solid tile, never overlapping another power-up), density target, 6s
   cadence, uint16 round-trip of a 600-tick buff, and buff stacking.

## Risks / notes

- uint16 widening is mandatory: 300/400/600-tick buffs overflow uint8 (255).
- `makeArena` strips physics walls but leaves `map.source` intact, so tile-based
  spawning still finds empty tiles there; placement tests that need known solids
  use a `GridMapData` fixture via `setCustomMap`.
- Bot AI seek/grab ranges were tuned for a sparse 4-power-up field; with density
  spawning bots will more often have one in range. Out of scope, noted.
