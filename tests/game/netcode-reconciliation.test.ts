import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer, isInputSeqAfter, MAX_PREDICTED_STATES } from "@pip-pip/game/src/logic/player"
import type { PlayerInputs } from "@pip-pip/game/src/logic/player"

const BLU = 3

function makeGame(){
    const game = new PipPipGame({})
    for(const seg of game.map.segWalls) game.physics.removeSegWall(seg)
    for(const rect of game.map.rectWalls) game.physics.removeRectWall(rect)
    game.map.bounds.min.x = -1000000
    game.map.bounds.min.y = -1000000
    game.map.bounds.max.x = 1000000
    game.map.bounds.max.y = 1000000
    game.setPhase(PipPipGamePhase.MATCH)
    return game
}

const INPUT: PlayerInputs = {
    movementAngle: 0,
    movementAmount: 1,
    aimRotation: 0,
    useWeapon: false,
    useTactical: false,
    doReload: false,
    spawn: false,
}

describe("isInputSeqAfter (wrap-safe uint16)", () => {
    it("orders within the normal range", () => {
        expect(isInputSeqAfter(5, 3)).toBe(true)
        expect(isInputSeqAfter(3, 5)).toBe(false)
        expect(isInputSeqAfter(3, 3)).toBe(false)
    })
    it("handles the uint16 wrap boundary", () => {
        expect(isInputSeqAfter(1, 65535)).toBe(true)
        expect(isInputSeqAfter(65535, 1)).toBe(false)
    })
})

describe("PipPlayer.advanceInputSeq", () => {
    it("increments monotonically and wraps at uint16", () => {
        const game = makeGame()
        const p = new PipPlayer(game, "AA")
        expect(p.inputSeq).toBe(0)
        p.advanceInputSeq()
        expect(p.inputSeq).toBe(1)
        p.inputSeq = 65535
        p.advanceInputSeq()
        expect(p.inputSeq).toBe(0)
    })
})

describe("PipPlayer.recordPredictedState", () => {
    it("keys each snapshot by the current inputSeq and caps the buffer", () => {
        const game = makeGame()
        const p = new PipPlayer(game, "AA")
        p.setShip(BLU)
        game.spawnPlayer(p, 0, 0)

        for(let i = 0; i < MAX_PREDICTED_STATES + 10; i++){
            p.advanceInputSeq()
            p.ship.physics.position.x = i
            p.recordPredictedState()
        }

        expect(p.predictedStates.length).toBe(MAX_PREDICTED_STATES)
        // Oldest dropped: the buffer holds the most recent MAX states.
        expect(p.predictedStates[0].positionX).toBe(10)
        expect(p.predictedStates[p.predictedStates.length - 1].positionX).toBe(MAX_PREDICTED_STATES + 9)
    })
})

describe("PipPlayer.reconcileTo", () => {
    it("shifts the current position by the prediction error at the acked seq", () => {
        const game = makeGame()
        const p = new PipPlayer(game, "AA")
        p.setShip(BLU)
        game.spawnPlayer(p, 100, 100)

        // Three predicted frames along +x.
        for(const x of [110, 120, 130]){
            p.advanceInputSeq()
            p.ship.physics.position.x = x
            p.ship.physics.position.y = 100
            p.recordPredictedState()
        }
        // seqs are 1,2,3 at x=110,120,130; current position is 130.

        // Server acked seq 2 with authoritative x=122 (we predicted 120 → +2 error).
        p.reconcileTo(122, 100, 0, 0, 2)

        // Current (130) shifted by the +2 error → 132.
        expect(p.ship.physics.position.x).toBe(132)
        expect(p.ship.physics.position.y).toBe(100)
        // Acknowledged frames (seq <= 2) dropped; only seq 3 remains.
        expect(p.predictedStates.map(s => s.seq)).toEqual([3])
    })

    it("hard-resyncs to authoritative state when no prediction matches the acked seq", () => {
        const game = makeGame()
        const p = new PipPlayer(game, "AA")
        p.setShip(BLU)
        game.spawnPlayer(p, 0, 0)
        p.advanceInputSeq()
        p.ship.physics.position.x = 10
        p.recordPredictedState()

        // Ack a seq we never recorded (e.g. cold start / just after a spawn that
        // cleared predictedStates): snap straight to authoritative state.
        p.reconcileTo(500, 600, 7, 8, 9999)
        expect(p.ship.physics.position.x).toBe(500)
        expect(p.ship.physics.position.y).toBe(600)
        expect(p.ship.physics.velocity.x).toBe(7)
        expect(p.ship.physics.velocity.y).toBe(8)
        expect(p.predictedStates.length).toBe(0)
    })

    it("leaves a perfectly-predicted ship untouched (zero error → no shift)", () => {
        const game = makeGame()
        const p = new PipPlayer(game, "AA")
        p.setShip(BLU)
        game.spawnPlayer(p, 0, 0)
        p.advanceInputSeq()
        p.ship.physics.position.x = 50
        p.recordPredictedState()
        p.ship.physics.position.x = 60 // advanced further since the ack

        // Authoritative matches our prediction at seq 1 exactly → no correction.
        p.reconcileTo(50, 0, 0, 0, 1)
        expect(p.ship.physics.position.x).toBe(60)
    })
})

// The PRIMARY root cause of the "others see me severely offset" bug: the client
// never advanced inputSeq, so every input was sent as seq 0. The server's
// wrap-safe dedupe (pushInputFrame) collapses same-seq frames, so whenever two
// inputs arrived in one tick (network batching / the burst right after a
// join/respawn / bad wifi) the server DROPPED all but one — barely simulating
// the player while the client predicted full motion. Advancing seqs fixes it.
describe("input batching: distinct seqs survive, repeated seqs collapse", () => {
    it("keeps every distinct-seq frame queued when several arrive together", () => {
        const game = makeGame()
        const p = new PipPlayer(game, "AA")
        p.pushInputFrame(1, INPUT)
        p.pushInputFrame(2, INPUT)
        p.pushInputFrame(3, INPUT)
        expect(p.inputQueue.length).toBe(3)
    })

    it("collapses repeated seq-0 frames to one (the old, broken client behavior)", () => {
        const game = makeGame()
        const p = new PipPlayer(game, "BB")
        p.pushInputFrame(0, INPUT)
        p.pushInputFrame(0, INPUT)
        p.pushInputFrame(0, INPUT)
        expect(p.inputQueue.length).toBe(1)
    })
})
