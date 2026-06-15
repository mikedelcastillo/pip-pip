// Pure, DOM-free model for the map ARCHIVE: a holding area that Delete moves a map
// INTO instead of destroying it outright, so a tap on Delete can never lose hours
// of work. The archive mirrors the library's shape (a single localStorage slot
// holding a keyed record of named entries) but stamps each entry with a deletedAt
// and auto-expires it after ARCHIVE_RETENTION_MS. Everything here is framework
// agnostic and tolerant of corrupt/missing storage (returning sane defaults rather
// than throwing), matching game/mapLibrary.ts so it unit-tests the same way.

import { EditorStorage } from "./mapEditor"
import {
    LibraryMutateResult,
    importRawMapToLibrary,
} from "./mapLibrary"

// The localStorage key the archive lives under. Distinct from the library, the
// autosave draft and the play-map handoff, so archiving is purely additive.
export const ARCHIVE_STORAGE_KEY = "pip-pip:map-archive"

// How long a soft-deleted map is kept before it is eligible to be purged: 30 days.
// Purging only happens lazily (on the next archive read/write that passes a clock),
// so a map is always restorable for at least this long after a Delete.
export const ARCHIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

// Caps mirroring the library so the archive can never wedge localStorage. When a
// new archive write would exceed the entry cap, the OLDEST-deleted entry is dropped.
export const ARCHIVE_MAX_ENTRIES = 50
export const ARCHIVE_MAX_BYTES = 4 * 1024 * 1024

// One archived entry: the map serialised exactly as it was stored in the library
// (a GridMapData JSON string, possibly an INVALID one - archiving never validates,
// so even an "Unreadable" map keeps its bytes for recovery), plus when it was
// deleted and its original savedAt (carried through for display + restore order).
export type ArchiveEntry = {
    data: string,
    deletedAt: number,
    savedAt?: number,
}

export type ArchiveRecord = Record<string, ArchiveEntry>

// A read-only summary for the archive list UI: derived dimensions plus the delete
// time and the computed expiry, so the UI can show "deleted 2d ago, kept until ...".
export type ArchiveSummary = {
    name: string,
    cols: number,
    rows: number,
    spawns: number,
    deletedAt: number,
    savedAt?: number,
    expiresAt: number,
}

// Read the whole archive record, tolerating every failure (missing slot, unreadable
// storage, non-JSON, non-object) by returning an empty record. Individual malformed
// entries (non-object, or missing a string `data` / numeric `deletedAt`) are pruned.
function readArchive(storage: EditorStorage): ArchiveRecord{
    let raw: string | null
    try{
        raw = storage.getItem(ARCHIVE_STORAGE_KEY)
    } catch(e){
        return {}
    }
    if(raw === null || raw.length === 0) return {}
    let parsed: unknown
    try{
        parsed = JSON.parse(raw)
    } catch(e){
        return {}
    }
    if(typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    const out: ArchiveRecord = {}
    for(const [name, value] of Object.entries(parsed as Record<string, unknown>)){
        if(typeof value !== "object" || value === null) continue
        const entry = value as Record<string, unknown>
        if(typeof entry.data !== "string") continue
        const deletedAt = typeof entry.deletedAt === "number" && Number.isFinite(entry.deletedAt) ? entry.deletedAt : 0
        const next: ArchiveEntry = { data: entry.data, deletedAt }
        if(typeof entry.savedAt === "number" && Number.isFinite(entry.savedAt)) next.savedAt = entry.savedAt
        out[name] = next
    }
    return out
}

function serializeArchive(archive: ArchiveRecord): string{
    return JSON.stringify(archive)
}

// Derive the dimensions of a stored map for a summary, parsing defensively. An
// unparseable entry reads as a 0x0 map so it still LISTS (and can be restored as
// raw bytes) rather than vanishing.
function deriveDims(data: string): { cols: number, rows: number, spawns: number }{
    let parsed: unknown
    try{
        parsed = JSON.parse(data)
    } catch(e){
        return { cols: 0, rows: 0, spawns: 0 }
    }
    if(typeof parsed !== "object" || parsed === null) return { cols: 0, rows: 0, spawns: 0 }
    const obj = parsed as Record<string, unknown>
    const cols = typeof obj.cols === "number" && Number.isFinite(obj.cols) ? Math.max(0, Math.floor(obj.cols)) : 0
    const rows = typeof obj.rows === "number" && Number.isFinite(obj.rows) ? Math.max(0, Math.floor(obj.rows)) : 0
    const spawns = Array.isArray(obj.spawns) ? obj.spawns.length : 0
    return { cols, rows, spawns }
}

// Drop every entry whose deletedAt is older than the retention window. Pure over the
// record; the caller persists the result. Returns the kept record and the names
// dropped so a caller can log/inform if it wants.
function withoutExpired(archive: ArchiveRecord, now: number): { kept: ArchiveRecord, dropped: string[] }{
    const kept: ArchiveRecord = {}
    const dropped: string[] = []
    for(const [name, entry] of Object.entries(archive)){
        if(now - entry.deletedAt > ARCHIVE_RETENTION_MS){
            dropped.push(name)
        } else{
            kept[name] = entry
        }
    }
    return { kept, dropped }
}

// A non-colliding archive key derived from `base`: archiving the same name twice (or
// re-deleting a restored map) keeps BOTH copies rather than clobbering the older one.
function uniqueArchiveName(archive: ArchiveRecord, base: string): string{
    const stem = base.trim().length > 0 ? base.trim() : "Untitled"
    if(Object.prototype.hasOwnProperty.call(archive, stem) === false) return stem
    const ceiling = Object.keys(archive).length + 2
    for(let i = 1; i <= ceiling; i++){
        const candidate = `${stem} (${i})`
        if(Object.prototype.hasOwnProperty.call(archive, candidate) === false) return candidate
    }
    return `${stem} (${ceiling + 1})`
}

// Move a map's raw bytes into the archive. Called by the Delete flows with the exact
// serialised entry that was in the library (so an invalid/"Unreadable" map still
// keeps its bytes). Expired entries are purged first, then the entry cap is enforced
// by dropping the oldest-deleted entry. The byte ceiling and any storage error are
// caught so an archive write never throws; the worst case is the soft-delete falls
// back to a hard delete and the data is simply not retained. Returns the archive key
// used on success, or null on failure.
export function archivePut(
    storage: EditorStorage,
    name: string,
    data: string,
    deletedAt: number,
    savedAt?: number,
): string | null{
    const purged = withoutExpired(readArchive(storage), deletedAt)
    const archive = purged.kept

    // Enforce the entry cap by evicting the oldest-deleted entries first.
    const names = Object.keys(archive)
    if(names.length >= ARCHIVE_MAX_ENTRIES){
        const sorted = names.sort((a, b) => archive[a].deletedAt - archive[b].deletedAt)
        for(let i = 0; i <= sorted.length - ARCHIVE_MAX_ENTRIES; i++){
            delete archive[sorted[i]]
        }
    }

    const key = uniqueArchiveName(archive, name)
    const entry: ArchiveEntry = { data, deletedAt }
    if(typeof savedAt === "number" && Number.isFinite(savedAt)) entry.savedAt = savedAt
    archive[key] = entry

    const serialised = serializeArchive(archive)
    if(serialised.length > ARCHIVE_MAX_BYTES) return null
    try{
        storage.setItem(ARCHIVE_STORAGE_KEY, serialised)
    } catch(e){
        return null
    }
    return key
}

// List the archived maps that have NOT expired, newest-deleted first. Expired
// entries are filtered out of the view (and lazily purged from storage when `now`
// crosses their expiry on the next write). Never throws.
export function listArchivedMaps(storage: EditorStorage, now: number): ArchiveSummary[]{
    const archive = withoutExpired(readArchive(storage), now).kept
    const summaries: ArchiveSummary[] = []
    for(const [name, entry] of Object.entries(archive)){
        const dims = deriveDims(entry.data)
        const summary: ArchiveSummary = {
            name,
            cols: dims.cols,
            rows: dims.rows,
            spawns: dims.spawns,
            deletedAt: entry.deletedAt,
            expiresAt: entry.deletedAt + ARCHIVE_RETENTION_MS,
        }
        if(typeof entry.savedAt === "number") summary.savedAt = entry.savedAt
        summaries.push(summary)
    }
    summaries.sort((a, b) => b.deletedAt - a.deletedAt)
    return summaries
}

// Fetch one archived entry by name (raw bytes included), or null when absent.
export function getArchiveEntry(storage: EditorStorage, name: string): ArchiveEntry | null{
    const archive = readArchive(storage)
    const entry = archive[name.trim()]
    return typeof entry === "undefined" ? null : entry
}

// Permanently remove an archived entry (used after a successful restore, or for an
// explicit "delete forever"). Returns true when an entry was removed and the write
// succeeded. Never throws.
export function removeArchivedMap(storage: EditorStorage, name: string): boolean{
    const trimmed = name.trim()
    const archive = readArchive(storage)
    if(Object.prototype.hasOwnProperty.call(archive, trimmed) === false) return false
    delete archive[trimmed]
    try{
        storage.setItem(ARCHIVE_STORAGE_KEY, serializeArchive(archive))
    } catch(e){
        return false
    }
    return true
}

// Drop every expired entry from storage now. Returns the number purged. Called on
// the library home mount so the archive self-cleans over time. Never throws.
export function purgeExpiredArchive(storage: EditorStorage, now: number): number{
    const archive = readArchive(storage)
    const { kept, dropped } = withoutExpired(archive, now)
    if(dropped.length === 0) return 0
    try{
        storage.setItem(ARCHIVE_STORAGE_KEY, serializeArchive(kept))
    } catch(e){
        return 0
    }
    return dropped.length
}

// Restore an archived map back into the library under a fresh, non-colliding name,
// then remove it from the archive. The raw bytes are written verbatim (so even a map
// that was "Unreadable" when deleted is restored exactly, to be repaired via the
// recovery tools if needed). Returns the library result so the caller can report the
// resulting name; the archive entry is only removed once the library write succeeds.
export function restoreArchivedMap(
    storage: EditorStorage,
    name: string,
    now?: number,
): LibraryMutateResult{
    const entry = getArchiveEntry(storage, name)
    if(entry === null){
        return { ok: false, reason: "missing", message: "That map is no longer in the archive." }
    }
    const result = importRawMapToLibrary(storage, entry.data, name.trim(), now)
    if(result.ok) removeArchivedMap(storage, name)
    return result
}
