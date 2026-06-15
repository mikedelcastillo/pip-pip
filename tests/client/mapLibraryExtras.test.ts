import { describe, expect, it } from "vitest"
import {
    LibraryStorage,
    LIBRARY_STORAGE_KEY,
    LIBRARY_MAX_ENTRIES,
    saveMapToLibrary,
    loadMapFromLibrary,
    getLibraryEntry,
    importRawMapToLibrary,
} from "../../packages/client/src/game/mapLibrary"
import { serializeGridMapData } from "../../packages/client/src/game/mapEditor"
import { GridMapData } from "../../packages/game/src/logic/grid-map"

function fakeStorage(): LibraryStorage & { map: Map<string, string> }{
    const state = {
        map: new Map<string, string>(),
        getItem: (key: string) => (state.map.has(key) ? (state.map.get(key) as string) : null),
        setItem: (key: string, value: string) => { state.map.set(key, value) },
        removeItem: (key: string) => { state.map.delete(key) },
    }
    return state
}

function fullMap(name: string, cols = 2, rows = 2): GridMapData{
    return {
        name, cellSize: 72, cols, rows,
        tiles: new Array(cols * rows).fill(1),
        spawns: [[0, 0]],
        palette: [{ key: "tile_default", shape: "full" }],
    }
}

describe("saveMapToLibrary validation guard", () => {
    it("refuses to persist a map that could not load back, rather than saving it silently", () => {
        const storage = fakeStorage()
        // A big map overflows the world-extent guard: validateGridMapData rejects it.
        const big = fullMap("Big", 200, 10)
        const res = saveMapToLibrary(storage, "Big", big, 1)
        expect(res).toMatchObject({ ok: false, reason: "invalid" })
        // Nothing was written, so it cannot become an Unreadable card.
        expect(storage.map.has(LIBRARY_STORAGE_KEY)).toBe(false)
    })

    it("still saves a normal, loadable map", () => {
        const storage = fakeStorage()
        expect(saveMapToLibrary(storage, "Fine", fullMap("Fine", 3, 3), 1)).toMatchObject({ ok: true, name: "Fine" })
    })
})

describe("saveMapToLibrary eviction returns the evicted bytes", () => {
    it("hands back the evicted entry's raw data so the caller can archive it instead of destroying it", () => {
        const storage = fakeStorage()
        for(let i = 0; i < LIBRARY_MAX_ENTRIES; i++){
            saveMapToLibrary(storage, `Map ${i}`, fullMap(`Map ${i}`), i + 1)
        }
        const res = saveMapToLibrary(storage, "Newcomer", fullMap("Newcomer"), 1_000_000)
        expect(res.ok).toBe(true)
        if(res.ok){
            expect(res.evicted).toBe("Map 0")
            expect(typeof res.evictedData).toBe("string")
            // The evicted bytes round-trip to the original map, ready to archive.
            expect(JSON.parse(res.evictedData as string).name).toBe("Map 0")
        }
    })
})

describe("getLibraryEntry", () => {
    it("returns the raw bytes even for an entry that fails validation", () => {
        const storage = fakeStorage()
        // Hand-write an invalid (but present) entry, as a silent-invalid save would.
        const bigRaw = serializeGridMapData(fullMap("Big", 200, 10))
        storage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify({ Big: { data: bigRaw, savedAt: 7 } }))
        // loadMapFromLibrary rejects it, but getLibraryEntry still yields the bytes.
        expect(loadMapFromLibrary(storage, "Big")).toBe(null)
        const entry = getLibraryEntry(storage, "Big")
        expect(entry?.data).toBe(bigRaw)
        expect(entry?.savedAt).toBe(7)
    })

    it("returns null for a missing entry", () => {
        expect(getLibraryEntry(fakeStorage(), "Nope")).toBe(null)
    })
})

describe("importRawMapToLibrary", () => {
    it("writes raw bytes under a fresh non-colliding name and re-stamps the map name", () => {
        const storage = fakeStorage()
        saveMapToLibrary(storage, "Arena", fullMap("Arena", 3, 3), 1)
        const res = importRawMapToLibrary(storage, serializeGridMapData(fullMap("Arena", 3, 3)), "Arena", 2)
        expect(res).toMatchObject({ ok: true, name: "Arena copy" })
        const loaded = loadMapFromLibrary(storage, "Arena copy")
        expect(loaded?.name).toBe("Arena copy")
    })

    it("preserves invalid bytes verbatim so they can be repaired later", () => {
        const storage = fakeStorage()
        const bigRaw = serializeGridMapData(fullMap("Big", 200, 10))
        const res = importRawMapToLibrary(storage, bigRaw, "Big", 1)
        expect(res.ok).toBe(true)
        if(res.ok){
            // It is present (the raw entry exists) even though it does not load yet.
            expect(getLibraryEntry(storage, res.name)).not.toBe(null)
            expect(loadMapFromLibrary(storage, res.name)).toBe(null)
        }
    })
})
