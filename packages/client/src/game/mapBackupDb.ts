// A durable, best-effort BACKUP of the maps library in IndexedDB, sitting beneath
// the localStorage library. localStorage is the source of truth; this is a second
// copy that survives a localStorage clear (a browser "clear site data", an over-
// zealous cleaner, or the silent-overwrite bugs this work also fixes). It keeps the
// whole library record plus a short rolling history of snapshots, so even an older
// version of the library is recoverable.
//
// Design for testability + safety: all logic runs against a tiny async BackupStore
// interface, so the pure mirror/snapshot/scan logic unit-tests with an in-memory
// fake (this repo injects minimal fakes rather than polyfilling browser APIs). The
// real IndexedDB implementation is a thin adapter that returns null when IndexedDB
// is unavailable (Safari private mode, node, an SSR pass), so the app NEVER breaks
// if the backup cannot be opened - it simply runs without the extra safety net.

import { EditorStorage } from "./mapEditor"
import { LIBRARY_STORAGE_KEY } from "./mapLibrary"
import { RawBlob, blobsFromWrapperJson } from "./mapRecovery"

// The minimal async key/value surface the backup needs. A real IndexedDB store
// satisfies it; a Map-backed fake satisfies it in tests.
export interface BackupStore{
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    delete(key: string): Promise<void>
    keys(): Promise<string[]>
}

export const BACKUP_DB_NAME = "pip-pip-backup"
export const BACKUP_STORE_NAME = "maps"

// The key holding the most recent library mirror, and the prefix for timestamped
// historical snapshots.
export const BACKUP_CURRENT_KEY = "library:current"
export const BACKUP_SNAPSHOT_PREFIX = "library:snap:"

// How many historical snapshots to retain. Small: enough to step back through a few
// recent states without unbounded growth.
export const BACKUP_SNAPSHOT_LIMIT = 20

function snapshotKeys(keys: string[]): string[]{
    return keys
        .filter((k) => k.indexOf(BACKUP_SNAPSHOT_PREFIX) === 0)
        .sort()
}

// Mirror the current library JSON into the backup store: always refresh the current
// copy, and add a timestamped snapshot whenever the content actually changed (so we
// do not churn identical snapshots), pruning the oldest beyond the retention limit.
// Best-effort: any store error is swallowed so a backup failure never affects the UI.
export async function mirrorLibrary(store: BackupStore, libraryRaw: string, now: number): Promise<void>{
    try{
        const previous = await store.get(BACKUP_CURRENT_KEY)
        await store.set(BACKUP_CURRENT_KEY, libraryRaw)
        if(previous === libraryRaw) return

        // Pad the timestamp so string sort matches chronological order well past the
        // year 5000; collisions within a millisecond just overwrite, which is fine.
        const snapKey = `${BACKUP_SNAPSHOT_PREFIX}${String(now).padStart(15, "0")}`
        await store.set(snapKey, libraryRaw)

        const snaps = snapshotKeys(await store.keys())
        const excess = snaps.length - BACKUP_SNAPSHOT_LIMIT
        for(let i = 0; i < excess; i++){
            await store.delete(snaps[i])
        }
    } catch(e){
        // best-effort
    }
}

// Convenience: read the live library JSON out of localStorage and mirror it. The UI
// calls this fire-and-forget after showing or mutating the library.
export async function mirrorLibraryFromStorage(store: BackupStore, storage: EditorStorage, now: number): Promise<void>{
    let raw: string | null
    try{
        raw = storage.getItem(LIBRARY_STORAGE_KEY)
    } catch(e){
        return
    }
    if(raw === null || raw.length === 0) return
    await mirrorLibrary(store, raw, now)
}

// Pull every recoverable map blob out of the backup store: the current mirror plus
// every retained snapshot. Each library entry becomes a "backup" blob, so the same
// scanner that handles localStorage handles these. Never throws.
export async function collectBackupRecoveryBlobs(store: BackupStore): Promise<RawBlob[]>{
    let keys: string[]
    try{
        keys = await store.keys()
    } catch(e){
        return []
    }
    const out: RawBlob[] = []
    const wanted = [BACKUP_CURRENT_KEY, ...snapshotKeys(keys)]
    for(const key of wanted){
        if(keys.indexOf(key) === -1) continue
        let value: string | null
        try{
            value = await store.get(key)
        } catch(e){
            continue
        }
        if(value === null || value.length === 0) continue
        for(const blob of blobsFromWrapperJson(value, "backup")){
            // Tag the id with the origin key so distinct snapshots stay distinct
            // before the scanner dedupes by content.
            out.push({ ...blob, id: `${key}:${blob.id}` })
        }
    }
    return out
}

// Build a BackupStore over the real IndexedDB, or null when IndexedDB is unavailable
// (node, SSR, Safari private mode, or a browser that blocks it). Fully guarded so a
// caller can simply do `const store = await openIndexedDbBackupStore(); if(store) ...`.
export async function openIndexedDbBackupStore(factory?: IDBFactory): Promise<BackupStore | null>{
    const idb = factory ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined)
    if(typeof idb === "undefined" || idb === null) return null

    let db: IDBDatabase
    try{
        db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = idb.open(BACKUP_DB_NAME, 1)
            req.onupgradeneeded = () => {
                const upgrade = req.result
                if(upgrade.objectStoreNames.contains(BACKUP_STORE_NAME) === false){
                    upgrade.createObjectStore(BACKUP_STORE_NAME)
                }
            }
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => reject(req.error)
            req.onblocked = () => reject(new Error("indexeddb blocked"))
        })
    } catch(e){
        return null
    }

    function run<T>(mode: IDBTransactionMode, body: (s: IDBObjectStore) => IDBRequest): Promise<T>{
        return new Promise<T>((resolve, reject) => {
            let req: IDBRequest
            try{
                const tx = db.transaction(BACKUP_STORE_NAME, mode)
                req = body(tx.objectStore(BACKUP_STORE_NAME))
            } catch(e){
                reject(e)
                return
            }
            req.onsuccess = () => resolve(req.result as T)
            req.onerror = () => reject(req.error)
        })
    }

    return {
        async get(key: string){
            const v = await run<unknown>("readonly", (s) => s.get(key))
            return typeof v === "string" ? v : null
        },
        async set(key: string, value: string){
            await run<unknown>("readwrite", (s) => s.put(value, key))
        },
        async delete(key: string){
            await run<unknown>("readwrite", (s) => s.delete(key))
        },
        async keys(){
            const ks = await run<IDBValidKey[]>("readonly", (s) => s.getAllKeys())
            return ks.map((k) => String(k))
        },
    }
}
