// Pure, DOM-free recovery model: find maps that are STILL in storage but no longer
// load, and repair them back into something the game will accept. This is the
// engine behind the "Recover lost maps" tools on the Map Maker screen. It exists
// because the library's save path never validated what it wrote while the load path
// validates strictly, so a large or slightly-malformed map could be saved "ok" yet
// show as Unreadable forever - with every tile still physically present in storage.
//
// Two jobs:
//   1. repairGridMapData: coerce an untrusted blob toward a valid GridMapData
//      WITHOUT discarding content (the headline case is a big map that overflows the
//      world-extent guard; we re-centre it and, if needed, shrink the cell size so
//      it fits, losing nothing but world scale).
//   2. scan/collect: read the RAW bytes from every storage surface (even library
//      entries that fail validation) and classify each as healthy / repairable / raw
//      so the UI can offer Restore, Auto-fix and restore, or Export raw.
//
// Everything is pure over an injected storage object and tolerant of every failure,
// matching game/mapLibrary.ts and game/mapArchive.ts so it unit-tests the same way.

import {
    GridMapData,
    TileShape,
    validateGridMapData,
    GRID_DEFAULT_CELL_SIZE,
    GRID_TILE_DEFAULT_KEY,
    MAX_CUSTOM_CELLS,
} from "@pip-pip/game/src/logic/grid-map"
import { WORLD_QUANT_RANGE } from "@pip-pip/game/src/logic/constants"
import { EditorStorage, EDITOR_STORAGE_KEY, PLAY_MAP_STORAGE_KEY } from "./mapEditor"
import { LIBRARY_STORAGE_KEY } from "./mapLibrary"
import { ARCHIVE_STORAGE_KEY } from "./mapArchive"

// The palette shapes the validator accepts, for coercing an unknown shape back to a
// safe value (kept local since grid-map does not export its list).
const VALID_SHAPES: TileShape[] = ["full", "diag_tl", "diag_tr", "diag_bl", "diag_br", "deco",
    "half_top", "half_bottom", "half_left", "half_right"]

function isFiniteNumber(v: unknown): v is number{
    return typeof v === "number" && Number.isFinite(v)
}

// Count the cells that actually hold a tile (the content score the UI ranks by).
export function countNonEmptyTiles(data: GridMapData): number{
    let n = 0
    for(const t of data.tiles) if(t > 0) n++
    return n
}

// A cheap position-sensitive checksum of a tiles array, so the dedupe signature can
// tell two maps of the SAME size + tile count but DIFFERENT layouts apart (otherwise
// a genuinely distinct map could hide a same-shaped one). Plain rolling hash; not
// cryptographic, just a collision-resistant-enough fingerprint.
function tilesChecksum(tiles: number[]): number{
    let h = 0
    for(let i = 0; i < tiles.length; i++){
        h = (h * 31 + tiles[i] + i * 7) | 0
    }
    return h
}

// Does this parsed value look enough like a map to bother offering recovery for? It
// must be an object carrying a tiles array or numeric cols/rows; anything else is
// some other piece of saved data, not a map.
function looksMapish(value: unknown): boolean{
    if(typeof value !== "object" || value === null || Array.isArray(value)) return false
    const obj = value as Record<string, unknown>
    return Array.isArray(obj.tiles) || (isFiniteNumber(obj.cols) && isFiniteNumber(obj.rows))
}

export type RepairResult =
    | { ok: true, data: GridMapData, repairs: string[] }
    | { ok: false }

// The worst-case world extent the validator computes, as a function of cell size.
// Because both the cell term and the half-cell padding scale linearly with cellSize,
// the extent equals cellSize * extentAtUnitCell, which lets us solve for the largest
// cell size that fits in one step.
function cellExtremes(cols: number, rows: number, spawns: [number, number][], segments?: [number, number, number, number][]){
    let minCol = 0
    let maxCol = cols - 1
    let minRow = 0
    let maxRow = rows - 1
    const include = (c: number, r: number) => {
        if(c < minCol) minCol = c
        if(c > maxCol) maxCol = c
        if(r < minRow) minRow = r
        if(r > maxRow) maxRow = r
    }
    for(const [c, r] of spawns) include(c, r)
    if(segments) for(const [sc, sr, ec, er] of segments){ include(sc, sr); include(ec, er) }
    return { minCol, maxCol, minRow, maxRow }
}

function worldExtent(data: GridMapData, originCol: number, originRow: number, cellSize: number): number{
    const { minCol, maxCol, minRow, maxRow } = cellExtremes(data.cols, data.rows, data.spawns, data.segments)
    const half = cellSize / 2
    const ex = Math.max(Math.abs((minCol + originCol) * cellSize - half), Math.abs((maxCol + originCol) * cellSize + half))
    const ey = Math.max(Math.abs((minRow + originRow) * cellSize - half), Math.abs((maxRow + originRow) * cellSize + half))
    return Math.max(ex, ey)
}

// Bring a map whose world bounds exceed WORLD_QUANT_RANGE back into range, preserving
// every tile: first re-centre it via the cell-space origin (halving the worst-case
// extent), then, only if still over, reduce the cell size to the largest value that
// fits. The design is untouched; only its world scale shrinks.
function fitWorldBounds(data: GridMapData): { data: GridMapData, changed: boolean, repairs: string[] }{
    let originCol = data.originCol ?? 0
    let originRow = data.originRow ?? 0
    let cellSize = data.cellSize
    if(worldExtent(data, originCol, originRow, cellSize) <= WORLD_QUANT_RANGE){
        return { data, changed: false, repairs: [] }
    }
    const repairs: string[] = []
    const { minCol, maxCol, minRow, maxRow } = cellExtremes(data.cols, data.rows, data.spawns, data.segments)
    originCol = -Math.round((minCol + maxCol) / 2)
    originRow = -Math.round((minRow + maxRow) / 2)
    repairs.push("re-centre the map to fit the play area")
    if(worldExtent(data, originCol, originRow, cellSize) > WORLD_QUANT_RANGE){
        // extent = cellSize * extentAtUnitCell, so the largest cell size that fits is
        // RANGE / extentAtUnitCell (floored to an integer, at least 1).
        const unit = worldExtent(data, originCol, originRow, 1)
        const maxCs = Math.max(1, Math.floor(WORLD_QUANT_RANGE / unit))
        cellSize = Math.min(cellSize, maxCs)
        repairs.push("scale the map down to fit the play area")
    }
    return { data: { ...data, cellSize, originCol, originRow }, changed: true, repairs }
}

// Coerce an untrusted value (a parsed object or a raw JSON string) toward a valid
// GridMapData without throwing away real content. Returns the repaired map plus a
// human-readable trail of what was changed, or ok:false when nothing map-like can be
// salvaged. A value that already validates is returned unchanged with no repairs.
export function repairGridMapData(value: unknown): RepairResult{
    let parsed: unknown = value
    if(typeof value === "string"){
        try{
            parsed = JSON.parse(value)
        } catch(e){
            return { ok: false }
        }
    }
    if(looksMapish(parsed) === false) return { ok: false }
    const obj = parsed as Record<string, unknown>
    const repairs: string[] = []

    // name
    let name: string
    if(typeof obj.name === "string" && obj.name.trim().length > 0){
        name = obj.name
    } else{
        name = "Recovered Map"
        repairs.push("give the map a name")
    }

    // cellSize
    let cellSize: number
    if(isFiniteNumber(obj.cellSize) && obj.cellSize > 0){
        cellSize = obj.cellSize
    } else{
        cellSize = GRID_DEFAULT_CELL_SIZE
        repairs.push("restore the default cell size")
    }

    // tiles: coerce each to a non-negative integer index.
    let tiles: number[] = []
    if(Array.isArray(obj.tiles)){
        let coerced = false
        tiles = (obj.tiles as unknown[]).map((t) => {
            if(isFiniteNumber(t) && Math.floor(t) === t && t >= 0) return t
            coerced = true
            const floored = isFiniteNumber(t) ? Math.floor(t) : 0
            return floored > 0 ? floored : 0
        })
        if(coerced) repairs.push("clean up out-of-range tile values")
    }

    // cols/rows reconciliation against the tile count, preferring to KEEP tiles.
    let cols = isFiniteNumber(obj.cols) && obj.cols >= 1 ? Math.floor(obj.cols) : 0
    let rows = isFiniteNumber(obj.rows) && obj.rows >= 1 ? Math.floor(obj.rows) : 0
    const len = tiles.length

    if(cols >= 1 && rows >= 1 && cols * rows === len){
        // consistent, nothing to do
    } else if(cols >= 1 && len > 0 && len % cols === 0){
        const derived = len / cols
        if(derived !== rows) repairs.push("set the row count from the tile count")
        rows = derived
    } else if(rows >= 1 && len > 0 && len % rows === 0){
        const derived = len / rows
        if(derived !== cols) repairs.push("set the column count from the tile count")
        cols = derived
    } else if(cols >= 1 && rows >= 1){
        const target = cols * rows
        if(len < target){
            tiles = tiles.concat(new Array(target - len).fill(0))
            repairs.push("fill in missing tile cells")
        } else if(len > target){
            tiles = tiles.slice(0, target)
            repairs.push("trim extra tile cells")
        }
    } else if(len > 0){
        cols = Math.ceil(Math.sqrt(len))
        rows = Math.ceil(len / cols)
        repairs.push("rebuild the grid shape from the tile count")
    } else{
        cols = 1
        rows = 1
        tiles = [0]
        repairs.push("rebuild an empty grid")
    }

    // Final length reconcile (covers the derive/near-square branches).
    const target = cols * rows
    if(tiles.length !== target){
        tiles = tiles.length < target ? tiles.concat(new Array(target - tiles.length).fill(0)) : tiles.slice(0, target)
    }

    // Beyond the engine's hard cell cap there is no in-engine representation, so the
    // map can only be exported raw, not auto-fixed.
    if(cols * rows > MAX_CUSTOM_CELLS) return { ok: false }

    // palette: preserve the index count (tiles reference palette[n-1]); coerce any
    // malformed entry rather than dropping it and shifting every index.
    let palette: { key: string, shape: TileShape }[] = []
    if(Array.isArray(obj.palette)){
        let coerced = false
        palette = (obj.palette as unknown[]).map((e) => {
            if(e !== null && typeof e === "object"){
                const ee = e as Record<string, unknown>
                let key = GRID_TILE_DEFAULT_KEY
                if(typeof ee.key === "string") key = ee.key
                else coerced = true
                let shape: TileShape = "full"
                if(typeof ee.shape === "string" && VALID_SHAPES.indexOf(ee.shape as TileShape) !== -1) shape = ee.shape as TileShape
                else coerced = true
                return { key, shape }
            }
            coerced = true
            return { key: GRID_TILE_DEFAULT_KEY, shape: "full" as TileShape }
        })
        if(coerced) repairs.push("repair the tile palette")
    }
    // Ensure the palette covers the highest tile index any cell references.
    let maxRef = 0
    for(const t of tiles) if(t > maxRef) maxRef = t
    if(palette.length < maxRef){
        while(palette.length < maxRef) palette.push({ key: GRID_TILE_DEFAULT_KEY, shape: "full" })
        repairs.push("add missing palette entries")
    }

    // spawns: keep the good ones (flooring floats), drop the junk.
    const spawns: [number, number][] = []
    if(Array.isArray(obj.spawns)){
        let dropped = false
        for(const s of obj.spawns as unknown[]){
            if(Array.isArray(s) && s.length === 2 && isFiniteNumber(s[0]) && isFiniteNumber(s[1])){
                spawns.push([Math.floor(s[0]), Math.floor(s[1])])
            } else{
                dropped = true
            }
        }
        if(dropped) repairs.push("drop damaged spawn points")
    }

    // optional origin + segments
    const originCol = isFiniteNumber(obj.originCol) ? Math.floor(obj.originCol) : undefined
    const originRow = isFiniteNumber(obj.originRow) ? Math.floor(obj.originRow) : undefined
    let segments: [number, number, number, number][] | undefined
    if(Array.isArray(obj.segments)){
        const segs: [number, number, number, number][] = []
        let dropped = false
        for(const s of obj.segments as unknown[]){
            if(Array.isArray(s) && s.length === 4 && s.every((c: unknown) => isFiniteNumber(c))){
                segs.push([Math.floor(s[0]), Math.floor(s[1]), Math.floor(s[2]), Math.floor(s[3])])
            } else{
                dropped = true
            }
        }
        if(dropped) repairs.push("drop damaged wall segments")
        segments = segs
    }

    let data: GridMapData = { name, cellSize, cols, rows, tiles, spawns, palette }
    if(originCol !== undefined) data.originCol = originCol
    if(originRow !== undefined) data.originRow = originRow
    if(segments !== undefined) data.segments = segments

    // World-extent guard: a big map fails validation purely on its world size. Fit it
    // back into range, which is the single most common repair here.
    if(validateGridMapData(data) === null){
        const fitted = fitWorldBounds(data)
        if(fitted.changed){
            data = fitted.data
            repairs.push(...fitted.repairs)
        }
    }

    const valid = validateGridMapData(data)
    if(valid === null) return { ok: false }
    return { ok: true, data: valid, repairs }
}

// Where a recovery candidate came from, for labelling + dedupe priority.
export type RecoverySource = "library" | "draft" | "play-map" | "archive" | "backup" | "orphan"

// A raw map blob pulled from a storage surface: the exact serialised-GridMapData
// string (NOT the library/archive wrapper), plus where it came from.
export type RawBlob = {
    source: RecoverySource,
    id: string,
    label: string,
    raw: string,
    savedAt?: number,
}

export type RecoveryStatus = "healthy" | "repairable" | "raw"

// One classified, deduped recovery candidate for the UI.
export type RecoveryCandidate = {
    key: string,
    source: RecoverySource,
    id: string,
    label: string,
    status: RecoveryStatus,
    raw: string,
    // The map ready to restore: the validated map (healthy), the repaired map
    // (repairable), or null (raw - exportable but not auto-fixable).
    data: GridMapData | null,
    repairs: string[],
    tileCount: number,
    cols: number,
    rows: number,
    spawns: number,
    savedAt?: number,
}

const SOURCE_RANK: Record<RecoverySource, number> = {
    library: 0, archive: 1, draft: 2, "play-map": 3, backup: 4, orphan: 5,
}
const STATUS_RANK: Record<RecoveryStatus, number> = { healthy: 0, repairable: 1, raw: 2 }

function dimsOf(parsed: unknown): { cols: number, rows: number, spawns: number, tiles: number }{
    if(typeof parsed !== "object" || parsed === null) return { cols: 0, rows: 0, spawns: 0, tiles: 0 }
    const obj = parsed as Record<string, unknown>
    const cols = isFiniteNumber(obj.cols) ? Math.max(0, Math.floor(obj.cols)) : 0
    const rows = isFiniteNumber(obj.rows) ? Math.max(0, Math.floor(obj.rows)) : 0
    const spawns = Array.isArray(obj.spawns) ? obj.spawns.length : 0
    let tiles = 0
    if(Array.isArray(obj.tiles)) for(const t of obj.tiles as unknown[]) if(isFiniteNumber(t) && t > 0) tiles++
    return { cols, rows, spawns, tiles }
}

// Classify one raw blob. Returns null when it is not a map at all.
function classify(blob: RawBlob): RecoveryCandidate | null{
    let parsed: unknown
    try{
        parsed = JSON.parse(blob.raw)
    } catch(e){
        return null
    }
    const base = {
        key: `${blob.source}:${blob.id}`,
        source: blob.source,
        id: blob.id,
        label: blob.label,
        raw: blob.raw,
        savedAt: blob.savedAt,
    }

    const direct = validateGridMapData(parsed)
    if(direct !== null){
        return { ...base, status: "healthy", data: direct, repairs: [], tileCount: countNonEmptyTiles(direct), cols: direct.cols, rows: direct.rows, spawns: direct.spawns.length }
    }

    const repaired = repairGridMapData(parsed)
    if(repaired.ok){
        const d = repaired.data
        return { ...base, status: "repairable", data: d, repairs: repaired.repairs, tileCount: countNonEmptyTiles(d), cols: d.cols, rows: d.rows, spawns: d.spawns.length }
    }

    if(looksMapish(parsed)){
        const dims = dimsOf(parsed)
        return { ...base, status: "raw", data: null, repairs: [], tileCount: dims.tiles, cols: dims.cols, rows: dims.rows, spawns: dims.spawns }
    }
    return null
}

// Classify a set of raw blobs into recovery candidates, deduped and sorted
// most-content-first. Identical maps from different surfaces collapse to one (the
// healthiest, then the highest-priority source is kept).
export function scanRecoveryBlobs(blobs: RawBlob[]): RecoveryCandidate[]{
    const classified: RecoveryCandidate[] = []
    for(const blob of blobs){
        const c = classify(blob)
        if(c !== null) classified.push(c)
    }
    classified.sort((a, b) => {
        if(a.tileCount !== b.tileCount) return b.tileCount - a.tileCount
        if(STATUS_RANK[a.status] !== STATUS_RANK[b.status]) return STATUS_RANK[a.status] - STATUS_RANK[b.status]
        return SOURCE_RANK[a.source] - SOURCE_RANK[b.source]
    })
    const seen = new Set<string>()
    const out: RecoveryCandidate[] = []
    for(const c of classified){
        // Dedupe by resulting content (dims + tile count + name when known). Two byte
        // identical copies, or the same map mirrored across surfaces, collapse to one.
        const sig = c.data !== null
            ? `${c.data.name}|${c.cols}x${c.rows}|${c.tileCount}|${tilesChecksum(c.data.tiles)}`
            : `raw|${c.raw.length}|${c.cols}x${c.rows}|${c.tileCount}`
        if(seen.has(sig)) continue
        seen.add(sig)
        out.push(c)
    }
    return out
}

// Extract one raw map blob per entry from a wrapper-record JSON string (the shape the
// library and archive store: { name: { data: string, ... } }). Crucially this keeps
// entries whose `data` fails validation, since those are exactly the maps that need
// recovering. Pure over the string so the IndexedDB backup layer can reuse it on the
// values it fetched. Tolerates non-JSON / non-object input by returning [].
export function blobsFromWrapperJson(raw: string, source: RecoverySource): RawBlob[]{
    let parsed: unknown
    try{
        parsed = JSON.parse(raw)
    } catch(e){
        return []
    }
    if(typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return []
    const out: RawBlob[] = []
    for(const [name, value] of Object.entries(parsed as Record<string, unknown>)){
        if(typeof value !== "object" || value === null) continue
        const entry = value as Record<string, unknown>
        if(typeof entry.data !== "string") continue
        const blob: RawBlob = { source, id: name, label: name, raw: entry.data }
        if(isFiniteNumber(entry.savedAt)) blob.savedAt = entry.savedAt
        out.push(blob)
    }
    return out
}

// Pull a raw map string out of a wrapper record (library / archive) in storage,
// tolerating a missing or unreadable slot.
function collectWrapperBlobs(storage: EditorStorage, key: string, source: RecoverySource): RawBlob[]{
    let raw: string | null
    try{
        raw = storage.getItem(key)
    } catch(e){
        return []
    }
    if(raw === null || raw.length === 0) return []
    return blobsFromWrapperJson(raw, source)
}

// Pull a raw map string out of a single-slot key (draft / play-map), tolerating a
// missing or unreadable slot.
function collectSlotBlob(storage: EditorStorage, key: string, source: RecoverySource, label: string): RawBlob[]{
    let raw: string | null
    try{
        raw = storage.getItem(key)
    } catch(e){
        return []
    }
    if(raw === null || raw.length === 0) return []
    return [{ source, id: source, label, raw }]
}

// Read the RAW bytes from every known local storage surface: the library (every
// entry, valid or not), the autosave draft, the play-map handoff, and the archive.
// Never throws; an unreadable storage yields an empty list.
export function collectLocalRecoveryBlobs(storage: EditorStorage): RawBlob[]{
    return [
        ...collectWrapperBlobs(storage, LIBRARY_STORAGE_KEY, "library"),
        ...collectSlotBlob(storage, EDITOR_STORAGE_KEY, "draft", "Last edited (autosave)"),
        ...collectSlotBlob(storage, PLAY_MAP_STORAGE_KEY, "play-map", "Last played map"),
        ...collectWrapperBlobs(storage, ARCHIVE_STORAGE_KEY, "archive"),
    ]
}

// Best-effort sweep for ORPHAN map data under any other `pip-pip:*` key (e.g. left by
// an older app version). Needs a real enumerable Storage (window.localStorage), so it
// is separate from the injected-storage path above and is purely additive.
const KNOWN_MAP_KEYS = new Set<string>([LIBRARY_STORAGE_KEY, EDITOR_STORAGE_KEY, PLAY_MAP_STORAGE_KEY, ARCHIVE_STORAGE_KEY])

export function collectOrphanRecoveryBlobs(storage: Storage): RawBlob[]{
    let length = 0
    try{
        length = storage.length
    } catch(e){
        return []
    }
    const out: RawBlob[] = []
    for(let i = 0; i < length; i++){
        let key: string | null = null
        try{
            key = storage.key(i)
        } catch(e){
            continue
        }
        if(key === null || KNOWN_MAP_KEYS.has(key) || key.indexOf("pip-pip:") !== 0) continue
        let raw: string | null = null
        try{
            raw = storage.getItem(key)
        } catch(e){
            continue
        }
        if(raw === null || raw.length === 0) continue
        let parsed: unknown
        try{
            parsed = JSON.parse(raw)
        } catch(e){
            continue
        }
        if(looksMapish(parsed) === false) continue
        out.push({ source: "orphan", id: key, label: `Other saved data (${key})`, raw })
    }
    return out
}

// Convenience: collect every local surface and scan it in one call.
export function scanLocalRecoverableMaps(storage: EditorStorage): RecoveryCandidate[]{
    return scanRecoveryBlobs(collectLocalRecoveryBlobs(storage))
}
