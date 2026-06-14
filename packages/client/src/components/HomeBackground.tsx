import { useEffect, useRef } from "react"
import styles from "./HomeBackground.module.sass"

// Decorative parallax star field for the homepage, drawn to a <canvas> in a
// requestAnimationFrame loop. It recreates the in-game star look (see
// game/renderer.ts STAR_BG / StarGraphic): lots of tiny crisp pixel stars over
// dark space, with z-depth controlling each star's size, brightness, and how
// fast it drifts. Here the whole field drifts slowly UPWARD as a gentle marquee
// and wraps at the top, instead of following a camera.
//
// Sits fixed behind the page content (z-index 0) and is purely cosmetic, so it
// is aria-hidden and pointer-events:none (set in the module). Drawing
// imperatively (never via React state) keeps the redraw out of React's render
// path; the loop is cancelled on unmount. prefers-reduced-motion freezes the
// drift to a single static frame.

// Space fill behind the stars. Mirrors the game canvas background (0x150E12 =
// $color-dark-2) so the homepage reads as the same dark space.
const COLOR_SPACE = "#150E12"

// Star density: one star per this many CSS px² of viewport, capped so phones
// never draw a silly number of them. Matches the sparse, crisp feel of the
// in-game field rather than a dense starscape.
const STAR_AREA_PER_STAR = 9000
const MAX_STARS = 220

// Upward drift speed of the slowest (farthest) layer, in CSS px/second. Nearer
// stars move proportionally faster, giving the parallax. Kept gentle.
const BASE_DRIFT = 6

type Star = {
    x: number
    y: number
    size: number
    drift: number
    alpha: number
    twinklePhase: number
    twinkleSpeed: number
}

export default function HomeBackground() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        if(canvas === null) return
        const ctx = canvas.getContext("2d")
        if(ctx === null) return

        // Cap the device pixel ratio so retina phones don't pay for a huge
        // backing store on a purely decorative layer.
        const dpr = Math.min(window.devicePixelRatio || 1, 2)

        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

        let width = 0
        let height = 0
        let stars: Star[] = []

        // (Re)build the field for the current viewport size. Nearer stars (low
        // depth) are bigger, brighter, and drift faster — the same z-ratio
        // relationship the game uses for its parallax.
        const build = () => {
            width = window.innerWidth
            height = window.innerHeight

            canvas.width = Math.floor(width * dpr)
            canvas.height = Math.floor(height * dpr)
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
            ctx.imageSmoothingEnabled = false

            const count = Math.min(MAX_STARS, Math.round((width * height) / STAR_AREA_PER_STAR))
            stars = []
            for(let i = 0; i < count; i++){
                const depth = Math.random()
                const near = 1 - depth
                stars.push({
                    x: Math.random() * width,
                    y: Math.random() * height,
                    // 1px stars far away, up to 3px pixel-blocks up close.
                    size: 1 + Math.round(near * 2),
                    drift: BASE_DRIFT * (0.5 + near),
                    alpha: 0.35 + near * 0.55,
                    twinklePhase: Math.random() * Math.PI * 2,
                    twinkleSpeed: 0.6 + Math.random() * 1.4,
                })
            }
        }

        const drawStar = (star: Star, twinkle: number) => {
            ctx.globalAlpha = Math.max(0, Math.min(1, star.alpha * twinkle))
            // Crisp pixel blocks — round to whole pixels so stars stay sharp.
            ctx.fillRect(Math.round(star.x), Math.round(star.y), star.size, star.size)
        }

        const paint = (time: number) => {
            ctx.globalAlpha = 1
            ctx.fillStyle = COLOR_SPACE
            ctx.fillRect(0, 0, width, height)

            ctx.fillStyle = "#ffffff"
            for(const star of stars){
                // Subtle per-star twinkle, in [0.65, 1].
                const twinkle = reduceMotion
                    ? 1
                    : 0.825 + 0.175 * Math.sin(time * 0.001 * star.twinkleSpeed + star.twinklePhase)
                drawStar(star, twinkle)
            }
            ctx.globalAlpha = 1
        }

        let frame = 0
        let last = performance.now()

        const loop = (time: number) => {
            frame = requestAnimationFrame(loop)
            const delta = Math.min(0.1, (time - last) / 1000)
            last = time

            for(const star of stars){
                // Marquee upward, wrapping back round to the bottom edge.
                star.y -= star.drift * delta
                if(star.y < -star.size){
                    star.y += height + star.size * 2
                    star.x = Math.random() * width
                }
            }

            paint(time)
        }

        build()

        if(reduceMotion){
            // Honour the user's preference: paint one static frame, no loop.
            paint(performance.now())
        } else {
            frame = requestAnimationFrame(loop)
        }

        // Rebuild on resize so density and wrap bounds track the viewport.
        const onResize = () => {
            build()
            if(reduceMotion) paint(performance.now())
        }
        window.addEventListener("resize", onResize)

        return () => {
            cancelAnimationFrame(frame)
            window.removeEventListener("resize", onResize)
        }
    }, [])

    return (
        <canvas
            ref={canvasRef}
            className={styles.root}
            aria-hidden="true"
        />
    )
}
