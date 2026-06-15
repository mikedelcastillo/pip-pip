// Pure, dependency-free model for the editor MAPS LIBRARY: a personal collection
// of NAMED maps the author keeps in localStorage, on top of the single autosave
// draft (game/mapEditor.ts). Where the autosave is one rolling slot and the
// play-map stash is one handoff slot, the LIBRARY is a keyed RECORD of many named
// entries the author saves under a name, then loads or deletes later. Everything
// here is framework-agnostic and DOM-free so it unit-tests cleanly (see
// tests/client/mapLibrary.test.ts): it follows the exact patterns the autosave +
// play-handoff helpers use (an injectable Storage param, try/catch around JSON +
// storage, and tolerating corrupt/missing data by returning a sane default).

import {
    GridMapData,
    validateGridMapData,
} from "@pip-pip/game/src/logic/grid-map"
import { EditorStorage, serializeGridMapData } from "./mapEditor"

// The library reuses the SAME minimal storage surface the autosave/play helpers
// use (getItem/setItem/removeItem), so window.localStorage satisfies it and a test
// can pass a tiny fake object. Aliased from mapEditor's EditorStorage so there is
// one storage contract across every persistence helper.
export type LibraryStorage = EditorStorage

// The localStorage key the maps LIBRARY lives under. DISTINCT from the autosave
// draft (EDITOR_STORAGE_KEY) and the play-map handoff (PLAY_MAP_STORAGE_KEY), so
// the library is purely additive and can never clobber either: the editor still
// autosaves its working draft and stashes a play-map exactly as before. One key
// holds the WHOLE library (a record of named entries) so a save/list/delete is a
// single read-modify-write of one slot.
export const LIBRARY_STORAGE_KEY = "pip-pip:map-library"

// The hard CAP on how many named maps the library keeps. A sane ceiling so a
// runaway loop or a bored author cannot grow the single localStorage slot without
// bound; well above any realistic personal collection. When the library is AT the
// cap and the author saves a brand-NEW name, the OLDEST entry (by savedAt, then by
// insertion) is DROPPED to make room (an LRU-style eviction) so a save always
// succeeds rather than failing once full. Overwriting an EXISTING name never
// evicts (the count does not grow).
export const LIBRARY_MAX_ENTRIES = 50

// A rough BYTE ceiling on the serialised library, a backstop beneath the entry
// cap: even 50 large maps must not wedge localStorage. A write whose serialised
// size exceeds this is REJECTED (the prior library is left intact) rather than
// attempted, and any storage quota error from setItem is caught and surfaced as a
// failure too. 4 MiB is comfortably under the typical ~5 MiB per-origin
// localStorage budget while holding far more than a normal collection.
export const LIBRARY_MAX_BYTES = 4 * 1024 * 1024

// One stored library ENTRY: the serialised GridMapData (the SAME JSON shape the
// autosave/play-map slots store, via serializeGridMapData) plus an optional
// savedAt millis timestamp. The timestamp is OPTIONAL and is never produced here
// (this model never calls Date.now - the caller passes a timestamp in, or omits
// it) so the model stays pure and deterministic for tests.
export type LibraryEntry = {
    // The map serialised as a GridMapData JSON string (parseable by
    // parseGridMapData / validateGridMapData). Stored as a string so the library
    // record is itself just JSON-of-strings, mirroring the autosave slot's format.
    data: string,
    // When the entry was saved, in epoch millis. Optional: omitted when the caller
    // passes no timestamp. Used to sort the list (newest first) and to choose the
    // oldest entry to evict at the cap.
    savedAt?: number,
}

// The on-disk LIBRARY shape: a flat record from trimmed map NAME to its entry. A
// plain object (not a Map) so it serialises straight to JSON. The name is the
// stable identity, so saving under an existing name OVERWRITES that entry.
export type LibraryRecord = Record<string, LibraryEntry>

// A read-only SUMMARY of one library entry for the list UI: its name, derived
// dimensions (cols/rows) and spawn count, plus the optional savedAt. Derived from
// the stored GridMapData so the UI needs no parsing of its own. A corrupt entry is
// skipped during listing, so every summary returned here is well-formed.
export type LibrarySummary = {
    name: string,
    cols: number,
    rows: number,
    spawns: number,
    savedAt?: number,
}

// The result of a save attempt. A discriminated union so the caller can show a
// precise status: ok plus the trimmed name on success; otherwise a reason
// ("empty-name" for a blank/whitespace name, "too-large" when the serialised
// library would exceed LIBRARY_MAX_BYTES, "storage" when localStorage itself
// rejected the write e.g. quota/private mode) plus a human message. Never throws.
export type LibrarySaveResult =
    | { ok: true, name: string, evicted?: string, evictedData?: string }
    | { ok: false, reason: "empty-name" | "too-large" | "storage" | "invalid", message: string }

// Read the WHOLE library record from storage, tolerating every failure: a missing
// slot, unreadable storage, non-JSON, or a non-object all return an EMPTY record
// rather than throwing. Corrupt INDIVIDUAL entries are pruned to a well-formed
// shape (a non-object entry, or one without a string `data`, is dropped) so a
// single bad entry can never poison the rest. Internal: the public helpers build
// on this.
function readLibrary(storage: LibraryStorage): LibraryRecord{
    let raw: string | null
    try{
        raw = storage.getItem(LIBRARY_STORAGE_KEY)
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
    const out: LibraryRecord = {}
    for(const [name, value] of Object.entries(parsed as Record<string, unknown>)){
        if(typeof value !== "object" || value === null) continue
        const entry = value as Record<string, unknown>
        if(typeof entry.data !== "string") continue
        const next: LibraryEntry = { data: entry.data }
        if(typeof entry.savedAt === "number" && Number.isFinite(entry.savedAt)){
            next.savedAt = entry.savedAt
        }
        out[name] = next
    }
    return out
}

// Serialise a library record to its JSON string. Centralised so the byte-guard and
// the actual write measure/persist the EXACT same string.
function serializeLibrary(library: LibraryRecord): string{
    return JSON.stringify(library)
}

// Save (or OVERWRITE) the current map under a name. The name is TRIMMED and a
// blank/whitespace name is REJECTED (empty-name). An existing trimmed name is
// overwritten in place (the entry count does not grow). When adding a brand-NEW
// name would exceed LIBRARY_MAX_ENTRIES, the OLDEST entry (lowest savedAt, then
// first inserted) is evicted to make room so the save still succeeds. The write is
// guarded twice: the serialised library must fit LIBRARY_MAX_BYTES (else
// too-large, prior library untouched), and any storage error from setItem is
// caught (else storage). `now` is an OPTIONAL timestamp the caller passes (this
// model never reads the clock); when omitted the entry carries no savedAt.
export function saveMapToLibrary(
    storage: LibraryStorage,
    name: string,
    data: GridMapData,
    now?: number,
): LibrarySaveResult{
    const trimmed = name.trim()
    if(trimmed.length === 0){
        return { ok: false, reason: "empty-name", message: "Enter a name to save the map." }
    }

    // The SAFE save path never persists a map that could not load back: the editor
    // used to write whatever it exported and report success, so a degenerate or
    // out-of-range (e.g. too-big) map saved "ok" yet showed as Unreadable forever.
    // Reject invalid data here so the only way bad bytes reach the library is the
    // explicit raw import used by the recovery tools. Callers repair-then-save (see
    // the editor's Save to library) so a large map is adjusted to fit, not lost. Note
    // a VALID but empty map (1x1, no tiles) still saves; the caller decides whether to
    // skip an empty bound-autosave so a cleared canvas does not clobber a saved card.
    if(validateGridMapData(data) === null){
        return { ok: false, reason: "invalid", message: "This map can not be saved yet (it is empty, or too big to load). Try Auto-fix, or make it a little smaller." }
    }

    const library = readLibrary(storage)
    const isNew = Object.prototype.hasOwnProperty.call(library, trimmed) === false

    // At the cap and adding a NEW name: evict the OLDEST entry so the save still
    // lands. "Oldest" = lowest savedAt; entries without a savedAt sort as oldest
    // (treated as -Infinity), and Object.entries preserves insertion order so the
    // first-inserted of a tie is chosen. Overwriting an existing name never evicts.
    let evicted: string | undefined
    // The evicted entry's RAW bytes, returned so the caller can move them to the 30-day
    // archive rather than destroying a real saved map on a routine save.
    let evictedData: string | undefined
    if(isNew && Object.keys(library).length >= LIBRARY_MAX_ENTRIES){
        let oldestName: string | null = null
        let oldestAt = Infinity
        for(const [entryName, entry] of Object.entries(library)){
            const at = typeof entry.savedAt === "number" ? entry.savedAt : -Infinity
            if(at < oldestAt){
                oldestAt = at
                oldestName = entryName
            }
        }
        if(oldestName !== null){
            evictedData = library[oldestName].data
            delete library[oldestName]
            evicted = oldestName
        }
    }

    const entry: LibraryEntry = { data: serializeGridMapData(data) }
    if(typeof now === "number" && Number.isFinite(now)) entry.savedAt = now
    library[trimmed] = entry

    const serialised = serializeLibrary(library)
    // Total-size backstop: reject a write that would blow the byte ceiling rather
    // than attempt it, leaving the prior library exactly as it was on disk.
    if(serialised.length > LIBRARY_MAX_BYTES){
        return { ok: false, reason: "too-large", message: "Library is full. Delete a saved map and try again." }
    }
    try{
        storage.setItem(LIBRARY_STORAGE_KEY, serialised)
    } catch(e){
        // Quota exceeded / storage disabled (private mode): surface a failure so the
        // UI can tell the author, rather than silently losing the save.
        return { ok: false, reason: "storage", message: "Could not save to the library (storage is full or unavailable)." }
    }
    return evicted !== undefined ? { ok: true, name: trimmed, evicted, evictedData } : { ok: true, name: trimmed }
}

// Summarise every saved map for the list UI, SORTED for a stable display: newest
// first by savedAt (entries with no savedAt sort last), then alphabetically by
// name as a tiebreaker. Each summary's cols/rows/spawns are DERIVED from the
// stored GridMapData (parsed defensively); an entry whose JSON is unparseable or
// structurally wrong is SKIPPED (never throws), so a single corrupt entry never
// breaks the list. Returns an empty array on missing/unreadable storage.
export function listLibraryMaps(storage: LibraryStorage): LibrarySummary[]{
    const library = readLibrary(storage)
    const summaries: LibrarySummary[] = []
    for(const [name, entry] of Object.entries(library)){
        let parsed: unknown
        try{
            parsed = JSON.parse(entry.data)
        } catch(e){
            continue
        }
        if(typeof parsed !== "object" || parsed === null) continue
        const obj = parsed as Record<string, unknown>
        const cols = typeof obj.cols === "number" && Number.isFinite(obj.cols) ? Math.max(0, Math.floor(obj.cols)) : 0
        const rows = typeof obj.rows === "number" && Number.isFinite(obj.rows) ? Math.max(0, Math.floor(obj.rows)) : 0
        const spawns = Array.isArray(obj.spawns) ? obj.spawns.length : 0
        const summary: LibrarySummary = { name, cols, rows, spawns }
        if(typeof entry.savedAt === "number" && Number.isFinite(entry.savedAt)) summary.savedAt = entry.savedAt
        summaries.push(summary)
    }
    summaries.sort((a, b) => {
        // Newest first: a missing savedAt sorts as oldest, so it lands at the end.
        const at = typeof a.savedAt === "number" ? a.savedAt : -Infinity
        const bt = typeof b.savedAt === "number" ? b.savedAt : -Infinity
        if(at !== bt) return bt - at
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    })
    return summaries
}

// Load a named map back as a parsed + VALIDATED GridMapData, or null when there is
// no such entry, the stored JSON is corrupt, or it fails validateGridMapData (the
// SAME gate every custom-map source passes through). Validating here means a
// hand-corrupted or oversized library entry can NEVER crash the editor when
// loaded; the caller treats null as "could not load this map". Never throws.
export function loadMapFromLibrary(storage: LibraryStorage, name: string): GridMapData | null{
    const library = readLibrary(storage)
    const entry = library[name.trim()]
    if(typeof entry === "undefined") return null
    let parsed: unknown
    try{
        parsed = JSON.parse(entry.data)
    } catch(e){
        return null
    }
    // validateGridMapData returns null on ANY structural problem (never throws), so
    // a malformed entry degrades to "not loadable" instead of corrupting the editor.
    return validateGridMapData(parsed)
}

// Delete a named entry from the library, persisting the smaller record. A missing
// name is a no-op (and still a clean success path). Every failure is swallowed
// (unreadable / unwritable storage) so a delete never throws; the worst case is
// the entry simply remains. Returns true when an entry was actually removed and
// the write succeeded, false otherwise, so the caller can refresh the list either
// way.
export function deleteMapFromLibrary(storage: LibraryStorage, name: string): boolean{
    const trimmed = name.trim()
    const library = readLibrary(storage)
    if(Object.prototype.hasOwnProperty.call(library, trimmed) === false) return false
    delete library[trimmed]
    try{
        storage.setItem(LIBRARY_STORAGE_KEY, serializeLibrary(library))
    } catch(e){
        return false
    }
    return true
}

// A library name DERIVED from `base` that does not collide with any EXISTING entry
// in the given record. When `base` (trimmed) is free it is returned as-is;
// otherwise " copy" is appended, then " copy 2", " copy 3" ... until a free name is
// found. A blank base falls back to a default stem so the result is always a usable
// non-empty name. Pure over the passed record (it never reads storage itself), so
// the duplicate helper and any caller can reuse it deterministically. The loop is
// bounded by the record size, so it always terminates with a free name.
export function uniqueLibraryName(library: LibraryRecord, base: string): string{
    const stem = base.trim().length > 0 ? base.trim() : "Untitled"
    if(Object.prototype.hasOwnProperty.call(library, stem) === false) return stem
    // First try a plain " copy", then numbered copies. Bounded by the entry count
    // so even a fully colliding library still resolves to a free name.
    const ceiling = Object.keys(library).length + 2
    for(let i = 1; i <= ceiling; i++){
        const candidate = i === 1 ? `${stem} copy` : `${stem} copy ${i}`
        if(Object.prototype.hasOwnProperty.call(library, candidate) === false) return candidate
    }
    // Unreachable in practice (the loop ceiling exceeds the collision count), but a
    // final fallback keeps the return total: tack the count on so it stays unique.
    return `${stem} copy ${ceiling + 1}`
}

// The result of a duplicate/rename attempt. A discriminated union mirroring
// LibrarySaveResult so the caller can show a precise status: ok plus the resulting
// name; otherwise a reason ("missing" when the source entry is gone, "empty-name"
// for a blank rename target, "exists" when a rename target name is already taken,
// "storage" when localStorage rejected the write) plus a human message. Never throws.
export type LibraryMutateResult =
    | { ok: true, name: string }
    | { ok: false, reason: "missing" | "empty-name" | "exists" | "storage", message: string }

// DUPLICATE a named entry under a fresh, non-colliding name (via uniqueLibraryName),
// copying its stored map data verbatim. The COPY's name is mirrored INTO the copied
// GridMapData JSON too (when parseable) so the duplicate opens in the editor under
// its new name rather than the original's. Returns the new name on success, or a
// "missing" failure when the source is gone / a "storage" failure when the write is
// rejected. `now` is an OPTIONAL timestamp (this model never reads the clock); when
// given it stamps the copy so it sorts newest-first. Never throws.
export function duplicateLibraryMap(
    storage: LibraryStorage,
    name: string,
    now?: number,
): LibraryMutateResult{
    const trimmed = name.trim()
    const library = readLibrary(storage)
    const source = library[trimmed]
    if(typeof source === "undefined"){
        return { ok: false, reason: "missing", message: "That map is no longer in your library." }
    }
    const newName = uniqueLibraryName(library, trimmed)
    // Re-stamp the copied map's own `name` field to the new name so the duplicate
    // loads in the editor titled as the copy. A non-object / unparseable payload is
    // copied verbatim (the worst case is the editor showing the source's name).
    const data = renameSerializedMap(source.data, newName)
    const entry: LibraryEntry = { data }
    if(typeof now === "number" && Number.isFinite(now)) entry.savedAt = now
    library[newName] = entry
    try{
        storage.setItem(LIBRARY_STORAGE_KEY, serializeLibrary(library))
    } catch(e){
        return { ok: false, reason: "storage", message: "Could not duplicate (storage is full or unavailable)." }
    }
    return { ok: true, name: newName }
}

// RENAME a library entry from one name to another. The target is TRIMMED and a
// blank/whitespace target is REJECTED (empty-name). A no-op rename (same trimmed
// name) succeeds without touching storage. Renaming onto an EXISTING different
// name is REJECTED (exists) so a rename never silently clobbers another saved map;
// a missing source is REJECTED (missing). On success the entry moves to the new key
// (preserving its savedAt) and the map's own `name` field is re-stamped to match,
// so re-opening it shows the new title. Never throws.
export function renameLibraryMap(
    storage: LibraryStorage,
    from: string,
    to: string,
): LibraryMutateResult{
    const fromTrimmed = from.trim()
    const toTrimmed = to.trim()
    if(toTrimmed.length === 0){
        return { ok: false, reason: "empty-name", message: "Enter a name for the map." }
    }
    const library = readLibrary(storage)
    const source = library[fromTrimmed]
    if(typeof source === "undefined"){
        return { ok: false, reason: "missing", message: "That map is no longer in your library." }
    }
    // A rename to the SAME (trimmed) name is a clean no-op success: nothing to move.
    if(toTrimmed === fromTrimmed) return { ok: true, name: toTrimmed }
    if(Object.prototype.hasOwnProperty.call(library, toTrimmed)){
        return { ok: false, reason: "exists", message: "A map with that name already exists." }
    }
    // Move the entry to the new key, re-stamping the map's own name field to match,
    // and drop the old key so only the renamed entry remains.
    const moved: LibraryEntry = { data: renameSerializedMap(source.data, toTrimmed) }
    if(typeof source.savedAt === "number") moved.savedAt = source.savedAt
    delete library[fromTrimmed]
    library[toTrimmed] = moved
    try{
        storage.setItem(LIBRARY_STORAGE_KEY, serializeLibrary(library))
    } catch(e){
        return { ok: false, reason: "storage", message: "Could not rename (storage is full or unavailable)." }
    }
    return { ok: true, name: toTrimmed }
}

// Fetch ONE library entry verbatim (its raw stored `data` string + savedAt), or
// null when absent. Unlike loadMapFromLibrary this does NOT validate or parse, so a
// map that fails validation (e.g. an "Unreadable" card) still yields its exact bytes
// - the soft-delete + recovery tools need the raw payload, not a parsed map. Reads
// through readLibrary so a corrupt slot degrades to null rather than throwing.
export function getLibraryEntry(storage: LibraryStorage, name: string): LibraryEntry | null{
    const library = readLibrary(storage)
    const entry = library[name.trim()]
    return typeof entry === "undefined" ? null : entry
}

// Write a RAW serialised-map string into the library under a fresh, non-colliding
// name (derived from `preferredName`). This is the recovery/restore counterpart to
// saveMapToLibrary: it deliberately does NOT validate, so the exact recovered bytes
// (even an as-yet-unrepaired map) are preserved verbatim and can be opened or fixed
// later. The stored map's own `name` field is re-stamped to the resulting name (best
// effort) so it opens titled correctly. Guarded by the same byte ceiling + storage
// try/catch as every other write; never throws.
export function importRawMapToLibrary(
    storage: LibraryStorage,
    data: string,
    preferredName: string,
    now?: number,
): LibraryMutateResult{
    const library = readLibrary(storage)
    const name = uniqueLibraryName(library, preferredName)
    const entry: LibraryEntry = { data: renameSerializedMap(data, name) }
    if(typeof now === "number" && Number.isFinite(now)) entry.savedAt = now
    library[name] = entry
    const serialised = serializeLibrary(library)
    if(serialised.length > LIBRARY_MAX_BYTES){
        return { ok: false, reason: "storage", message: "Library is full. Delete a saved map and try again." }
    }
    try{
        storage.setItem(LIBRARY_STORAGE_KEY, serialised)
    } catch(e){
        return { ok: false, reason: "storage", message: "Could not save (storage is full or unavailable)." }
    }
    return { ok: true, name }
}

// The editor ROUTE path that opens a specific library map by name, e.g.
// editorMapPath("My Arena") -> "/editor/My%20Arena". The name is URL-encoded so a
// name with spaces / slashes / punctuation survives the route (the editor decodes
// it via decodeURIComponent on the :mapName param). Kept here (DOM-free, pure) so
// the route shape is shared by the library home + any other caller and is testable.
export function editorMapPath(name: string): string{
    return `/editor/${encodeURIComponent(name)}`
}

// Re-stamp the `name` field inside a serialised GridMapData JSON string to `name`,
// returning the re-serialised string. A non-object / unparseable payload is returned
// UNCHANGED (best-effort: the duplicate/rename still lands, the stored title just
// trails the key). Internal helper for duplicate + rename so both keep the stored
// map's own name in lockstep with its library key. Never throws.
function renameSerializedMap(data: string, name: string): string{
    let parsed: unknown
    try{
        parsed = JSON.parse(data)
    } catch(e){
        return data
    }
    if(typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return data
    try{
        return JSON.stringify({ ...(parsed as Record<string, unknown>), name })
    } catch(e){
        return data
    }
}
