// Spatial-hash wall broadphase, extracted from physics/index.ts. Self-contained
// (indexes wall ids by grid cell; no Vector2 / wall-class deps), so the world step
// queries only nearby walls. Pure + deterministic (no clock/random) => byte-identical
// on server and client. Re-exported from physics/index.ts for existing importers.

// Uniform-grid (spatial hash) cell size in world units for the wall broadphase.
// Game walls are 72-unit tiles (segWall radius is 36), so 256 spans roughly
// three-and-a-half tiles: large enough that a typical object/bullet query
// touches only a handful of cells, small enough that a single 250x250-tile map
// fills thousands of cells instead of forcing the old full-wall scan. The value
// is a pure constant (no clock / random), so the grid is identical on server
// and client.
export const WALL_GRID_CELL_SIZE = 256

// Map a world coordinate to its integer grid cell index. Math.floor is used so
// the mapping is deterministic and stable across negative and positive
// coordinates; the same input always yields the same cell on both sides.
function cellIndex(value: number){
    return Math.floor(value / WALL_GRID_CELL_SIZE)
}

// Build the string key for an integer cell coordinate pair.
function cellKey(cx: number, cy: number){
    return cx + "," + cy
}

// Is `key` a canonical array-index string? V8 enumerates own keys (and thus
// Object.keys / Object.values) by putting array-index keys FIRST, in ascending
// numeric order, then the remaining string keys in insertion order. An
// array-index key is a non-negative integer < 2^32-1 with no leading zeros / no
// sign / no decimal whose ToString round-trips to itself. We must reproduce
// that ordering for query results (see WallGrid.query), so we need to classify
// ids the exact same way V8 does. A 4-char generateId() like "1234" is such an
// index and would be reordered by Object.values; "0234" (leading zero) is not.
function arrayIndexValue(key: string): number{
    // Fast path: only all-digit strings can be array indices.
    if(key.length === 0 || key.length > 10) return -1
    for(let i = 0; i < key.length; i++){
        const c = key.charCodeAt(i)
        if(c < 48 || c > 57) return -1
    }
    // Reject leading zeros (except the single "0"), which V8 treats as strings.
    if(key.length > 1 && key.charCodeAt(0) === 48) return -1
    const n = Number(key)
    // Max valid array index is 2^32 - 2 (4294967294).
    if(n > 4294967294) return -1
    return n
}

// A uniform-grid spatial hash over STATIC walls. Each wall id is inserted into
// every cell its footprint AABB overlaps; a query collects the ids in every
// cell the query AABB overlaps. The candidate set is a CONSERVATIVE superset:
// any two AABBs that overlap necessarily share at least one cell, so every wall
// a brute-force scan would test is guaranteed to be returned.
//
// query() returns the candidates in the EXACT order Object.values(record)
// yields for the parallel wall record, WITHOUT ever iterating that record.
// Order matters because applyWallContact mutates the object's position
// sequentially across walls at a corner, so a different order yields a
// different result; the equivalence tests assert byte-identical positions. To
// reproduce Object.values order we assign every inserted id a monotonic
// insertion ordinal (the same order add*Wall is called, which is also the order
// the wall is inserted into the record) and, at query time, sort the small
// collected candidate set by V8's own key order: array-index ids first (numeric
// ascending), then the rest by insertion ordinal. The sort is O(k log k) in the
// number of NEARBY candidates, never O(all walls).
//
// The structure is a pure function of the inserted footprints (the ordinal is a
// deterministic insertion counter, no clock / random state), so it is
// byte-identical on server and client.
export class WallGrid{
    // cell key -> set of wall ids whose footprint overlaps that cell.
    cells: Map<string, Set<string>> = new Map()
    // wall id -> the inclusive cell range it currently occupies, so removal
    // touches exactly the same cells insertion did (no full-grid scan).
    footprints: Map<string, { minCX: number, minCY: number, maxCX: number, maxCY: number }> = new Map()
    // wall id -> its insertion ordinal, mirroring the order the parallel record
    // received the same id. Used only to order non-array-index ids at query
    // time (array-index ids order by numeric value instead).
    ordinals: Map<string, number> = new Map()
    // Monotonic counter handing out the next insertion ordinal.
    nextOrdinal = 0

    clear(){
        this.cells.clear()
        this.footprints.clear()
        this.ordinals.clear()
        this.nextOrdinal = 0
    }

    // Insert a wall id under the cell range covering [minX,maxX] x [minY,maxY].
    // Re-inserting the same id first removes its old footprint so the grid never
    // accumulates stale cells (walls are static, but maps reload). A re-added id
    // gets a fresh ordinal, matching the record where deleting then re-setting a
    // key also moves it to the end of the string-key insertion order.
    insert(id: string, minX: number, minY: number, maxX: number, maxY: number){
        if(this.footprints.has(id)) this.remove(id)
        const minCX = cellIndex(minX)
        const minCY = cellIndex(minY)
        const maxCX = cellIndex(maxX)
        const maxCY = cellIndex(maxY)
        for(let cx = minCX; cx <= maxCX; cx++){
            for(let cy = minCY; cy <= maxCY; cy++){
                const key = cellKey(cx, cy)
                let set = this.cells.get(key)
                if(typeof set === "undefined"){
                    set = new Set()
                    this.cells.set(key, set)
                }
                set.add(id)
            }
        }
        this.footprints.set(id, { minCX, minCY, maxCX, maxCY })
        this.ordinals.set(id, this.nextOrdinal++)
    }

    remove(id: string){
        const fp = this.footprints.get(id)
        if(typeof fp === "undefined") return
        for(let cx = fp.minCX; cx <= fp.maxCX; cx++){
            for(let cy = fp.minCY; cy <= fp.maxCY; cy++){
                const key = cellKey(cx, cy)
                const set = this.cells.get(key)
                if(typeof set === "undefined") continue
                set.delete(id)
                if(set.size === 0) this.cells.delete(key)
            }
        }
        this.footprints.delete(id)
        this.ordinals.delete(id)
    }

    // Collect the de-duplicated ids whose cells overlap [minX,maxX] x
    // [minY,maxY]. Returns a Set for O(1) membership tests. We touch ONLY the
    // cells the query AABB overlaps, so the work is O(candidates), never
    // O(all walls). Ordering is not imposed here (see queryOrdered).
    query(minX: number, minY: number, maxX: number, maxY: number): Set<string>{
        const out: Set<string> = new Set()
        const minCX = cellIndex(minX)
        const minCY = cellIndex(minY)
        const maxCX = cellIndex(maxX)
        const maxCY = cellIndex(maxY)
        for(let cx = minCX; cx <= maxCX; cx++){
            for(let cy = minCY; cy <= maxCY; cy++){
                const set = this.cells.get(cellKey(cx, cy))
                if(typeof set === "undefined") continue
                for(const id of set) out.add(id)
            }
        }
        return out
    }

    // Like query(), but returns the candidate ids as an ARRAY ordered exactly as
    // Object.values(record) would yield them. We collect only the NEARBY ids
    // (still O(candidates), never O(all walls)) then sort that small array into
    // V8 key order: array-index ids first in ascending numeric order, then every
    // other id by its insertion ordinal (the record's string-key insertion
    // order). The sort is O(k log k) in the number of nearby candidates.
    queryOrdered(minX: number, minY: number, maxX: number, maxY: number): string[]{
        const seen: Set<string> = new Set()
        const out: string[] = []
        const minCX = cellIndex(minX)
        const minCY = cellIndex(minY)
        const maxCX = cellIndex(maxX)
        const maxCY = cellIndex(maxY)
        for(let cx = minCX; cx <= maxCX; cx++){
            for(let cy = minCY; cy <= maxCY; cy++){
                const set = this.cells.get(cellKey(cx, cy))
                if(typeof set === "undefined") continue
                for(const id of set){
                    if(seen.has(id)) continue
                    seen.add(id)
                    out.push(id)
                }
            }
        }
        out.sort((a, b) => {
            const ai = arrayIndexValue(a)
            const bi = arrayIndexValue(b)
            // Both array indices: ascending numeric order.
            if(ai !== -1 && bi !== -1) return ai - bi
            // Array indices precede non-array-index string keys.
            if(ai !== -1) return -1
            if(bi !== -1) return 1
            // Neither is an array index: original insertion order.
            return (this.ordinals.get(a) ?? 0) - (this.ordinals.get(b) ?? 0)
        })
        return out
    }
}
