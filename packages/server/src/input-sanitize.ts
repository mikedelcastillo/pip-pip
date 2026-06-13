// Hostile clients can put NaN / Infinity into the float16 fields of the
// playerInputs packet (e.g. float16 0x7E00 decodes to NaN). Those values flow
// straight into trig/movement and are rebroadcast to every other client,
// poisoning the whole simulation. Sanitize on ingest, before the inputs are
// queued, so the authoritative sim only ever sees finite, in-range numbers.

const TWO_PI = Math.PI * 2

// Wrap an angle (radians) into [0, 2*PI). Non-finite inputs collapse to 0.
function normalizeAngle(angle: number){
    if(!Number.isFinite(angle)) return 0
    const wrapped = angle % TWO_PI
    return wrapped < 0 ? wrapped + TWO_PI : wrapped
}

// Clamp the movement magnitude into [0, 1]. Non-finite inputs collapse to 0.
function clampAmount(amount: number){
    if(!Number.isFinite(amount)) return 0
    if(amount < 0) return 0
    if(amount > 1) return 1
    return amount
}

export type RawPlayerInputFloats = {
    movementAngle: number,
    movementAmount: number,
    aimRotation: number,
}

export type SanitizedPlayerInputFloats = RawPlayerInputFloats

// Pure sanitizer for the float fields of a playerInputs packet. Valid inputs
// pass through untouched; hostile/garbage values become safe finite numbers.
export function sanitizePlayerInputs(inputs: RawPlayerInputFloats): SanitizedPlayerInputFloats{
    return {
        movementAngle: normalizeAngle(inputs.movementAngle),
        movementAmount: clampAmount(inputs.movementAmount),
        aimRotation: normalizeAngle(inputs.aimRotation),
    }
}
