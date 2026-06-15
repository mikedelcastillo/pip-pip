import { describe, expect, it } from "vitest"
import {
    repairGridMapData,
    collectLocalRecoveryBlobs,
    scanRecoveryBlobs,
    scanLocalRecoverableMaps,
    countNonEmptyTiles,
    RawBlob,
} from "../../packages/client/src/game/mapRecovery"
import {
    EditorStorage,
    EDITOR_STORAGE_KEY,
    PLAY_MAP_STORAGE_KEY,
    serializeGridMapData,
} from "../../packages/client/src/game/mapEditor"
import { LIBRARY_STORAGE_KEY } from "../../packages/client/src/game/mapLibrary"
import { ARCHIVE_STORAGE_KEY } from "../../packages/client/src/game/mapArchive"
import { GridMapData, validateGridMapData } from "../../packages/game/src/logic/grid-map"

// A tiny in-memory EditorStorage, mirroring the fakeStorage helper the library +
// editor tests use, so recovery round-trips without a real DOM/localStorage.
function fakeStorage(): EditorStorage & { map: Map<string, string> }{
    const state = {
        map: new Map<string, string>(),
        getItem: (key: string) => (state.map.has(key) ? (state.map.get(key) as string) : null),
        setItem: (key: string, value: string) => { state.map.set(key, value) },
        removeItem: (key: string) => { state.map.delete(key) },
    }
    return state
}

// Build a valid GridMapData of the given size with every cell a full tile, so the
// content score (non-empty tiles) is predictable and it passes validateGridMapData
// at small sizes.
function fullMap(name: string, cols: number, rows: number, cellSize = 72): GridMapData{
    return {
        name,
        cellSize,
        cols,
        rows,
        tiles: new Array(cols * rows).fill(1),
        spawns: [[0, 0]],
        palette: [{ key: "tile_default", shape: "full" }],
    }
}

describe("repairGridMapData", () => {
    it("returns a healthy map unchanged with no repairs", () => {
        const map = fullMap("Fine", 4, 4)
        const res = repairGridMapData(map)
        expect(res.ok).toBe(true)
        if(res.ok){
            expect(res.repairs).toEqual([])
            expect(validateGridMapData(res.data)).not.toBe(null)
            expect(countNonEmptyTiles(res.data)).toBe(16)
        }
    })

    it("accepts a raw JSON string as well as a parsed object", () => {
        const res = repairGridMapData(serializeGridMapData(fullMap("Str", 2, 2)))
        expect(res.ok).toBe(true)
    })

    it("repairs a LARGE map that overflows the world-extent guard by re-centering, preserving every tile", () => {
        // 200 wide at cellSize 72 puts maxCol*cellSize past WORLD_QUANT_RANGE (8192),
        // so the strict validator rejects it even though all tiles are intact.
        const big = fullMap("Big", 200, 10)
        expect(validateGridMapData(big)).toBe(null)
        const res = repairGridMapData(big)
        expect(res.ok).toBe(true)
        if(res.ok){
            // Repaired result now validates, and not a single tile was dropped.
            expect(validateGridMapData(res.data)).not.toBe(null)
            expect(countNonEmptyTiles(res.data)).toBe(2000)
            expect(res.repairs.length).toBeGreaterThan(0)
        }
    })

    it("repairs an EXTREME map by also shrinking cellSize when re-centering is not enough", () => {
        const huge = fullMap("Huge", 250, 1)
        expect(validateGridMapData(huge)).toBe(null)
        const res = repairGridMapData(huge)
        expect(res.ok).toBe(true)
        if(res.ok){
            expect(validateGridMapData(res.data)).not.toBe(null)
            // cellSize was reduced to make the world bounds fit.
            expect(res.data.cellSize).toBeLessThan(72)
            expect(countNonEmptyTiles(res.data)).toBe(250)
        }
    })

    it("pads a tiles array that is too short for cols*rows", () => {
        const broken = { ...fullMap("Short", 4, 4), tiles: [1, 1, 1] }
        const res = repairGridMapData(broken)
        expect(res.ok).toBe(true)
        if(res.ok){
            expect(res.data.tiles.length).toBe(16)
            expect(validateGridMapData(res.data)).not.toBe(null)
        }
    })

    it("derives rows from the tile count when cols is sane but rows is wrong", () => {
        const broken = { ...fullMap("Derive", 4, 99), tiles: new Array(8).fill(1) }
        const res = repairGridMapData(broken)
        expect(res.ok).toBe(true)
        if(res.ok){
            expect(res.data.cols).toBe(4)
            expect(res.data.rows).toBe(2)
            expect(res.data.tiles.length).toBe(8)
        }
    })

    it("floors fractional and clamps negative tile indices", () => {
        const broken = { ...fullMap("Coerce", 2, 2), tiles: [1.7, -3, 2, 0] }
        const res = repairGridMapData(broken)
        expect(res.ok).toBe(true)
        if(res.ok){
            expect(res.data.tiles).toEqual([1, 0, 2, 0])
        }
    })

    it("defaults a missing name and a non-positive cellSize", () => {
        const broken = { ...fullMap("x", 2, 2), name: 42 as unknown as string, cellSize: 0 }
        const res = repairGridMapData(broken)
        expect(res.ok).toBe(true)
        if(res.ok){
            expect(typeof res.data.name).toBe("string")
            expect(res.data.cellSize).toBeGreaterThan(0)
        }
    })

    it("drops malformed spawns rather than failing the whole map", () => {
        const broken = { ...fullMap("Spawns", 2, 2), spawns: [[0, 0], [1], "nope", [2.4, 3.9]] as unknown as [number, number][] }
        const res = repairGridMapData(broken)
        expect(res.ok).toBe(true)
        if(res.ok){
            // The good spawn survives, the floats are floored, the junk is dropped.
            expect(res.data.spawns).toContainEqual([0, 0])
            expect(res.data.spawns).toContainEqual([2, 3])
            expect(res.data.spawns.length).toBe(2)
            expect(validateGridMapData(res.data)).not.toBe(null)
        }
    })

    it("returns ok:false for content that is not a map at all", () => {
        expect(repairGridMapData({ hello: "world" }).ok).toBe(false)
        expect(repairGridMapData("not json at all {").ok).toBe(false)
        expect(repairGridMapData(null).ok).toBe(false)
        expect(repairGridMapData(42).ok).toBe(false)
    })
})

describe("scanRecoveryBlobs", () => {
    it("classifies a valid blob as healthy and a large blob as repairable", () => {
        const blobs: RawBlob[] = [
            { source: "library", id: "Good", label: "Good", raw: serializeGridMapData(fullMap("Good", 3, 3)) },
            { source: "library", id: "Big", label: "Big", raw: serializeGridMapData(fullMap("Big", 200, 10)) },
        ]
        const found = scanRecoveryBlobs(blobs)
        const good = found.find((c) => c.id === "Good")
        const big = found.find((c) => c.id === "Big")
        expect(good?.status).toBe("healthy")
        expect(big?.status).toBe("repairable")
        expect(big?.repairs.length).toBeGreaterThan(0)
        // The repairable big map still reports its real content.
        expect(big?.tileCount).toBe(2000)
    })

    it("sorts the most-content candidates first", () => {
        const blobs: RawBlob[] = [
            { source: "draft", id: "small", label: "small", raw: serializeGridMapData(fullMap("small", 2, 2)) },
            { source: "library", id: "large", label: "large", raw: serializeGridMapData(fullMap("large", 6, 6)) },
        ]
        const found = scanRecoveryBlobs(blobs)
        expect(found[0].id).toBe("large")
    })

    it("dedupes byte-identical blobs from different surfaces", () => {
        const raw = serializeGridMapData(fullMap("Dup", 3, 3))
        const blobs: RawBlob[] = [
            { source: "library", id: "Dup", label: "lib", raw },
            { source: "draft", id: "draft", label: "draft", raw },
        ]
        expect(scanRecoveryBlobs(blobs).length).toBe(1)
    })

    it("does NOT dedupe two different maps that share a name, size and tile count", () => {
        const a = { ...fullMap("Same", 2, 2), tiles: [1, 0, 0, 1] }
        const b = { ...fullMap("Same", 2, 2), tiles: [0, 1, 1, 0] }
        const blobs: RawBlob[] = [
            { source: "library", id: "a", label: "a", raw: serializeGridMapData(a) },
            { source: "draft", id: "b", label: "b", raw: serializeGridMapData(b) },
        ]
        // Same name, 2x2, 2 blocks each, but different layouts: both must survive.
        expect(scanRecoveryBlobs(blobs).length).toBe(2)
    })

    it("skips blobs that hold no map-like content", () => {
        const blobs: RawBlob[] = [
            { source: "orphan", id: "junk", label: "junk", raw: JSON.stringify({ unrelated: true }) },
        ]
        expect(scanRecoveryBlobs(blobs)).toEqual([])
    })
})

describe("collectLocalRecoveryBlobs", () => {
    it("pulls raw entries from every storage surface, including INVALID library entries", () => {
        const storage = fakeStorage()
        // A library with one good entry and one that fails validation (huge map) but
        // is physically present - exactly the niece's case.
        const goodRaw = serializeGridMapData(fullMap("Good", 3, 3))
        const bigRaw = serializeGridMapData(fullMap("Big", 200, 10))
        storage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify({
            Good: { data: goodRaw, savedAt: 2 },
            Big: { data: bigRaw, savedAt: 1 },
        }))
        storage.setItem(EDITOR_STORAGE_KEY, serializeGridMapData(fullMap("Draft", 2, 2)))
        storage.setItem(PLAY_MAP_STORAGE_KEY, serializeGridMapData(fullMap("Play", 2, 2)))
        storage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify({
            Old: { data: serializeGridMapData(fullMap("Old", 2, 2)), deletedAt: 5 },
        }))

        const blobs = collectLocalRecoveryBlobs(storage)
        const sources = blobs.map((b) => b.source)
        expect(sources).toContain("library")
        expect(sources).toContain("draft")
        expect(sources).toContain("play-map")
        expect(sources).toContain("archive")
        // Both library entries are pulled, including the invalid "Big" one.
        const libIds = blobs.filter((b) => b.source === "library").map((b) => b.id)
        expect(libIds).toContain("Good")
        expect(libIds).toContain("Big")
    })

    it("never throws on unreadable storage", () => {
        const broken: EditorStorage = {
            getItem: () => { throw new Error("blocked") },
            setItem: () => { throw new Error("blocked") },
            removeItem: () => { throw new Error("blocked") },
        }
        expect(collectLocalRecoveryBlobs(broken)).toEqual([])
        expect(scanLocalRecoverableMaps(broken)).toEqual([])
    })

    it("end-to-end: a buried invalid map surfaces as a repairable recovery candidate", () => {
        const storage = fakeStorage()
        storage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify({
            "My Masterpiece": { data: serializeGridMapData(fullMap("My Masterpiece", 180, 12)), savedAt: 1 },
        }))
        const found = scanLocalRecoverableMaps(storage)
        const card = found.find((c) => c.id === "My Masterpiece")
        expect(card).toBeDefined()
        expect(card?.status).toBe("repairable")
        expect(card?.tileCount).toBe(180 * 12)
    })
})
