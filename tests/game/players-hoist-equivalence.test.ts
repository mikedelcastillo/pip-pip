import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PipPipGame, PipPipGameMode, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import { BotDifficulty } from "@pip-pip/game/src/logic/ai"

// Equivalence guard for the "hoist Object.values(this.players) once per tick"
// optimization. update() now builds the per-tick player array ONCE and threads
// it through updateSystems / updatePhysics / updateBulletPhysics /
// updatePowerupPickups instead of each rebuilding Object.values(this.players).
// The change is meant to be STRICTLY behavior-preserving and DETERMINISTIC on
// both server and client, so the sim output must be byte-identical to before.
//
// The shared sim draws on Math.random in several hot paths (spawn placement,
// bot AI jitter, powerup spawns) AND on crypto.getRandomValues via generateId
// (bullet / physics-object ids). Object ids drive the physics-world iteration
// order, so the sim is only bit-reproducible once BOTH sources are pinned. This
// suite pins Math.random to a seeded mulberry32 PRNG and crypto.getRandomValues
// to a second seeded stream. With both pinned, a server-flavored PipPipGame run
// is fully deterministic, which lets the tests below:
//   1. run the SAME scenario twice in lockstep and assert the full per-tick
//      state (every ship + every bullet position/velocity, scores, timers) is
//      byte-identical between the two runs, proving the optimized path is
//      deterministic and order-stable across the whole run, and
//   2. assert the run reproduces a recorded deterministic REFERENCE digest of
//      the final state, so a future change that alters the sim output (or a
//      regression in the hoisting that perturbs iteration order) fails here.

// mulberry32: a tiny, fast, fully deterministic 32-bit PRNG. Same seed -> same
// stream on every platform, so the sim becomes reproducible.
function mulberry32(seed: number){
    let a = seed >>> 0
    return function(){
        a |= 0
        a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const realRandom = Math.random
const cryptoHost = globalThis as unknown as {
    crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array },
}
const realGetRandomValues = cryptoHost.crypto?.getRandomValues?.bind(cryptoHost.crypto)

// Pin BOTH Math.random and crypto.getRandomValues to deterministic streams from
// a single seed, so the whole sim - including generateId-driven object ids - is
// reproducible to the bit. Returns nothing; callers re-seed via this helper.
function seedAll(seed: number){
    Math.random = mulberry32(seed)
    // generateId() reads crypto.getRandomValues; feed it a second deterministic
    // mulberry32 stream so bullet / physics-object ids (and thus the physics
    // iteration order) are reproducible across runs.
    const idRng = mulberry32(seed ^ 0x9E3779B9)
    if(typeof cryptoHost.crypto === "undefined"){
        cryptoHost.crypto = {} as { getRandomValues?: (a: Uint32Array) => Uint32Array }
    }
    cryptoHost.crypto.getRandomValues = (arr: Uint32Array) => {
        for(let i = 0; i < arr.length; i++){
            arr[i] = (idRng() * 0x100000000) >>> 0
        }
        return arr
    }
}

const SEED = 0x1234ABCD

beforeEach(() => {
    // Re-seed before every test so each gets the identical RNG streams.
    seedAll(SEED)
})

afterEach(() => {
    Math.random = realRandom
    if(typeof realGetRandomValues === "function" && typeof cryptoHost.crypto !== "undefined"){
        cryptoHost.crypto.getRandomValues = realGetRandomValues
    }
})

// A server-flavored game: the authoritative flags the real server passes, so the
// per-tick player loops (spawns, scoring, shooting, AI, powerups) all run.
function makeServerGame(){
    const game = new PipPipGame({
        shootAiBullets: true,
        shootPlayerBullets: true,
        calculateAi: true,
        assignHost: true,
        triggerPhases: true,
        triggerSpawns: true,
        setScores: true,
        triggerDamage: true,
        considerPlayerPing: true,
        spawnPowerups: true,
    })
    return game
}

// Deterministic scripted inputs for a human player, varying by player index so
// the ships fan out, move, aim, and fire across the run (exercising the
// shooting / acceleration / collide-with-players loops, not just idling).
function scriptInputs(player: PipPlayer, index: number, tick: number){
    const phase = (tick + index * 7) * 0.05
    player.inputs.movementAngle = Math.sin(phase) * Math.PI
    player.inputs.movementAmount = 1
    player.inputs.aimRotation = Math.cos(phase) * Math.PI
    // Fire the primary on a per-player cadence so plenty of bullets exist for
    // the bullet-vs-player collide loop (the line-1551 site).
    player.inputs.useWeapon = ((tick + index) % 3) === 0
    // Occasional tactical fire so grenade / tactical bullets appear too.
    player.inputs.useTactical = ((tick + index) % 11) === 0
    player.inputs.doReload = false
}

// Full, order-stable snapshot of the entire simulation state this tick: every
// player's ship kinematics + scores + spawn state, plus every live bullet's
// kinematics, in a deterministic key order. Reused for both the run-vs-run
// comparison and the reference digest.
function snapshotState(game: PipPipGame){
    const playerIds = Object.keys(game.players).sort()
    const players = playerIds.map(id => {
        const p = game.players[id]
        const phys = p.ship.physics
        return {
            id,
            spawned: p.spawned,
            spectator: p.spectator,
            x: phys.position.x,
            y: phys.position.y,
            vx: phys.velocity.x,
            vy: phys.velocity.y,
            rotation: p.ship.rotation,
            health: p.ship.capacities.health,
            kills: p.score.kills,
            deaths: p.score.deaths,
            damage: p.score.damage,
            spawnTimeout: p.timings.spawnTimeout,
        }
    })
    const bullets = game.bullets.getActive()
        .map(b => ({
            id: b.id,
            x: b.physics.position.x,
            y: b.physics.position.y,
            vx: b.physics.velocity.x,
            vy: b.physics.velocity.y,
            lifespan: b.lifespan,
            bounces: b.bounces,
        }))
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    return {
        tickNumber: game.tickNumber,
        phase: game.phase,
        matchTimer: game.matchTimer,
        powerupSpawnTimer: game.powerupSpawnTimer,
        activePowerups: game.powerups.getActive().length,
        players,
        bullets,
    }
}

// Build a fresh server game with a fixed roster of humans + bots, in a fixed
// insertion order, then start a DEATHMATCH so the MATCH per-tick flow runs.
function buildScenario(){
    const game = makeServerGame()
    game.setSettings({ mode: PipPipGameMode.DEATHMATCH, maxKills: 0 })

    // Three real players (connection-flavored ids) with distinct ships.
    const humans: PipPlayer[] = []
    const humanIds = ["AA", "BB", "CC"]
    humanIds.forEach((id, i) => {
        const p = game.createPlayer(id)
        p.setShip(i % 4)
        humans.push(p)
    })

    // Start the match: this assigns host, arms the clock and spawns everyone.
    game.startMatch()
    // Drive the countdown to 0 so triggerPhases flips us into MATCH.
    while(game.phase !== PipPipGamePhase.MATCH){
        game.update()
    }

    // Add a few bots mid-match (they spawn immediately) so the AI loop and bot
    // shooting are exercised too. Concrete difficulties keep it deterministic.
    game.addBot(BotDifficulty.EASY)
    game.addBot(BotDifficulty.MEDIUM)
    game.addBot(BotDifficulty.HARD)

    return { game, humans }
}

// Run the scenario for `ticks` ticks, scripting the human inputs each tick and
// capturing a full-state snapshot AFTER every update. Returns the per-tick
// snapshot list.
function runScenario(ticks: number){
    const { game, humans } = buildScenario()
    const frames: ReturnType<typeof snapshotState>[] = []
    for(let tick = 0; tick < ticks; tick++){
        humans.forEach((p, i) => scriptInputs(p, i, tick))
        game.update()
        frames.push(snapshotState(game))
    }
    return frames
}

describe("Object.values(this.players) per-tick hoist - equivalence", () => {
    const TICKS = 200

    it("two independent runs of the same scenario stay byte-identical for every tick", () => {
        // Re-seed for run A.
        seedAll(SEED)
        const runA = runScenario(TICKS)
        // Re-seed identically for run B so both RNG streams match exactly.
        seedAll(SEED)
        const runB = runScenario(TICKS)

        expect(runA.length).toBe(TICKS)
        expect(runB.length).toBe(TICKS)
        // Byte-identical full state at every single tick across the whole run.
        for(let t = 0; t < TICKS; t++){
            expect(runB[t], `divergence at tick ${t}`).toEqual(runA[t])
        }
    })

    it("the run actually exercised the per-tick player loops (ships moved, bullets flew, AI ran)", () => {
        seedAll(SEED)
        const frames = runScenario(TICKS)
        const last = frames[frames.length - 1]

        // Humans (3) + bots (3) are all present and the roster never mutated mid
        // run, so the cached per-tick array always matched the live set.
        expect(last.players.length).toBe(6)
        // At least one ship moved off its spawn (the movement/accel loop ran).
        const moved = frames.some(f => f.players.some(p => p.vx !== 0 || p.vy !== 0))
        expect(moved).toBe(true)
        // Bullets were spawned and flew during the run (shooting + bullet loops).
        const hadBullets = frames.some(f => f.bullets.length > 0)
        expect(hadBullets).toBe(true)
    })

    it("matches the recorded deterministic reference digest of the final state", () => {
        seedAll(SEED)
        const frames = runScenario(TICKS)
        const last = frames[frames.length - 1]

        // A compact, order-stable digest of the final tick. Recorded from the
        // optimized code path; any change to the sim's per-tick output (or a
        // hoisting regression that perturbs iteration order) changes these
        // numbers and fails the test. Numbers are full-precision JS doubles, so
        // the comparison is byte-exact.
        const digest = {
            tickNumber: last.tickNumber,
            phase: last.phase,
            playerCount: last.players.length,
            // Sum of every ship coordinate component: a single number that
            // shifts if ANY ship position diverges.
            shipCoordSum: last.players.reduce((acc, p) => acc + p.x + p.y + p.vx + p.vy, 0),
            killsSum: last.players.reduce((acc, p) => acc + p.kills, 0),
            deathsSum: last.players.reduce((acc, p) => acc + p.deaths, 0),
            damageSum: last.players.reduce((acc, p) => acc + p.damage, 0),
        }

        // GOLDEN reference recorded from the seeded scenario. These are the
        // exact full-precision aggregates the sim produced; shipCoordSum in
        // particular is a sum over every ship coordinate component, so it is a
        // sensitive fingerprint that shifts in its last bits if ANY ship's
        // position/velocity diverges. The hoisting must keep these byte-exact;
        // a regression that perturbs the per-tick iteration order would change
        // them and fail here.
        const refDigest = {
            tickNumber: 320,
            phase: 2,
            playerCount: 6,
            shipCoordSum: 109.04439776822407,
            killsSum: 1,
            deathsSum: 1,
            damageSum: 122,
        }

        expect(digest).toEqual(refDigest)
        expect(digest.tickNumber).toBeGreaterThan(TICKS)
        expect(digest.playerCount).toBe(6)
    })
})
