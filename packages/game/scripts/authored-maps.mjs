// Procedural generator for the hand-authored Pip-Pip maps.
//
// Each map is built from a few small helpers so the geometry is guaranteed
// valid: a solid block always pushes its tiles into BOTH wall_tiles and
// wall_segment_tiles and emits the covering wall_segments, a perimeter ring
// closes the arena so ships cannot escape, and spawns are recorded separately
// and asserted to never land on a wall tile.
//
// Run with: node packages/game/scripts/authored-maps.mjs
// It writes drift.map.json, clash.map.json and nexus.map.json into
// packages/game/src/maps/. Output is deterministic (no randomness, sorted
// segment runs), so re-running produces byte-identical files.

import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const MAPS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "maps")

// A builder accumulates wall tiles, the solid subset, spawns and physics
// segments, de-duplicating tiles by their "x,y" key.
function createBuilder(){
    const wallTileKeys = new Set()
    const solidTileKeys = new Set()
    const spawnKeys = new Set()
    const segments = []

    const addSolidTile = (x, y) => {
        wallTileKeys.add(`${x},${y}`)
        solidTileKeys.add(`${x},${y}`)
    }

    // A solid horizontal run from (x1,y) to (x2,y): every tile becomes a solid
    // wall and a single segment covers the whole run.
    const addHRun = (x1, x2, y) => {
        const lo = Math.min(x1, x2)
        const hi = Math.max(x1, x2)
        for(let x = lo; x <= hi; x++) addSolidTile(x, y)
        segments.push([lo, y, hi, y])
    }

    // A solid vertical run from (x,y1) to (x,y2).
    const addVRun = (x, y1, y2) => {
        const lo = Math.min(y1, y2)
        const hi = Math.max(y1, y2)
        for(let y = lo; y <= hi; y++) addSolidTile(x, y)
        segments.push([x, lo, x, hi])
    }

    // A filled solid rectangle, emitted as one horizontal run per row so every
    // interior tile is both rendered solid and physically covered.
    const addBlock = (x1, y1, x2, y2) => {
        const loY = Math.min(y1, y2)
        const hiY = Math.max(y1, y2)
        for(let y = loY; y <= hiY; y++) addHRun(x1, x2, y)
    }

    // A closed perimeter ring covering the inclusive rectangle border.
    const addPerimeter = (x1, y1, x2, y2) => {
        addHRun(x1, x2, y1)
        addHRun(x1, x2, y2)
        addVRun(x1, y1, y2)
        addVRun(x2, y1, y2)
    }

    const addSpawn = (x, y) => {
        spawnKeys.add(`${x},${y}`)
    }

    const build = () => {
        const parse = key => key.split(",").map(Number)
        const sortPts = (a, b) => (a[0] - b[0]) || (a[1] - b[1])

        const wallTiles = [...wallTileKeys].map(parse).sort(sortPts)
        const wallSegmentTiles = [...solidTileKeys].map(parse).sort(sortPts)
        const spawnTiles = [...spawnKeys].map(parse).sort(sortPts)

        // Guard: no spawn may share a cell with any wall tile.
        for(const key of spawnKeys){
            if(wallTileKeys.has(key)){
                throw new Error(`spawn ${key} overlaps a wall tile`)
            }
        }
        if(spawnTiles.length === 0){
            throw new Error("map has no spawns")
        }

        const wallSegments = [...segments].sort(
            (a, b) => sortPts(a, b) || (a[2] - b[2]) || (a[3] - b[3]),
        )

        return {
            wall_tiles: wallTiles,
            spawn_tiles: spawnTiles,
            wall_segments: wallSegments,
            wall_segment_tiles: wallSegmentTiles,
        }
    }

    return { addSolidTile, addHRun, addVRun, addBlock, addPerimeter, addSpawn, build }
}

// 1. DRIFT: a large open battle-royale arena. Big closed perimeter, a handful
// of small asteroid/cover clusters scattered with symmetry, and spawns pushed
// out toward the edges so fights start spread apart.
function buildDrift(){
    const b = createBuilder()
    const R = 23
    b.addPerimeter(-R, -R, R, R)

    // Four corner cover clusters (mirrored).
    const cluster = (cx, cy) => {
        b.addBlock(cx - 1, cy - 1, cx + 1, cy + 1)
    }
    cluster(-12, -12)
    cluster(12, -12)
    cluster(-12, 12)
    cluster(12, 12)

    // Mid-edge nubs so the open lanes are not perfectly empty.
    b.addBlock(-1, -14, 1, -13)
    b.addBlock(-1, 13, 1, 14)
    b.addBlock(-14, -1, -13, 1)
    b.addBlock(13, -1, 14, 1)

    // Two central asteroids flanking the origin.
    b.addBlock(-3, -1, -2, 0)
    b.addBlock(2, 0, 3, 1)

    // Spawns spread to the edges, well clear of walls and clusters.
    const edge = R - 3
    b.addSpawn(-edge, -edge)
    b.addSpawn(0, -edge)
    b.addSpawn(edge, -edge)
    b.addSpawn(-edge, 0)
    b.addSpawn(edge, 0)
    b.addSpawn(-edge, edge)
    b.addSpawn(0, edge)
    b.addSpawn(edge, edge)
    b.addSpawn(-6, -6)
    b.addSpawn(6, -6)
    b.addSpawn(-6, 6)
    b.addSpawn(6, 6)

    return b.build()
}

// 2. CLASH: a tight symmetric TDM arena. Compact closed box with four pillar
// blocks arranged symmetrically and six spawns split between the left and
// right walls.
function buildClash(){
    const b = createBuilder()
    const W = 9
    const H = 7
    b.addPerimeter(-W, -H, W, H)

    // Four symmetric pillars around the centre.
    b.addBlock(-5, -3, -4, -2)
    b.addBlock(4, -3, 5, -2)
    b.addBlock(-5, 2, -4, 3)
    b.addBlock(4, 2, 5, 3)

    // A single central pillar to break sightlines.
    b.addBlock(-1, -1, 1, 1)

    // Three spawns hugging each side wall.
    const x = W - 1
    b.addSpawn(-x, -4)
    b.addSpawn(-x, 0)
    b.addSpawn(-x, 4)
    b.addSpawn(x, -4)
    b.addSpawn(x, 0)
    b.addSpawn(x, 4)

    return b.build()
}

// 3. NEXUS: a symmetric arena with a central cross of cover. Closed box, a plus
// shaped structure in the middle, four diagonal nubs framing it, and eight
// spawns set in the four quadrants.
function buildNexus(){
    const b = createBuilder()
    const R = 12
    b.addPerimeter(-R, -R, R, R)

    // Central plus / cross: a horizontal bar and a vertical bar crossing the
    // origin.
    b.addBlock(-4, -1, 4, 1)
    b.addBlock(-1, -4, 1, 4)

    // Four diagonal cover nubs framing the cross.
    b.addBlock(-7, -7, -6, -6)
    b.addBlock(6, -7, 7, -6)
    b.addBlock(-7, 6, -6, 7)
    b.addBlock(6, 6, 7, 7)

    // Two spawns per quadrant, kept clear of the cross and the nubs.
    const o = R - 3
    b.addSpawn(-o, -o)
    b.addSpawn(-4, -o)
    b.addSpawn(o, -o)
    b.addSpawn(o, -4)
    b.addSpawn(-o, o)
    b.addSpawn(-4, o)
    b.addSpawn(o, o)
    b.addSpawn(o, 4)

    return b.build()
}

const targets = [
    ["drift", buildDrift()],
    ["clash", buildClash()],
    ["nexus", buildNexus()],
]

for(const [id, source] of targets){
    const file = join(MAPS_DIR, `${id}.map.json`)
    writeFileSync(file, JSON.stringify(source))
    process.stdout.write(`wrote ${id}.map.json (${source.spawn_tiles.length} spawns, ${source.wall_tiles.length} wall tiles)\n`)
}
