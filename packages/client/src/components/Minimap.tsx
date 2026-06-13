import { useEffect, useRef } from "react"
import { GAME_CONTEXT } from "../game"
import { worldToMinimap } from "../game/minimap"
import styles from "./Minimap.module.sass"

// Logical (CSS-pixel) radar size. The canvas backing store is scaled by the
// device pixel ratio so dots stay crisp on retina screens; CSS keeps it at this
// size (and shrinks it on small screens via the module's media query).
const SIZE = 140

// Inset, in radar pixels, kept clear around the rim so dots and the optional
// wall lines never bleed into the border.
const PADDING = 8

// Brand palette (mirrors styles/_variables.sass). Used directly on the canvas
// 2D context, which cannot read SASS variables.
const COLOR_PANEL = "rgba(13, 9, 11, 0.8)"   // $color-dark-1 @ ~0.8
const COLOR_BORDER = "#362631"                // $color-border ($color-dark-3)
const COLOR_WALL = "rgba(54, 38, 49, 0.9)"   // $color-dark-3, faint segments
const COLOR_LOCAL = "#E6AE10"                 // $color-main, local player
const COLOR_OTHER = "#B07FC7"                 // $color-accent, other players

// The minimap draws straight to a <canvas> inside a requestAnimationFrame loop
// that reads GAME_CONTEXT.game live each frame. Drawing imperatively (never via
// React state) keeps the 60fps redraw out of React's render path — the
// component renders once and the rAF owns the pixels from then on. The loop is
// cancelled on unmount.
export default function Minimap() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        if(canvas === null) return
        const ctx = canvas.getContext("2d")
        if(ctx === null) return

        // Size the backing store for the device pixel ratio so the radar is
        // crisp; all drawing below uses logical SIZE units thanks to the scale.
        const dpr = window.devicePixelRatio || 1
        canvas.width = SIZE * dpr
        canvas.height = SIZE * dpr
        ctx.scale(dpr, dpr)

        let frame = 0

        const draw = () => {
            frame = requestAnimationFrame(draw)

            ctx.clearRect(0, 0, SIZE, SIZE)

            // Panel + border background (on-brand).
            ctx.fillStyle = COLOR_PANEL
            ctx.fillRect(0, 0, SIZE, SIZE)
            ctx.strokeStyle = COLOR_BORDER
            ctx.lineWidth = 2
            ctx.strokeRect(1, 1, SIZE - 2, SIZE - 2)

            const game = GAME_CONTEXT.game
            // The game can be mid-mount/unmount, or a map may not be loaded yet.
            const bounds = game?.map?.bounds
            if(typeof game === "undefined" || typeof bounds === "undefined") return

            // Faint wall segments, drawn under the player dots.
            const segWalls = game.physics?.segWalls
            if(typeof segWalls !== "undefined"){
                ctx.strokeStyle = COLOR_WALL
                ctx.lineWidth = 1
                for(const wall of Object.values(segWalls)){
                    const a = worldToMinimap(wall.start.x, wall.start.y, bounds, SIZE, PADDING)
                    const b = worldToMinimap(wall.end.x, wall.end.y, bounds, SIZE, PADDING)
                    ctx.beginPath()
                    ctx.moveTo(a.x, a.y)
                    ctx.lineTo(b.x, b.y)
                    ctx.stroke()
                }
            }

            // One dot per spawned, non-spectator player. The local player is
            // larger and uses the main accent; everyone else is a smaller dot.
            const localId = game.clientPlayerId
            for(const player of Object.values(game.players)){
                if(player.spawned !== true || player.spectator === true) continue
                const pos = player.ship?.physics?.position
                if(typeof pos === "undefined") continue
                const isLocal = player.id === localId
                const p = worldToMinimap(pos.x, pos.y, bounds, SIZE, PADDING)
                ctx.fillStyle = isLocal ? COLOR_LOCAL : COLOR_OTHER
                ctx.beginPath()
                ctx.arc(p.x, p.y, isLocal ? 3.5 : 2.5, 0, Math.PI * 2)
                ctx.fill()
            }
        }

        frame = requestAnimationFrame(draw)
        return () => cancelAnimationFrame(frame)
    }, [])

    return (
        <div className={styles.minimap}>
            <span className={styles.label}>MAP</span>
            <canvas
                ref={canvasRef}
                className={styles.canvas}
                style={{ width: SIZE, height: SIZE }}
            />
        </div>
    )
}
