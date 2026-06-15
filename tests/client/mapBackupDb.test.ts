import { describe, expect, it } from "vitest"
import {
    BackupStore,
    BACKUP_CURRENT_KEY,
    BACKUP_SNAPSHOT_PREFIX,
    BACKUP_SNAPSHOT_LIMIT,
    mirrorLibrary,
    mirrorLibraryFromStorage,
    collectBackupRecoveryBlobs,
    openIndexedDbBackupStore,
} from "../../packages/client/src/game/mapBackupDb"
import { LIBRARY_STORAGE_KEY } from "../../packages/client/src/game/mapLibrary"
import { EditorStorage, serializeGridMapData } from "../../packages/client/src/game/mapEditor"
import { GridMapData } from "../../packages/game/src/logic/grid-map"

// An in-memory BackupStore, the async analogue of the fakeStorage used elsewhere.
function fakeBackupStore(): BackupStore & { map: Map<string, string> }{
    const map = new Map<string, string>()
    return {
        map,
        async get(key: string){ return map.has(key) ? (map.get(key) as string) : null },
        async set(key: string, value: string){ map.set(key, value) },
        async delete(key: string){ map.delete(key) },
        async keys(){ return Array.from(map.keys()) },
    }
}

function libraryJson(names: string[]): string{
    const record: Record<string, { data: string, savedAt: number }> = {}
    names.forEach((name, i) => {
        const map: GridMapData = {
            name, cellSize: 72, cols: 2, rows: 2,
            tiles: [1, 1, 1, 1], spawns: [[0, 0]],
            palette: [{ key: "tile_default", shape: "full" }],
        }
        record[name] = { data: serializeGridMapData(map), savedAt: i + 1 }
    })
    return JSON.stringify(record)
}

describe("mirrorLibrary", () => {
    it("writes the current mirror and a snapshot on change", async () => {
        const store = fakeBackupStore()
        await mirrorLibrary(store, libraryJson(["A"]), 1000)
        expect(await store.get(BACKUP_CURRENT_KEY)).toBe(libraryJson(["A"]))
        const snaps = Array.from(store.map.keys()).filter((k) => k.indexOf(BACKUP_SNAPSHOT_PREFIX) === 0)
        expect(snaps.length).toBe(1)
    })

    it("does not add a snapshot when the content is unchanged", async () => {
        const store = fakeBackupStore()
        await mirrorLibrary(store, libraryJson(["A"]), 1000)
        await mirrorLibrary(store, libraryJson(["A"]), 2000)
        const snaps = Array.from(store.map.keys()).filter((k) => k.indexOf(BACKUP_SNAPSHOT_PREFIX) === 0)
        expect(snaps.length).toBe(1)
    })

    it("prunes the oldest snapshots beyond the retention limit", async () => {
        const store = fakeBackupStore()
        for(let i = 0; i < BACKUP_SNAPSHOT_LIMIT + 5; i++){
            await mirrorLibrary(store, libraryJson([`Map ${i}`]), 1000 + i)
        }
        const snaps = Array.from(store.map.keys()).filter((k) => k.indexOf(BACKUP_SNAPSHOT_PREFIX) === 0)
        expect(snaps.length).toBe(BACKUP_SNAPSHOT_LIMIT)
    })
})

describe("mirrorLibraryFromStorage", () => {
    it("reads the live library out of storage and mirrors it", async () => {
        const store = fakeBackupStore()
        const storage: EditorStorage = (() => {
            const map = new Map<string, string>([[LIBRARY_STORAGE_KEY, libraryJson(["Live"])]])
            return {
                getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
                setItem: () => {},
                removeItem: () => {},
            }
        })()
        await mirrorLibraryFromStorage(store, storage, 1000)
        expect(await store.get(BACKUP_CURRENT_KEY)).toBe(libraryJson(["Live"]))
    })
})

describe("collectBackupRecoveryBlobs", () => {
    it("returns one blob per library entry across current + snapshots", async () => {
        const store = fakeBackupStore()
        await mirrorLibrary(store, libraryJson(["A", "B"]), 1000)
        const blobs = await collectBackupRecoveryBlobs(store)
        expect(blobs.length).toBeGreaterThanOrEqual(2)
        expect(blobs.every((b) => b.source === "backup")).toBe(true)
    })

    it("returns [] for an empty store", async () => {
        expect(await collectBackupRecoveryBlobs(fakeBackupStore())).toEqual([])
    })
})

describe("openIndexedDbBackupStore", () => {
    it("returns null when IndexedDB is unavailable (e.g. node)", async () => {
        expect(await openIndexedDbBackupStore()).toBe(null)
    })
})
