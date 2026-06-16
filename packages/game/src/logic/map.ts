import { PointPhysicsRectWall, PointPhysicsSegmentWall } from "@pip-pip/core/src/physics"
import { TILE_SIZE, SPAWN_DIAMETER } from "./constants"

export class PointRadius{
    x: number
    y: number
    radius: number
    constructor(x: number, y: number, radius: number){
        this.x = x
        this.y = y
        this.radius = radius
    }
}

export const PIP_MAP_DEFAULT_BOUNDS = 1000

export type PipGameMapBounds = {
    min: {
        x: number, y: number,
    },
    max: {
        x: number, y: number,
    },
}

// The render-side shape of a tile. Mirrors the grid-map TileShape so the
// renderer can draw a diagonal as a triangle/slope that matches its 45-degree
// segWall collision, instead of treating every tile as a square. Kept as a
// plain string union (no import from grid-map) so map.ts stays the low-level
// model the rest of the game depends on. "full" and "deco" both render as
// squares; the four "diag_*" values render as the matching half-tile triangle;
// the four "half_*" values render as a half-cell rectangle matching their
// axis-aligned half-cell rect wall.
export type PipGameTileShape = "full" | "diag_tl" | "diag_tr" | "diag_bl" | "diag_br" | "deco"
    | "half_top" | "half_bottom" | "half_left" | "half_right"

export type PipGameTile = {
    x: number, y: number,
    texture: string,
    // The tile's render shape and its palette material key. Both are OPTIONAL and
    // additive: the legacy JSONPipGameMap loader (below) omits them, so an
    // undefined shape reads as a plain square and an undefined material falls back
    // to the texture. The grid loader fills them in from the palette so new maps
    // can render slopes and varied material styles.
    shape?: PipGameTileShape,
    material?: string,
}

export class PipGameMap{
    id: string
    rectWalls: PointPhysicsRectWall[] = []
    segWalls: PointPhysicsSegmentWall[] = []
    checkpoints: PointRadius[] = []
    spawns: PointRadius[] = []
    tiles: PipGameTile[] = []

    // World units per grid tile. Defaults to TILE_SIZE for legacy maps; the grid
    // loader overwrites it with the map's actual size so the nav grid aligns to
    // the real tiles (a non-72 map otherwise puts every nav cell off the grid).
    cellSize: number = TILE_SIZE

    bounds: PipGameMapBounds = {
        min: {
            x: -PIP_MAP_DEFAULT_BOUNDS,
            y: -PIP_MAP_DEFAULT_BOUNDS,
        },
        max: {
            x: PIP_MAP_DEFAULT_BOUNDS,
            y: PIP_MAP_DEFAULT_BOUNDS,
        },
    }

    constructor(id: string){
        this.id = id
    }
}

export type JSONMapSource = {
    wall_tiles: number[][],
    spawn_tiles: number[][],
    wall_segments: number[][],
    wall_segment_tiles: number[][],
}

export class JSONPipGameMap extends PipGameMap{
    source: JSONMapSource
    constructor(id: string, source: JSONMapSource){
        super(id)
        this.source = source

        let minX = Infinity
        let maxX = -Infinity
        let minY = Infinity
        let maxY = -Infinity

        const compare = (x: number, y: number) => {
            if(x < minX) minX = x
            if(x > maxX) maxX = x
            if(y < minY) minY = y
            if(y > maxY) maxY = y
        }

        for(const [x, y] of this.source.spawn_tiles){
            this.spawns.push(new PointRadius(
                x * TILE_SIZE,
                y * TILE_SIZE,
                SPAWN_DIAMETER / 2,
            ))
            compare(x * TILE_SIZE, y * TILE_SIZE)
        }

        for(const [x, y] of this.source.wall_tiles){
            const inSegmentWalls = this.source.wall_segment_tiles.find(t => t[0] === x && t[1] === y)
            this.tiles.push({
                x: x * TILE_SIZE,
                y: y * TILE_SIZE,
                texture: inSegmentWalls ? "tile_default" : "tile_hidden",
            })
            compare(x * TILE_SIZE, y * TILE_SIZE)
        }

        for(const [sx, sy, ex, ey] of this.source.wall_segments){
            const segWall = new PointPhysicsSegmentWall(undefined,
                sx * TILE_SIZE,
                sy * TILE_SIZE,
                ex * TILE_SIZE,
                ey * TILE_SIZE,
            )
            segWall.radius = TILE_SIZE / 2
            this.segWalls.push(segWall)
            // Wall segments can extend past any tile, so both endpoints must
            // contribute to the bounds. Otherwise a segment-only map would clamp
            // ships well inside its own walls.
            compare(sx * TILE_SIZE, sy * TILE_SIZE)
            compare(ex * TILE_SIZE, ey * TILE_SIZE)
        }

        // If the map had no tiles and no segments at all, compare() never ran and
        // the extents are still inverted (min=+Infinity, max=-Infinity). That would
        // make every position both below min and above max in applyMapBounds, so
        // fall back to a sane default box centred on the origin.
        if(minX > maxX || minY > maxY){
            minX = -PIP_MAP_DEFAULT_BOUNDS
            minY = -PIP_MAP_DEFAULT_BOUNDS
            maxX = PIP_MAP_DEFAULT_BOUNDS
            maxY = PIP_MAP_DEFAULT_BOUNDS
        }

        this.bounds.min.x = minX - TILE_SIZE / 2
        this.bounds.max.x = maxX + TILE_SIZE / 2
        this.bounds.min.y = minY - TILE_SIZE / 2
        this.bounds.max.y = maxY + TILE_SIZE / 2
    }
}