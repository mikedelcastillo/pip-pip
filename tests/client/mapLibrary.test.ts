import { describe, expect, it } from "vitest"
import {
    LibraryStorage,
    LIBRARY_STORAGE_KEY,
    LIBRARY_MAX_ENTRIES,
    LIBRARY_MAX_BYTES,
    saveMapToLibrary,
    listLibraryMaps,
    loadMapFromLibrary,
    deleteMapFromLibrary,
} from "../../packages/client/src/game/mapLibrary"
import { EditorMap, EDITOR_STORAGE_KEY, PLAY_MAP_STORAGE_KEY, serializeGridMapData } from "../../packages/client/src/game/mapEditor"
import { GridMapData } from "../../packages/game/src/logic/grid-map"

// A tiny in-memory LibraryStorage so the library round-trips without a real
// DOM/localStorage, mirroring the fakeStorage helper the mapEditor tests use. The
// `fail` flag lets a test simulate a quota / disabled-storage error on setItem.
function fakeStorage(): LibraryStorage & { map: Map<string, string>, fail: boolean }{
    const state = {
        map: new Map<string, string>(),
        fail: false,
        getItem: (key: string) => (state.map.has(key) ? (state.map.get(key) as string) : null),
        setItem: (key: string, value: string) => {
            if(state.fail) throw new Error("quota exceeded")
            state.map.set(key, value)
        },
        removeItem: (key: string) => { state.map.delete(key) },
    }
    return state
}

// Build a small playable GridMapData with the given dimensions + spawn count, so
// the list-summary derivation (cols/rows/spawns) has something to read back. The
// data passes validateGridMapData, which loadMapFromLibrary runs.
function sampleMap(name: string, cols = 2, rows = 2, spawns = 1): GridMapData{
    const map = new EditorMap(name)
    for(let c = 0; c < cols; c++){
        for(let r = 0; r < rows; r++){
            map.setCell(c, r, "full")
        }
    }
    const data = map.toGridMapData()
    // Override the derived dims so a test can assert exact cols/rows/spawns; keep
    // the tiles array length consistent so validateGridMapData still passes.
    data.cols = cols
    data.rows = rows
    data.tiles = new Array(cols * rows).fill(1)
    data.spawns = []
    for(let i = 0; i < spawns; i++){
        data.spawns.push([i % cols, 0])
    }
    return data
}

describe("saveMapToLibrary + listLibraryMaps", () => {
    it("saves under its own key, never the autosave or play-map key", () => {
        const storage = fakeStorage()
        const res = saveMapToLibrary(storage, "Arena", sampleMap("Arena"), 1000)
        expect(res.ok).toBe(true)
        expect(storage.map.has(LIBRARY_STORAGE_KEY)).toBe(true)
        // It must NEVER clobber the autosave draft or the play-map stash.
        expect(storage.map.has(EDITOR_STORAGE_KEY)).toBe(false)
        expect(storage.map.has(PLAY_MAP_STORAGE_KEY)).toBe(false)
    })

    it("lists a saved map with derived cols/rows/spawns and savedAt", () => {
        const storage = fakeStorage()
        saveMapToLibrary(storage, "Box", sampleMap("Box", 3, 4, 2), 5000)
        const list = listLibraryMaps(storage)
        expect(list.length).toBe(1)
        expect(list[0]).toEqual({ name: "Box", cols: 3, rows: 4, spawns: 2, savedAt: 5000 })
    })

    it("trims the name on save (and a name collision overwrites)", () => {
        const storage = fakeStorage()
        const first = saveMapToLibrary(storage, "  Trimmed  ", sampleMap("x", 2, 2, 1), 100)
        expect(first).toMatchObject({ ok: true, name: "Trimmed" })
        // Saving under the same trimmed name OVERWRITES in place (count stays 1).
        const second = saveMapToLibrary(storage, "Trimmed", sampleMap("x", 5, 5, 3), 200)
        expect(second).toMatchObject({ ok: true, name: "Trimmed" })
        const list = listLibraryMaps(storage)
        expect(list.length).toBe(1)
        expect(list[0]).toMatchObject({ name: "Trimmed", cols: 5, rows: 5, spawns: 3, savedAt: 200 })
    })

    it("rejects an empty / whitespace name without writing", () => {
        const storage = fakeStorage()
        expect(saveMapToLibrary(storage, "", sampleMap("x"))).toMatchObject({ ok: false, reason: "empty-name" })
        expect(saveMapToLibrary(storage, "   ", sampleMap("x"))).toMatchObject({ ok: false, reason: "empty-name" })
        expect(storage.map.has(LIBRARY_STORAGE_KEY)).toBe(false)
    })

    it("sorts the list newest-first by savedAt, then by name", () => {
        const storage = fakeStorage()
        saveMapToLibrary(storage, "Older", sampleMap("Older"), 1000)
        saveMapToLibrary(storage, "Newest", sampleMap("Newest"), 3000)
        saveMapToLibrary(storage, "Middle", sampleMap("Middle"), 2000)
        const names = listLibraryMaps(storage).map((s) => s.name)
        expect(names).toEqual(["Newest", "Middle", "Older"])
    })

    it("sorts entries with no savedAt to the end, alphabetically among themselves", () => {
        const storage = fakeStorage()
        saveMapToLibrary(storage, "Timed", sampleMap("Timed"), 1000)
        // No timestamp passed: these carry no savedAt and sort last, A before B.
        saveMapToLibrary(storage, "Bravo", sampleMap("Bravo"))
        saveMapToLibrary(storage, "Alpha", sampleMap("Alpha"))
        const names = listLibraryMaps(storage).map((s) => s.name)
        expect(names).toEqual(["Timed", "Alpha", "Bravo"])
    })
})

describe("loadMapFromLibrary", () => {
    it("loads a saved map back as a validated GridMapData", () => {
        const storage = fakeStorage()
        const data = sampleMap("Round", 3, 3, 2)
        saveMapToLibrary(storage, "Round", data, 1)
        const loaded = loadMapFromLibrary(storage, "Round")
        expect(loaded).not.toBe(null)
        expect(loaded?.name).toBe("Round")
        expect(loaded?.cols).toBe(3)
        expect(loaded?.rows).toBe(3)
        expect(loaded?.spawns.length).toBe(2)
    })

    it("trims the name when loading so it matches the trimmed save key", () => {
        const storage = fakeStorage()
        saveMapToLibrary(storage, "Padded", sampleMap("Padded"), 1)
        expect(loadMapFromLibrary(storage, "  Padded  ")).not.toBe(null)
    })

    it("returns null for a name that is not in the library", () => {
        const storage = fakeStorage()
        saveMapToLibrary(storage, "Exists", sampleMap("Exists"), 1)
        expect(loadMapFromLibrary(storage, "Missing")).toBe(null)
    })

    it("returns null (never throws) on an entry whose JSON is corrupt", () => {
        const storage = fakeStorage()
        // Hand-write a library record with a bad JSON payload for one entry.
        storage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify({ Bad: { data: "{ not json", savedAt: 1 } }))
        expect(loadMapFromLibrary(storage, "Bad")).toBe(null)
        // And listing tolerates it by skipping it.
        expect(listLibraryMaps(storage)).toEqual([])
    })

    it("returns null when a stored entry fails validateGridMapData (e.g. negative cols)", () => {
        const storage = fakeStorage()
        // A structurally-broken map (cols 0) is rejected by the validator on load.
        const broken = { name: "Broken", cellSize: 64, cols: 0, rows: 0, tiles: [], spawns: [], palette: [] }
        storage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify({ Broken: { data: JSON.stringify(broken), savedAt: 1 } }))
        expect(loadMapFromLibrary(storage, "Broken")).toBe(null)
    })
})

describe("deleteMapFromLibrary", () => {
    it("removes an entry and refreshes the list", () => {
        const storage = fakeStorage()
        saveMapToLibrary(storage, "Keep", sampleMap("Keep"), 1)
        saveMapToLibrary(storage, "Drop", sampleMap("Drop"), 2)
        expect(listLibraryMaps(storage).map((s) => s.name).sort()).toEqual(["Drop", "Keep"])
        expect(deleteMapFromLibrary(storage, "Drop")).toBe(true)
        expect(listLibraryMaps(storage).map((s) => s.name)).toEqual(["Keep"])
        // The other entry is still loadable after the delete.
        expect(loadMapFromLibrary(storage, "Keep")).not.toBe(null)
    })

    it("trims the name and returns false for a missing entry (no-op)", () => {
        const storage = fakeStorage()
        saveMapToLibrary(storage, "Only", sampleMap("Only"), 1)
        expect(deleteMapFromLibrary(storage, "Nope")).toBe(false)
        // Trimmed delete still hits the trimmed key.
        expect(deleteMapFromLibrary(storage, "  Only  ")).toBe(true)
        expect(listLibraryMaps(storage)).toEqual([])
    })
})

describe("library cap + size guard", () => {
    it("evicts the oldest entry when a NEW save hits the entry cap", () => {
        const storage = fakeStorage()
        // Fill the library to the cap, each with an increasing timestamp.
        for(let i = 0; i < LIBRARY_MAX_ENTRIES; i++){
            saveMapToLibrary(storage, `Map ${i}`, sampleMap(`Map ${i}`), i + 1)
        }
        expect(listLibraryMaps(storage).length).toBe(LIBRARY_MAX_ENTRIES)
        // One more NEW name at the cap evicts the oldest (Map 0, savedAt 1).
        const res = saveMapToLibrary(storage, "Newcomer", sampleMap("Newcomer"), 10_000)
        expect(res).toMatchObject({ ok: true, name: "Newcomer", evicted: "Map 0" })
        const names = listLibraryMaps(storage).map((s) => s.name)
        expect(names.length).toBe(LIBRARY_MAX_ENTRIES)
        expect(names).toContain("Newcomer")
        expect(names).not.toContain("Map 0")
    })

    it("overwriting an existing name at the cap does NOT evict", () => {
        const storage = fakeStorage()
        for(let i = 0; i < LIBRARY_MAX_ENTRIES; i++){
            saveMapToLibrary(storage, `Map ${i}`, sampleMap(`Map ${i}`), i + 1)
        }
        // Overwriting an EXISTING name keeps the count and never drops another map.
        const res = saveMapToLibrary(storage, "Map 0", sampleMap("Map 0", 4, 4, 2), 9999)
        expect(res).toMatchObject({ ok: true, name: "Map 0" })
        expect("evicted" in res ? res.evicted : undefined).toBeUndefined()
        const names = listLibraryMaps(storage).map((s) => s.name)
        expect(names.length).toBe(LIBRARY_MAX_ENTRIES)
        expect(names).toContain("Map 0")
    })

    it("rejects a write that would exceed the byte ceiling, leaving the prior library intact", () => {
        const storage = fakeStorage()
        saveMapToLibrary(storage, "Safe", sampleMap("Safe"), 1)
        const before = storage.map.get(LIBRARY_STORAGE_KEY)
        // A map whose serialised form alone blows the byte ceiling.
        const huge = sampleMap("Huge")
        huge.name = "x".repeat(LIBRARY_MAX_BYTES + 10)
        const res = saveMapToLibrary(storage, "Huge", huge, 2)
        expect(res).toMatchObject({ ok: false, reason: "too-large" })
        // The prior library on disk is untouched.
        expect(storage.map.get(LIBRARY_STORAGE_KEY)).toBe(before)
        expect(listLibraryMaps(storage).map((s) => s.name)).toEqual(["Safe"])
    })

    it("surfaces a storage failure (quota / private mode) instead of throwing", () => {
        const storage = fakeStorage()
        storage.fail = true
        const res = saveMapToLibrary(storage, "Wont Save", sampleMap("Wont Save"), 1)
        expect(res).toMatchObject({ ok: false, reason: "storage" })
        // Nothing was written.
        expect(storage.map.has(LIBRARY_STORAGE_KEY)).toBe(false)
    })
})

describe("corrupt / missing storage tolerance", () => {
    it("lists empty and loads null on totally missing storage", () => {
        const storage = fakeStorage()
        expect(listLibraryMaps(storage)).toEqual([])
        expect(loadMapFromLibrary(storage, "Anything")).toBe(null)
        expect(deleteMapFromLibrary(storage, "Anything")).toBe(false)
    })

    it("tolerates a non-JSON library blob (treats it as empty)", () => {
        const storage = fakeStorage()
        storage.setItem(LIBRARY_STORAGE_KEY, "{ not json at all")
        expect(listLibraryMaps(storage)).toEqual([])
        expect(loadMapFromLibrary(storage, "Whatever")).toBe(null)
    })

    it("tolerates a library blob that is a JSON array, not an object", () => {
        const storage = fakeStorage()
        storage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify([1, 2, 3]))
        expect(listLibraryMaps(storage)).toEqual([])
    })

    it("skips a malformed entry but keeps the well-formed ones", () => {
        const storage = fakeStorage()
        // One good entry, one entry missing its `data` string, one non-object entry.
        const good = serializeGridMapData(sampleMap("Good", 2, 2, 1))
        storage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify({
            Good: { data: good, savedAt: 5 },
            NoData: { savedAt: 9 },
            NotObject: 42,
        }))
        const list = listLibraryMaps(storage)
        expect(list.map((s) => s.name)).toEqual(["Good"])
        expect(loadMapFromLibrary(storage, "Good")).not.toBe(null)
        expect(loadMapFromLibrary(storage, "NoData")).toBe(null)
    })

    it("does NOT throw when getItem itself throws (returns sane defaults)", () => {
        const broken: LibraryStorage = {
            getItem: () => { throw new Error("blocked") },
            setItem: () => { throw new Error("blocked") },
            removeItem: () => { throw new Error("blocked") },
        }
        expect(listLibraryMaps(broken)).toEqual([])
        expect(loadMapFromLibrary(broken, "x")).toBe(null)
        expect(deleteMapFromLibrary(broken, "x")).toBe(false)
        // A save against unreadable storage surfaces a storage failure, never throws.
        expect(saveMapToLibrary(broken, "x", sampleMap("x"), 1)).toMatchObject({ ok: false, reason: "storage" })
    })
})
