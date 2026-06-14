import { describe, expect, it } from "vitest"
import { PipPipGame } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import type { PlayerInputs } from "@pip-pip/game/src/logic/player"
import { SERVER_INPUT_QUEUE_MAX } from "@pip-pip/game/src/logic/constants"

const INPUT: PlayerInputs = {
    movementAngle: 0,
    movementAmount: 1,
    aimRotation: 0,
    useWeapon: false,
    useTactical: false,
    doReload: false,
    spawn: false,
}

describe("PipPlayer.pushInputFrame queue cap (H4)", () => {
    it("never lets the input queue exceed SERVER_INPUT_QUEUE_MAX at ingest", () => {
        const game = new PipPipGame({})
        const player = new PipPlayer(game, "AA")

        // Flood the queue far beyond the cap WITHOUT consuming. Pre-fix the queue
        // grew unbounded until the next consume; now ingest itself bounds it.
        for(let seq = 1; seq <= 1000; seq++){
            player.pushInputFrame(seq, INPUT)
            expect(player.inputQueue.length).toBeLessThanOrEqual(SERVER_INPUT_QUEUE_MAX)
        }

        expect(player.inputQueue.length).toBe(SERVER_INPUT_QUEUE_MAX)
    })

    it("keeps the MOST RECENT inputs when over the cap (drops oldest)", () => {
        const game = new PipPipGame({})
        const player = new PipPlayer(game, "BB")

        for(let seq = 1; seq <= 100; seq++){
            player.pushInputFrame(seq, INPUT)
        }

        // The retained window is the newest SERVER_INPUT_QUEUE_MAX seqs.
        const seqs = player.inputQueue.map(frame => frame.seq)
        const expected: number[] = []
        for(let seq = 100 - SERVER_INPUT_QUEUE_MAX + 1; seq <= 100; seq++) expected.push(seq)
        expect(seqs).toEqual(expected)
    })

    it("still rejects stale / duplicate seqs before enqueueing", () => {
        const game = new PipPipGame({})
        const player = new PipPlayer(game, "CC")

        player.pushInputFrame(10, INPUT)
        const lengthAfterFirst = player.inputQueue.length
        // Duplicate seq — ignored.
        player.pushInputFrame(10, INPUT)
        // Older seq — ignored.
        player.pushInputFrame(5, INPUT)
        expect(player.inputQueue.length).toBe(lengthAfterFirst)
    })

    it("consumes the freshest input after an ingest flood", () => {
        const game = new PipPipGame({})
        const player = new PipPlayer(game, "DD")
        player.setSpawned(true)

        for(let seq = 1; seq <= 50; seq++){
            player.pushInputFrame(seq, INPUT)
        }
        // Consuming one pulls the oldest retained frame; lastProcessedInputSeq
        // should be within the retained (recent) window, never an ancient seq.
        player.consumeQueuedInput()
        expect(player.lastProcessedInputSeq).toBeGreaterThanOrEqual(50 - SERVER_INPUT_QUEUE_MAX + 1)
    })
})
