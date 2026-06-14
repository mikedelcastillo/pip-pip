// ─────────────────────────────────────────────────────────────────────────
//  MOVEMENT / PHYSICS TUNING CONFIG  —  tweak these to change how ships FEEL
// ─────────────────────────────────────────────────────────────────────────
//
// One place to tune ship movement. These values flow into the default ship
// stats (see DEFAULT_SHIP_STATS in ship.ts) and the per-ship physics body, and
// are read by computeMovementAcceleration (index.ts). The SAME numbers run on
// both the client (prediction) and the server (authority), so changing them
// never desyncs the two — it just changes the feel everywhere at once.
//
// Reconciliation note: stronger `friction` makes a ship's velocity decay quickly
// once you stop steering, so the client's prediction and the authoritative
// server sim converge fast (little leftover momentum to drift on). `acceleration`
// and `agility` control how "free"/snappy the ship feels to push around.
//
// Quick guide:
//   • Want it to feel FREER / snappier  → raise `acceleration` and/or `agility`.
//   • Want a higher TOP SPEED           → raise `maxSpeed`.
//   • Want it to STOP faster / reconcile
//     more cleanly / feel less floaty    → raise `friction`.
//   • Want more knockback on collisions  → raise `mass`.

export const MOVEMENT_CONFIG = {
    // Per-tick drag applied to a ship's velocity (the physics body's
    // airResistance): velocity *= (1 - friction)^deltaTime each tick. Higher =
    // the ship slows and stops faster — snappier, and easier for the server to
    // reconcile because momentum bleeds off quickly. (Was 0.05.)
    friction: 0.07,

    // Base movement acceleration toward the input direction. Higher = the ship
    // gets up to speed and changes direction faster, i.e. feels freer. (Was 4.)
    acceleration: 5,

    // Base top-speed stat. The real cap is derived from this and `friction` in
    // computeMovementAcceleration; higher = faster overall. (Was 30.)
    maxSpeed: 30,

    // Steering responsiveness, 0..1. Higher = the ship redirects more freely
    // instead of being locked to its current heading. (Was 0.6.)
    agility: 0.7,

    // Ship body mass — affects collision response / knockback, not top speed.
    mass: 500,
}

// The default ship's low/normal/high stat ranges are derived from the single
// base values above, preserving the original range SHAPE (the spread between
// low and high) so per-ship balance stays consistent while one knob moves the
// centre. Override per ship in PIP_SHIPS if a specific bird should differ.
export const MOVEMENT_ACCEL_RANGE = {
    low: MOVEMENT_CONFIG.acceleration * 0.75,
    normal: MOVEMENT_CONFIG.acceleration,
    high: MOVEMENT_CONFIG.acceleration * 1.5,
}

export const MOVEMENT_SPEED_RANGE = {
    low: MOVEMENT_CONFIG.maxSpeed * (25 / 30),
    normal: MOVEMENT_CONFIG.maxSpeed,
    high: MOVEMENT_CONFIG.maxSpeed * (35 / 30),
}
