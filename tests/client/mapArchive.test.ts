import { describe, expect, it } from "vitest"
import {
    ARCHIVE_STORAGE_KEY,
    ARCHIVE_RETENTION_MS,
    ARCHIVE_MAX_ENTRIES,
    archivePut,
    listArchivedMaps,
    getArchiveEntry,
    removeArchivedMap,
    purgeExpiredArchive,
    restoreArchivedMap,
} from "../../packages/client/src/game/mapArchive"
import { loadMapFromLibrary } from "../../packages/client/src/game/mapLibrary"
import { EditorStorage, serializeGridMapData } from "../../packages/client/src/game/mapEditor"
import { GridMapData } from "../../packages/game/src/logic/grid-map"

function fakeStorage(): EditorStorage & { map: Map<string, string> }{
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

const DAY = 24 * 60 * 60 * 1000

describe("archivePut + listArchivedMaps", () => {
    it("stores a soft-deleted map and lists it with derived dims and an expiry", () => {
        const storage = fakeStorage()
        const key = archivePut(storage, "Arena", serializeGridMapData(fullMap("Arena", 3, 4)), 1000, 500)
        expect(key).toBe("Arena")
        const list = listArchivedMaps(storage, 1000)
        expect(list.length).toBe(1)
        expect(list[0]).toMatchObject({ name: "Arena", cols: 3, rows: 4, spawns: 1, deletedAt: 1000, savedAt: 500 })
        expect(list[0].expiresAt).toBe(1000 + ARCHIVE_RETENTION_MS)
    })

    it("keeps an invalid / unreadable map's bytes verbatim (archive never validates)", () => {
        const storage = fakeStorage()
        archivePut(storage, "Broken", "{ not a valid map", 2000)
        const entry = getArchiveEntry(storage, "Broken")
        expect(entry?.data).toBe("{ not a valid map")
        // It still lists (as a 0x0 map) rather than vanishing.
        expect(listArchivedMaps(storage, 2000).map((s) => s.name)).toEqual(["Broken"])
    })

    it("does not clobber when the same name is archived twice", () => {
        const storage = fakeStorage()
        archivePut(storage, "Map", serializeGridMapData(fullMap("Map")), 1000)
        const key2 = archivePut(storage, "Map", serializeGridMapData(fullMap("Map")), 2000)
        expect(key2).not.toBe("Map")
        expect(listArchivedMaps(storage, 2000).length).toBe(2)
    })

    it("sorts newest-deleted first", () => {
        const storage = fakeStorage()
        archivePut(storage, "Old", serializeGridMapData(fullMap("Old")), 1000)
        archivePut(storage, "New", serializeGridMapData(fullMap("New")), 3000)
        archivePut(storage, "Mid", serializeGridMapData(fullMap("Mid")), 2000)
        expect(listArchivedMaps(storage, 4000).map((s) => s.name)).toEqual(["New", "Mid", "Old"])
    })
})

describe("retention + purge", () => {
    it("hides entries older than the 30-day retention window from the list", () => {
        const storage = fakeStorage()
        archivePut(storage, "Fresh", serializeGridMapData(fullMap("Fresh")), 100 * DAY)
        archivePut(storage, "Stale", serializeGridMapData(fullMap("Stale")), 100 * DAY)
        // Move the clock 31 days past Stale only by archiving Fresh later.
        const now = 100 * DAY + 31 * DAY
        archivePut(storage, "Fresh2", serializeGridMapData(fullMap("Fresh2")), now)
        const names = listArchivedMaps(storage, now).map((s) => s.name)
        expect(names).toContain("Fresh2")
        expect(names).not.toContain("Stale")
        expect(names).not.toContain("Fresh")
    })

    it("purgeExpiredArchive drops expired entries and returns the count", () => {
        const storage = fakeStorage()
        archivePut(storage, "A", serializeGridMapData(fullMap("A")), 0)
        archivePut(storage, "B", serializeGridMapData(fullMap("B")), 0)
        const now = 31 * DAY
        expect(purgeExpiredArchive(storage, now)).toBe(2)
        expect(listArchivedMaps(storage, now)).toEqual([])
    })
})

describe("restoreArchivedMap", () => {
    it("moves a map back into the library and removes it from the archive", () => {
        const storage = fakeStorage()
        archivePut(storage, "Treasure", serializeGridMapData(fullMap("Treasure", 3, 3)), 1000, 500)
        const res = restoreArchivedMap(storage, "Treasure", 5000)
        expect(res.ok).toBe(true)
        if(res.ok){
            // It is loadable from the library again, and gone from the archive.
            expect(loadMapFromLibrary(storage, res.name)).not.toBe(null)
            expect(getArchiveEntry(storage, "Treasure")).toBe(null)
        }
    })

    it("returns a missing failure for an unknown archived map", () => {
        const storage = fakeStorage()
        expect(restoreArchivedMap(storage, "Ghost", 1)).toMatchObject({ ok: false, reason: "missing" })
    })
})

describe("caps + tolerance", () => {
    it("evicts the oldest-deleted entry past the entry cap", () => {
        const storage = fakeStorage()
        for(let i = 0; i < ARCHIVE_MAX_ENTRIES; i++){
            archivePut(storage, `Map ${i}`, serializeGridMapData(fullMap(`Map ${i}`)), 1000 + i)
        }
        archivePut(storage, "Newcomer", serializeGridMapData(fullMap("Newcomer")), 1_000_000)
        const names = listArchivedMaps(storage, 2_000_000).map((s) => s.name)
        expect(names.length).toBe(ARCHIVE_MAX_ENTRIES)
        expect(names).toContain("Newcomer")
        expect(names).not.toContain("Map 0")
    })

    it("tolerates corrupt / unreadable storage without throwing", () => {
        const broken: EditorStorage = {
            getItem: () => { throw new Error("blocked") },
            setItem: () => { throw new Error("blocked") },
            removeItem: () => { throw new Error("blocked") },
        }
        expect(listArchivedMaps(broken, 0)).toEqual([])
        expect(getArchiveEntry(broken, "x")).toBe(null)
        expect(removeArchivedMap(broken, "x")).toBe(false)
        expect(purgeExpiredArchive(broken, 0)).toBe(0)
        expect(archivePut(broken, "x", "{}", 0)).toBe(null)
    })

    it("tolerates a non-JSON archive blob (treats it as empty)", () => {
        const storage = fakeStorage()
        storage.setItem(ARCHIVE_STORAGE_KEY, "{ not json")
        expect(listArchivedMaps(storage, 0)).toEqual([])
    })
})
