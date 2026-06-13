

export const SHIP_DAIMETER = 64
export const BULLET_DIAMETER = 10

export const TILE_SIZE = 72
export const SPAWN_DIAMETER = TILE_SIZE

export const CHAT_MAX_MESSAGE_LENGTH = 80

export const PING_REFRESH = 2
export const PLAYER_POSITION_TOLERANCE = SHIP_DAIMETER * 2

// Symmetric world-coordinate range used by $quant16 position fields on the
// wire. Must comfortably exceed the largest map extent. Resolution is
// 2*range / 65535 ≈ 0.25 units at 8192, far finer than float16 at these
// magnitudes.
export const WORLD_QUANT_RANGE = 8192

// Client-side ring buffer of unacknowledged local inputs kept for replay.
export const MAX_INPUT_BUFFER = 32
// Server bounds the per-player input queue so a burst (after a TCP stall)
// cannot add unbounded latency; excess oldest inputs are fast-forwarded.
export const SERVER_INPUT_QUEUE_MAX = 6
// Render remote players this many ticks in the past so there are always two
// bracketing snapshots to interpolate between.
export const INTERP_DELAY_TICKS = 2