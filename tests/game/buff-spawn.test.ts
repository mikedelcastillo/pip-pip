import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { GridMapData } from "@pip-pip/game/src/logic/grid-map"
import { BUFF_BLOCK_SIZE } from "@pip-pip/game/src/logic/buff-config"
import { TILE_SIZE } from "@pip-pip/game/src/logic/constants"

// A fixture with a KNOWN mix of empty / solid / deco tiles so we can assert that
// every spawned buff lands on an empty (value 0) tile and never on a
// solid (full) or deco tile. A 14x14 grid (196 cells) leaves plenty of empties
// (>= BUFF_BLOCK_SIZE^2 = 64) so the density target is > 0 and spawning runs.
//
// Layout: a solid full-tile border (ring), one full-tile pillar in the interior,
// and one deco tile in the interior. Everything else is empty/walkable.
//   palette index + 1: 1 = full (solid), 2 = deco (render-only, NOT a spawn cell)
const FULL = 1
const DECO = 2

const FIXTURE_COLS = 14
const FIXTURE_ROWS = 14

// Interior obstacles that are NOT empty (besides the border ring): a full pillar
// and a deco tile. Both must be excluded from buff spawns.
const PILLAR: [number, number] = [5, 7] // [col, row], full/solid
const DECO_CELL: [number, number] = [9, 4] // [col, row], deco

function isBorder(col: number, row: number): boolean{
    return col === 0 || row === 0 || col === FIXTURE_COLS - 1 || row === FIXTURE_ROWS - 1
}

function tileValueAt(col: number, row: number): number{
    if(isBorder(col, row)) return FULL
    if(col === PILLAR[0] && row === PILLAR[1]) return FULL
    if(col === DECO_CELL[0] && row === DECO_CELL[1]) return DECO
    return 0
}

function knownMixMap(): GridMapData{
    const tiles: number[] = new Array(FIXTURE_COLS * FIXTURE_ROWS).fill(0)
    for(let row = 0; row < FIXTURE_ROWS; row++){
        for(let col = 0; col < FIXTURE_COLS; col++){
            tiles[row * FIXTURE_COLS + col] = tileValueAt(col, row)
        }
    }
    // A spawn point so the map is well-formed (validateGridMapData passes).
    return {
        name: "Spawn Fixture",
        cellSize: TILE_SIZE,
        cols: FIXTURE_COLS,
        rows: FIXTURE_ROWS,
        tiles,
        spawns: [[FIXTURE_COLS >> 1, FIXTURE_ROWS >> 1]],
        palette: [
            { key: "wall", shape: "full" },
            { key: "deco", shape: "deco" },
        ],
    }
}

// Count the empty (value 0) tiles in the fixture, the basis for the density
// target floor(emptyTiles / BUFF_BLOCK_SIZE^2).
function countEmptyTiles(): number{
    let empty = 0
    for(let row = 0; row < FIXTURE_ROWS; row++){
        for(let col = 0; col < FIXTURE_COLS; col++){
            if(tileValueAt(col, row) === 0) empty++
        }
    }
    return empty
}

// Map a buff's world position back to its grid cell (inverse of the spawn
// centre formula ((col + 0.5) * cellSize), originCol/originRow = 0 in the fixture).
function cellOf(x: number, y: number): { col: number, row: number }{
    return {
        col: Math.floor(x / TILE_SIZE),
        row: Math.floor(y / TILE_SIZE),
    }
}

// A MATCH-phase game running on the known-mix custom map with spawning enabled.
function makeSpawnGame(){
    const game = new PipPipGame({ spawnBuffs: true })
    game.setCustomMap(knownMixMap())
    game.setPhase(PipPipGamePhase.MATCH)
    return game
}

describe("tile-based buff spawning", () => {
    it("the fixture's density target equals floor(emptyTiles / BLOCK_SIZE^2)", () => {
        const game = makeSpawnGame()
        const empty = countEmptyTiles()
        const expected = Math.floor(empty / (BUFF_BLOCK_SIZE * BUFF_BLOCK_SIZE))
        expect(game.buffDensityTarget()).toBe(expected)
        // Sanity: the fixture is big enough to spawn at least one buff.
        expect(expected).toBeGreaterThan(0)
    })

    it("only ever places buffs on EMPTY tiles, never a solid or deco tile", () => {
        const game = makeSpawnGame()
        // Drive well past the point of reaching the density target so the field
        // is full and we have a healthy sample of placements to inspect.
        for(let i = 0; i < game.BUFF_SPAWN_INTERVAL_TICKS * 30; i++) game.update()

        const active = game.buffs.getActive()
        expect(active.length).toBeGreaterThan(0)
        for(const buff of active){
            const { col, row } = cellOf(buff.position.x, buff.position.y)
            // In range.
            expect(col).toBeGreaterThanOrEqual(0)
            expect(col).toBeLessThan(FIXTURE_COLS)
            expect(row).toBeGreaterThanOrEqual(0)
            expect(row).toBeLessThan(FIXTURE_ROWS)
            // Empty (value 0): never the border ring, the full pillar, or deco.
            expect(tileValueAt(col, row)).toBe(0)
        }
    })

    it("never places two active buffs on the same tile cell", () => {
        const game = makeSpawnGame()
        for(let i = 0; i < game.BUFF_SPAWN_INTERVAL_TICKS * 30; i++) game.update()

        const seen = new Set<string>()
        for(const buff of game.buffs.getActive()){
            const { col, row } = cellOf(buff.position.x, buff.position.y)
            const key = `${col},${row}`
            expect(seen.has(key)).toBe(false)
            seen.add(key)
        }
    })

    it("converges to AT MOST the density target active buffs", () => {
        const game = makeSpawnGame()
        const target = game.buffDensityTarget()
        for(let i = 0; i < game.BUFF_SPAWN_INTERVAL_TICKS * 50; i++) game.update()

        const active = game.buffs.getActive().length
        expect(active).toBeGreaterThan(0)
        expect(active).toBeLessThanOrEqual(target)
        // With far more intervals than the target needs, the field should be full.
        expect(active).toBe(target)
    })

    it("adds at most one buff per spawn interval", () => {
        const game = makeSpawnGame()
        const interval = game.BUFF_SPAWN_INTERVAL_TICKS

        let previous = game.buffs.getActive().length
        // Step a tick at a time over several intervals and record the per-tick
        // growth in the active count. No single tick may add more than one.
        for(let i = 0; i < interval * 6; i++){
            game.update()
            const current = game.buffs.getActive().length
            const added = current - previous
            expect(added).toBeLessThanOrEqual(1)
            expect(added).toBeGreaterThanOrEqual(0) // spawning never removes a buff here
            previous = current
        }
    })

    it("adds no more than one buff across each full interval window", () => {
        const game = makeSpawnGame()
        const interval = game.BUFF_SPAWN_INTERVAL_TICKS

        // Across any single interval-length window the active count grows by at
        // most BUFF_SPAWN_PER_INTERVAL (= 1), proving the cadence gate.
        for(let window = 0; window < 5; window++){
            const before = game.buffs.getActive().length
            for(let i = 0; i < interval; i++) game.update()
            const after = game.buffs.getActive().length
            expect(after - before).toBeLessThanOrEqual(1)
        }
    })
})
