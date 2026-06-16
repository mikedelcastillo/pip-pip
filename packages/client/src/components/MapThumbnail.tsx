import { useEffect, useMemo, useRef } from "react"
import { GridMapData } from "@pip-pip/game/src/logic/grid-map"
import { materialFaceCss } from "../game/mapGraphics"
import {
    gridMapCellBounds,
    gridMapThumbnailCells,
    ThumbnailCell,
} from "../game/mapThumbnail"
import { mapPreviewTransform, worldToPreview } from "../game/mapPreview"
import styles from "./MapThumbnail.module.sass"

// A static, top-down THUMBNAIL of a stored library map, drawn once per mount into a
// <canvas> (a fixed layout, so no rAF loop). It reuses the EXACT block-face colours
// the editor canvas + in-game renderer use (materialFaceCss) and the same uniform-fit
// math as the map-selector preview (mapPreviewTransform over the painted CELL box),
// so a card preview reads as a shrunk-down version of the real map. Pure cell
// geometry lives in game/mapThumbnail.ts; this component only rasterises it. The
// caller passes the parsed GridMapData (the library entry already validated on load),
// so an unreadable entry never reaches here.

// Logical (CSS-pixel) thumbnail size. The backing store is dpr-scaled so the tiles
// stay crisp on retina; CSS keeps the element at this aspect (the module clamps the
// width responsively for the mobile card grid).
const WIDTH = 220
const HEIGHT = 132

// Inset, in preview pixels, kept clear around the rim so edge tiles never bleed into
// the card's rounded border.
const PADDING = 6

// The dark space backdrop behind empty cells, matching the editor canvas fill so the
// thumbnail reads as the same surface (mapGraphics has no single "background" const).
const COLOR_BACKDROP = "#0D090B"
// Faint green spawn dots, drawn over the tiles so a spawn-heavy map still reads.
const COLOR_SPAWN = "rgba(51, 221, 85, 0.7)"

// The polygon (in CELL space, 0..1 within the cell) for a tile shape, so the drawer
// renders diagonals + halves as their true silhouette (matching the in-editor look)
// rather than a flat square. col/row are the cell's top-left; the returned points are
// absolute cell coordinates the transform then maps to preview pixels.
function cellPolygon(cell: ThumbnailCell): { x: number, y: number }[]{
    const left = cell.col
    const right = cell.col + 1
    const top = cell.row
    const bottom = cell.row + 1
    const midX = cell.col + 0.5
    const midY = cell.row + 0.5
    const shape = cell.shape
    if(shape === "diag_tl") return [{ x: left, y: top }, { x: right, y: top }, { x: left, y: bottom }]
    if(shape === "diag_tr") return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }]
    if(shape === "diag_bl") return [{ x: left, y: top }, { x: left, y: bottom }, { x: right, y: bottom }]
    if(shape === "diag_br") return [{ x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]
    if(shape === "half_top") return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: midY }, { x: left, y: midY }]
    if(shape === "half_bottom") return [{ x: left, y: midY }, { x: right, y: midY }, { x: right, y: bottom }, { x: left, y: bottom }]
    if(shape === "half_left") return [{ x: left, y: top }, { x: midX, y: top }, { x: midX, y: bottom }, { x: left, y: bottom }]
    if(shape === "half_right") return [{ x: midX, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: midX, y: bottom }]
    // "full" and "deco" both fill the whole cell square.
    return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]
}

export default function MapThumbnail({ data }: { data: GridMapData }){
    const canvasRef = useRef<HTMLCanvasElement | null>(null)

    // Resolve the painted cells + cell box once per map data so the draw effect can
    // re-run cheaply (e.g. on a dpr change) without re-walking the dense grid.
    const cells = useMemo(() => gridMapThumbnailCells(data), [data])
    const bounds = useMemo(() => gridMapCellBounds(data), [data])

    useEffect(() => {
        const canvas = canvasRef.current
        if(canvas === null) return
        const ctx = canvas.getContext("2d")
        if(ctx === null) return

        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.floor(WIDTH * dpr)
        canvas.height = Math.floor(HEIGHT * dpr)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.imageSmoothingEnabled = false

        // Backdrop fill so the card preview reads edge to edge as one dark surface.
        ctx.fillStyle = COLOR_BACKDROP
        ctx.fillRect(0, 0, WIDTH, HEIGHT)

        // Nothing painted: leave the empty backdrop (the card still shows a name).
        if(bounds.empty) return

        // Fit the painted CELL box (inclusive, so +1 cell on the max side) into the
        // thumbnail with the SAME uniform-scale helper the map-selector preview uses,
        // treating one cell as one "world unit".
        const transform = mapPreviewTransform(
            { min: { x: bounds.minCol, y: bounds.minRow }, max: { x: bounds.maxCol + 1, y: bounds.maxRow + 1 } },
            WIDTH,
            HEIGHT,
            PADDING,
        )

        // Painted tiles, each in its material's face colour (deco/full as a square,
        // diagonals + halves as their true silhouette) so the preview matches the map.
        for(const cell of cells){
            const poly = cellPolygon(cell)
            ctx.fillStyle = materialFaceCss(cell.key)
            ctx.beginPath()
            poly.forEach((p, i) => {
                const sp = worldToPreview(p.x, p.y, transform)
                if(i === 0) ctx.moveTo(sp.x, sp.y)
                else ctx.lineTo(sp.x, sp.y)
            })
            ctx.closePath()
            ctx.fill()
        }

        // Spawn dots over the tiles, centred on their cell, so a spawn map reads too.
        ctx.fillStyle = COLOR_SPAWN
        if(Array.isArray(data.spawns)){
            for(const pair of data.spawns){
                if(Array.isArray(pair) === false || pair.length !== 2) continue
                const sp = worldToPreview(pair[0] + 0.5, pair[1] + 0.5, transform)
                const r = Math.max(1.5, transform.scale * 0.28)
                ctx.beginPath()
                ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2)
                ctx.fill()
            }
        }
    }, [cells, bounds, data.spawns])

    return (
        <canvas
            ref={canvasRef}
            className={styles.thumbnail}
            style={{ width: WIDTH, height: HEIGHT }}
            aria-hidden="true"
        />
    )
}
