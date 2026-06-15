// Single source of truth for power-up tuning: how often they spawn, how densely
// they fill the map, how likely each type is, and how long the timed buffs last.
// Imported by powerup.ts (durations + stack clamp), index.ts (spawn cadence,
// density, weighted type pool) and re-exported from powerup.ts so existing
// duration importers (client store/feed) keep their `.../logic/powerup` path.
//
// `import type` (erased at runtime) so this file has no runtime dependency on
// powerup.ts, even though powerup.ts imports values from here -- no import cycle.
import type { PowerupType } from "./powerup"

// The game runs at a fixed 20 ticks per second; all timers are in ticks.
const TICKS_PER_SECOND = 20

// Density: one power-up per BLOCK_SIZE x BLOCK_SIZE block of tiles. At 8 that is
// one per 64 tiles. The match keeps spawning (one at a time, see below) until the
// number of active power-ups reaches floor(emptyTiles / BLOCK_SIZE^2), so bigger
// open maps fill with proportionally more power-ups.
export const POWERUP_BLOCK_SIZE = 8

// Spawn cadence: a spawn is attempted once every this many ticks during MATCH.
// 120 ticks = 6 seconds.
export const POWERUP_SPAWN_INTERVAL_TICKS = TICKS_PER_SECOND * 6

// How many power-ups to place on each interval. One at a time, so the map fills
// in gradually toward the density target rather than all at once.
export const POWERUP_SPAWN_PER_INTERVAL = 1

// Relative spawn frequency per type, as weighted-random tickets (a type with
// double the weight appears roughly twice as often). health + shield are the most
// common; the strong cloak (invis) and ricochet are the rarest. Instant types
// (health/ammo) and timed buffs share one pool.
export const POWERUP_SPAWN_WEIGHTS: Record<PowerupType, number> = {
    health: 5,
    shield: 5,
    ammo: 3,
    haste: 3,
    rapidfire: 2,
    ricochet: 1,
    invis: 1,
}

// Upper bound for any single timed-buff timer, in ticks. Buffs STACK (re-grabbing
// adds to the remaining time, see applyPowerupEffect) so the running total is
// clamped here to stay within the uint16 the playerShipTimings packet uses
// (65535 ticks ~= 54 minutes -- effectively unreachable, just wire-safety).
export const MAX_BUFF_TICKS = 65535

// Timed-buff durations granted per pickup, in ticks. Instant types (health/ammo)
// have no duration. These exceed the old uint8 (255-tick) cap, which is why the
// playerShipTimings wire fields were widened to uint16.
export const HASTE_TICKS = TICKS_PER_SECOND * 10 // 200 ticks (10s)
export const SHIELD_TICKS = TICKS_PER_SECOND * 15 // 300 ticks (15s)
export const INVIS_TICKS = TICKS_PER_SECOND * 20 // 400 ticks (20s)
export const RICOCHET_TICKS = TICKS_PER_SECOND * 30 // 600 ticks (30s)
export const RAPIDFIRE_TICKS = TICKS_PER_SECOND * 30 // 600 ticks (30s)
