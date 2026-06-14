import { useEffect, useMemo, useRef } from "react"
import { PipMapType } from "@pip-pip/game/src/maps"
import {
    mapPreviewTransform,
    worldToPreview,
    backgroundToCss,
} from "../game/mapPreview"
import styles from "./MapPreview.module.sass"

// Logical (CSS-pixel) thumbnail size. The canvas backing store is scaled by the
// device pixel ratio so the walls stay crisp on retina screens; CSS keeps it at
// this size (and the module's media query shrinks it on small screens).
const WIDTH = 96
const HEIGHT = 72

// Inset, in preview pixels, kept clear around the rim so walls/spawns never
// bleed into the border.
const PADDING = 4

// Brand palette (mirrors styles/_variables.sass). Used directly on the canvas
// 2D context, which cannot read SASS variables.
const COLOR_WALL = "#362631"                 // $color-dark-3, wall fill/lines
const COLOR_WALL_EDGE = "#B07FC7"            // $color-accent, faint wall edge
const COLOR_SPAWN = "rgba(230, 174, 16, 0.4)" // $color-main, faint spawn dots

// A static top-down thumbnail of a map's layout. The map is created once
// (throwaway, never added to the world) and its walls + spawns are drawn to a
// <canvas> a single time per mount — it's a fixed layout, so there's no rAF
// loop. Drawing imperatively keeps the canvas out of React's render path.
export default function MapPreview({ mapType }: { mapType: PipMapType }){
    const canvasRef = useRef<HTMLCanvasElement | null>(null)

    // Instantiate the map once per mapType so the draw effect can re-run cheaply
    // (e.g. on dpr change) without rebuilding geometry every time.
    const map = useMemo(() => mapType.createMap(), [mapType])

    useEffect(() => {
        const canvas = canvasRef.current
        if(canvas === null) return
        const ctx = canvas.getContext("2d")
        if(ctx === null) return

        // Size the backing store for the device pixel ratio so walls are crisp;
        // all drawing below uses logical WIDTH/HEIGHT units thanks to the scale.
        const dpr = window.devicePixelRatio || 1
        canvas.width = WIDTH * dpr
        canvas.height = HEIGHT * dpr
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

        // Background fill: this map's own mood colour.
        ctx.clearRect(0, 0, WIDTH, HEIGHT)
        ctx.fillStyle = backgroundToCss(mapType.background)
        ctx.fillRect(0, 0, WIDTH, HEIGHT)

        const transform = mapPreviewTransform(map.bounds, WIDTH, HEIGHT, PADDING)

        // Faint spawn dots, under the walls.
        ctx.fillStyle = COLOR_SPAWN
        for(const spawn of map.spawns){
            const p = worldToPreview(spawn.x, spawn.y, transform)
            ctx.beginPath()
            ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2)
            ctx.fill()
        }

        // Rect walls (if any) as filled boxes.
        ctx.fillStyle = COLOR_WALL
        for(const wall of map.rectWalls){
            const halfW = (wall.width / 2) * transform.scale
            const halfH = (wall.height / 2) * transform.scale
            const c = worldToPreview(wall.center.x, wall.center.y, transform)
            ctx.fillRect(c.x - halfW, c.y - halfH, halfW * 2, halfH * 2)
        }

        // Segment walls as stroked lines, scaled to the same thickness the
        // physics radius implies so the layout reads at thumbnail size.
        ctx.strokeStyle = COLOR_WALL
        ctx.lineCap = "round"
        for(const wall of map.segWalls){
            const a = worldToPreview(wall.start.x, wall.start.y, transform)
            const b = worldToPreview(wall.end.x, wall.end.y, transform)
            ctx.lineWidth = Math.max(1, wall.radius * 2 * transform.scale)
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
        }

        // A thin accent edge on the segments lifts them off the background a
        // touch without overpowering the dark fill.
        ctx.strokeStyle = COLOR_WALL_EDGE
        ctx.lineWidth = 0.5
        for(const wall of map.segWalls){
            const a = worldToPreview(wall.start.x, wall.start.y, transform)
            const b = worldToPreview(wall.end.x, wall.end.y, transform)
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
        }
    }, [map, mapType.background])

    return (
        <canvas
            ref={canvasRef}
            className={styles.preview}
            style={{ width: WIDTH, height: HEIGHT }}
        />
    )
}
