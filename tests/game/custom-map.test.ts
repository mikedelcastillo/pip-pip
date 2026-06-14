import { describe, expect, it } from "vitest"
import { packetManager, encode } from "@pip-pip/game/src/networking/packets"
import { PipPipGame } from "@pip-pip/game/src/logic"
import { CUSTOM_MAP_INDEX, CUSTOM_MAP_TYPE_ID } from "@pip-pip/game/src/maps"
import { GridMapData } from "@pip-pip/game/src/logic/grid-map"

// A representative custom map: full tiles, a diagonal, deco, spawns and an
// explicit segment, so the round-trip and the wall build exercise real geometry.
function representativeMap(): GridMapData{
    return {
        name: "Arena",
        cellSize: 64,
        cols: 3,
        rows: 3,
        // palette index + 1: 1 = full, 2 = diag_tl, 3 = deco
        tiles: [
            1, 1, 1,
            1, 0, 2,
            3, 0, 1,
        ],
        spawns: [[1, 1], [0, 0]],
        palette: [
            { key: "tile_default", shape: "full" },
            { key: "tile_default", shape: "diag_tl" },
            { key: "tile_hidden", shape: "deco" },
        ],
        segments: [[0, 2, 2, 2]],
    }
}

describe("customMap packet round-trip", () => {
    it("encodes then decodes a representative custom map back to the input", () => {
        const map = representativeMap()
        const bytes = encode.customMap(map)
        const decoded = packetManager.decode(bytes)
        expect(decoded.customMap?.[0]?.data).toEqual(map)
    })

    it("round-trips alongside other packets in one batch (framing intact)", () => {
        const map = representativeMap()
        const bytes = [
            ...encode.gameMap(2),
            ...encode.customMap(map),
            ...encode.gameMap(5),
        ]
        const decoded = packetManager.decode(bytes)
        expect(decoded.customMap?.[0]?.data).toEqual(map)
        // The 4-byte-prefixed customMap must not desync the index-only gameMaps
        // around it.
        expect(decoded.gameMap).toEqual([{ mapIndex: 2 }, { mapIndex: 5 }])
    })
})

describe("PipPipGame.setCustomMap", () => {
    it("builds walls and marks the map custom", () => {
        const game = new PipPipGame()
        game.setCustomMap(representativeMap())

        // mapIndex flips to the reserved custom sentinel; the synthetic mapType
        // carries the custom id.
        expect(game.mapIndex).toBe(CUSTOM_MAP_INDEX)
        expect(game.mapType.id).toBe(CUSTOM_MAP_TYPE_ID)
        expect(game.mapType.name).toBe("Arena")
        // The loaded map produced real collision geometry.
        expect(game.map.rectWalls.length).toBeGreaterThan(0)
        expect(game.map.segWalls.length).toBeGreaterThan(0)
        // The source data is retained so the server can re-broadcast it.
        expect(game.customMapData).toEqual(representativeMap())
    })

    it("ignores an invalid map (no throw, no change)", () => {
        const game = new PipPipGame()
        const before = game.mapIndex
        // cols*rows mismatch with tiles length -> validateGridMapData returns null.
        game.setCustomMap({ name: "bad", cellSize: 64, cols: 2, rows: 2, tiles: [1], spawns: [], palette: [] } as GridMapData)
        expect(game.mapIndex).toBe(before)
        expect(game.customMapData).toBeUndefined()
    })

    it("clears customMapData when switching back to a built-in map", () => {
        const game = new PipPipGame()
        game.setCustomMap(representativeMap())
        expect(game.customMapData).toBeDefined()

        game.setMap(0)
        expect(game.mapIndex).toBe(0)
        expect(game.customMapData).toBeUndefined()
    })
})
