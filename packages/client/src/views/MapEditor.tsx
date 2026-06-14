import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import GameButton from "../components/GameButton"
import GameInput from "../components/GameInput"
import HomeBackground from "../components/HomeBackground"
import { loadGridMap } from "@pip-pip/game/src/logic/grid-map"
import {
    EditorMap,
    EditorBrush,
    EDITOR_PALETTE,
    MIN_GRID,
    MAX_GRID,
    DEFAULT_COLS,
    DEFAULT_ROWS,
    DEFAULT_MAP_NAME,
    clampGrid,
    serializeGridMapData,
    parseGridMapData,
    mapFileName,
} from "../game/mapEditor"
import { trackEvent, trackPageView } from "../analytics"
import styles from "./MapEditor.module.sass"

// The homepage MAP EDITOR. The paintable grid lives in an EditorMap (pure model,
// see game/mapEditor.ts); this view only renders it to a <canvas> and wires
// pointer (mouse + touch) events to map.setCell. A second pass overlays the
// REAL collision/spawn geometry from loadGridMap so the author sees exactly the
// walls the game will build. Export downloads the GridMapData JSON loadGridMap
// consumes - no server, no database.

// Palette swatch colours, kept in sync with the on-canvas tile fills so a
// button reads as the thing it paints. Amber blocks, purple slopes, muted deco.
const COLOR_BLOCK = "#E6AE10"
const COLOR_SLOPE = "#B07FC7"
const COLOR_DECO = "#5A4A54"
const COLOR_SPAWN = "#33DD55"
const COLOR_GRID = "rgba(255, 255, 255, 0.08)"
const COLOR_GRID_STRONG = "rgba(255, 255, 255, 0.18)"
const COLOR_COLLISION = "rgba(51, 221, 85, 0.9)"

// The full brush list the palette shows: erase first, then every shape from the
// shared editor palette, then the spawn marker last.
type BrushDef = { brush: EditorBrush, label: string, color: string }
const BRUSHES: BrushDef[] = [
    { brush: "empty", label: "Erase", color: COLOR_GRID_STRONG },
    ...EDITOR_PALETTE.map((entry) => ({
        brush: entry.brush,
        label: entry.label,
        color: entry.shape === "full" ? COLOR_BLOCK : entry.shape === "deco" ? COLOR_DECO : COLOR_SLOPE,
    })),
    { brush: "spawn", label: "Spawn", color: COLOR_SPAWN },
]

// Fill colour for a painted shape, used by both the canvas tiles and the
// palette swatches.
function shapeColor(shape: string): string{
    if(shape === "full") return COLOR_BLOCK
    if(shape === "deco") return COLOR_DECO
    return COLOR_SLOPE
}

export default function MapEditor(){
    const navigate = useNavigate()
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const fileInputRef = useRef<HTMLInputElement | null>(null)

    // The mutable editor model. Held in a ref (not React state) so high-rate
    // pointer drags mutate it directly without a re-render per cell; a separate
    // `version` counter bumps to trigger redraws/UI refreshes when needed.
    const mapRef = useRef<EditorMap>(new EditorMap(DEFAULT_COLS, DEFAULT_ROWS))
    const [version, setVersion] = useState(0)
    const bump = useCallback(() => setVersion((v) => v + 1), [])

    const [brush, setBrush] = useState<EditorBrush>("full")
    const [name, setName] = useState(DEFAULT_MAP_NAME)
    const [colsInput, setColsInput] = useState(String(DEFAULT_COLS))
    const [rowsInput, setRowsInput] = useState(String(DEFAULT_ROWS))
    const [showCollision, setShowCollision] = useState(false)
    const [message, setMessage] = useState("")

    // The active brush is read inside imperative pointer handlers, which capture
    // their closure once; mirror it into a ref so a drag always paints the
    // currently selected brush, not the one selected when the canvas mounted.
    const brushRef = useRef(brush)
    brushRef.current = brush
    const showCollisionRef = useRef(showCollision)
    showCollisionRef.current = showCollision

    useEffect(() => {
        trackPageView("/editor")
    }, [])

    // Recompute the live collision/spawn geometry whenever the grid changes.
    // loadGridMap is the SAME loader the game uses, so this preview is exact:
    // greedy-meshed rect walls, diagonal segment walls, and spawn points.
    const collision = useMemo(() => {
        const data = mapRef.current.toGridMapData()
        const playable = loadGridMap("editor-preview", data)
        return {
            rectWalls: playable.rectWalls.map((w) => ({
                x: w.center.x, y: w.center.y, width: w.width, height: w.height,
            })),
            segWalls: playable.segWalls.map((s) => ({
                x1: s.start.x, y1: s.start.y, x2: s.end.x, y2: s.end.y,
            })),
            spawns: playable.spawns.map((p) => ({ x: p.x, y: p.y })),
        }
        // `version` bumps on every model mutation, so the collision preview is
        // recomputed from the latest grid each paint/resize/clear/import. The
        // model itself is a ref, so `version` is the only meaningful dependency.
    }, [version])

    // Pixel size of one cell on screen. Chosen so the whole grid fits the canvas
    // box; recomputed on every draw from the live canvas size and grid dims.
    const drawCellSize = useCallback((map: EditorMap, canvasW: number, canvasH: number) => {
        return Math.max(4, Math.floor(Math.min(canvasW / map.cols, canvasH / map.rows)))
    }, [])

    // Draw the entire editor: grid lines, painted tiles (squares / diagonals /
    // deco), spawn markers, and (optionally) the loadGridMap collision overlay.
    const draw = useCallback(() => {
        const canvas = canvasRef.current
        if(canvas === null) return
        const ctx = canvas.getContext("2d")
        if(ctx === null) return
        const map = mapRef.current

        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const rect = canvas.getBoundingClientRect()
        const cssW = Math.max(1, rect.width)
        const cssH = Math.max(1, rect.height)
        canvas.width = Math.floor(cssW * dpr)
        canvas.height = Math.floor(cssH * dpr)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.imageSmoothingEnabled = false

        const cell = drawCellSize(map, cssW, cssH)
        const gridW = cell * map.cols
        const gridH = cell * map.rows
        // Centre the grid in the canvas box.
        const ox = Math.floor((cssW - gridW) / 2)
        const oy = Math.floor((cssH - gridH) / 2)

        // Backdrop behind the grid so empty cells read as dark space.
        ctx.fillStyle = "#0D090B"
        ctx.fillRect(ox, oy, gridW, gridH)

        // Painted tiles.
        for(let row = 0; row < map.rows; row++){
            for(let col = 0; col < map.cols; col++){
                const value = map.tileAt(col, row)
                if(value <= 0) continue
                const entry = map.palette[value - 1]
                if(typeof entry === "undefined") continue
                drawTile(ctx, entry.shape, ox + col * cell, oy + row * cell, cell)
            }
        }

        // Grid lines on top of fills so cell edges stay legible while painting.
        ctx.strokeStyle = COLOR_GRID
        ctx.lineWidth = 1
        ctx.beginPath()
        for(let col = 0; col <= map.cols; col++){
            const x = ox + col * cell + 0.5
            ctx.moveTo(x, oy)
            ctx.lineTo(x, oy + gridH)
        }
        for(let row = 0; row <= map.rows; row++){
            const y = oy + row * cell + 0.5
            ctx.moveTo(ox, y)
            ctx.lineTo(ox + gridW, y)
        }
        ctx.stroke()

        // Spawn markers: a green ring centred on the cell.
        ctx.strokeStyle = COLOR_SPAWN
        ctx.fillStyle = "rgba(51, 221, 85, 0.25)"
        ctx.lineWidth = 2
        for(const [col, row] of map.spawns){
            const cx = ox + col * cell + cell / 2
            const cy = oy + row * cell + cell / 2
            const r = Math.max(3, cell * 0.32)
            ctx.beginPath()
            ctx.arc(cx, cy, r, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
        }

        // Optional collision overlay from loadGridMap: outline every rect wall
        // and draw every segment wall in the world->cell scale. World units are
        // cellSize per cell, so dividing by cellSize maps world back to cells.
        if(showCollisionRef.current){
            const worldToScreenX = (wx: number) => ox + (wx / map.cellSize + 0.5) * cell
            const worldToScreenY = (wy: number) => oy + (wy / map.cellSize + 0.5) * cell
            ctx.strokeStyle = COLOR_COLLISION
            ctx.lineWidth = 2
            for(const w of collision.rectWalls){
                const x = worldToScreenX(w.x - w.width / 2)
                const y = worldToScreenY(w.y - w.height / 2)
                const ww = (w.width / map.cellSize) * cell
                const hh = (w.height / map.cellSize) * cell
                ctx.strokeRect(x, y, ww, hh)
            }
            ctx.beginPath()
            for(const s of collision.segWalls){
                ctx.moveTo(worldToScreenX(s.x1), worldToScreenY(s.y1))
                ctx.lineTo(worldToScreenX(s.x2), worldToScreenY(s.y2))
            }
            ctx.stroke()
        }
    }, [collision, drawCellSize])

    // Redraw on any model bump, collision recompute, or collision toggle.
    useEffect(() => {
        draw()
    }, [draw, showCollision])

    // Redraw on window resize so the grid keeps fitting the responsive canvas.
    useEffect(() => {
        const onResize = () => draw()
        window.addEventListener("resize", onResize)
        return () => window.removeEventListener("resize", onResize)
    }, [draw])

    // Map a pointer event to the cell under it, painting the active brush there.
    // Used for both the initial press and every move while dragging. Returns the
    // cell so a drag can skip re-painting the same cell repeatedly.
    const lastCellRef = useRef<{ col: number, row: number } | null>(null)

    const cellFromEvent = useCallback((clientX: number, clientY: number) => {
        const canvas = canvasRef.current
        if(canvas === null) return null
        const map = mapRef.current
        const rect = canvas.getBoundingClientRect()
        const cssW = Math.max(1, rect.width)
        const cssH = Math.max(1, rect.height)
        const cell = drawCellSize(map, cssW, cssH)
        const gridW = cell * map.cols
        const gridH = cell * map.rows
        const ox = Math.floor((cssW - gridW) / 2)
        const oy = Math.floor((cssH - gridH) / 2)
        const col = Math.floor((clientX - rect.left - ox) / cell)
        const row = Math.floor((clientY - rect.top - oy) / cell)
        if(map.inBounds(col, row) === false) return null
        return { col, row }
    }, [drawCellSize])

    const paintAt = useCallback((clientX: number, clientY: number) => {
        const cellPos = cellFromEvent(clientX, clientY)
        if(cellPos === null) return
        const last = lastCellRef.current
        // Spawn is a toggle, so it must NOT re-fire while the pointer lingers on
        // the same cell (that would flip it on/off endlessly); for shapes,
        // skipping the same cell just avoids redundant work.
        if(last !== null && last.col === cellPos.col && last.row === cellPos.row) return
        lastCellRef.current = cellPos
        const changed = mapRef.current.setCell(cellPos.col, cellPos.row, brushRef.current)
        if(changed){
            bump()
            draw()
        }
    }, [cellFromEvent, bump, draw])

    // Pointer-event wiring. Pointer Events unify mouse + touch + pen, so a single
    // set of handlers paints on desktop and mobile. setPointerCapture keeps the
    // drag alive even if the finger/cursor briefly leaves the canvas. touchAction
    // none (set in the module) stops the browser scrolling/zooming the page while
    // the author paints.
    useEffect(() => {
        const canvas = canvasRef.current
        if(canvas === null) return

        let painting = false

        const onDown = (e: PointerEvent) => {
            painting = true
            lastCellRef.current = null
            canvas.setPointerCapture(e.pointerId)
            paintAt(e.clientX, e.clientY)
            e.preventDefault()
        }
        const onMove = (e: PointerEvent) => {
            if(painting === false) return
            paintAt(e.clientX, e.clientY)
            e.preventDefault()
        }
        const onUp = (e: PointerEvent) => {
            painting = false
            lastCellRef.current = null
            if(canvas.hasPointerCapture(e.pointerId)){
                canvas.releasePointerCapture(e.pointerId)
            }
        }

        canvas.addEventListener("pointerdown", onDown)
        canvas.addEventListener("pointermove", onMove)
        canvas.addEventListener("pointerup", onUp)
        canvas.addEventListener("pointercancel", onUp)
        canvas.addEventListener("pointerleave", onUp)

        return () => {
            canvas.removeEventListener("pointerdown", onDown)
            canvas.removeEventListener("pointermove", onMove)
            canvas.removeEventListener("pointerup", onUp)
            canvas.removeEventListener("pointercancel", onUp)
            canvas.removeEventListener("pointerleave", onUp)
        }
    }, [paintAt])

    // Commit the size inputs to the model, clamping into [MIN_GRID, MAX_GRID].
    // Called on blur / Enter so we don't resize on every keystroke.
    const applySize = useCallback(() => {
        const nextCols = clampGrid(parseInt(colsInput, 10))
        const nextRows = clampGrid(parseInt(rowsInput, 10))
        setColsInput(String(nextCols))
        setRowsInput(String(nextRows))
        const map = mapRef.current
        if(map.cols !== nextCols || map.rows !== nextRows){
            map.resize(nextCols, nextRows)
            bump()
            draw()
        }
    }, [colsInput, rowsInput, bump, draw])

    // Keep the model name in sync as the author types.
    const onNameChange = useCallback((value: string) => {
        setName(value)
        mapRef.current.name = value
    }, [])

    // Download the current map as GridMapData JSON via an object URL. No server.
    const onExport = useCallback(() => {
        const data = mapRef.current.toGridMapData()
        const json = serializeGridMapData(data)
        const blob = new Blob([json], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = mapFileName(data.name)
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
        trackEvent("export_map")
        setMessage(`Downloaded ${link.download}`)
    }, [])

    // Import a previously exported map JSON back into the editor.
    const onImportFile = useCallback((file: File) => {
        const reader = new FileReader()
        reader.onload = () => {
            try{
                const data = parseGridMapData(String(reader.result))
                const map = EditorMap.fromGridMapData(data)
                mapRef.current = map
                setName(map.name)
                setColsInput(String(map.cols))
                setRowsInput(String(map.rows))
                bump()
                draw()
                setMessage(`Loaded ${map.name}`)
            } catch(e){
                setMessage(e instanceof Error ? e.message : "Could not load map")
            }
        }
        reader.readAsText(file)
    }, [bump, draw])

    const onClear = useCallback(() => {
        mapRef.current.clear()
        bump()
        draw()
        setMessage("Cleared")
    }, [bump, draw])

    const spawnCount = mapRef.current.spawns.length

    return (
        <div className={`center-container ${styles.root}`}>
            <HomeBackground />
            <div className={`content-container ${styles.content}`}>
                <div className={styles.topBar}>
                    <div className={styles.title}>Map Maker</div>
                    <GameButton accent onClick={() => navigate("/")}>Back</GameButton>
                </div>

                <div className={styles.editor}>
                    <div className={styles.sidebar}>
                        <div className={styles.field}>
                            <label className={styles.label} htmlFor="map-name">Name</label>
                            <GameInput value={name} onChange={onNameChange} name="map-name" placeholder="Map name" />
                        </div>

                        <div className={styles.sizeRow}>
                            <div className={styles.field}>
                                <label className={styles.label} htmlFor="map-cols">Cols</label>
                                <GameInput
                                    value={colsInput}
                                    onChange={setColsInput}
                                    name="map-cols"
                                    type="number"
                                    onEnter={applySize}
                                    onBlur={applySize}
                                />
                            </div>
                            <div className={styles.field}>
                                <label className={styles.label} htmlFor="map-rows">Rows</label>
                                <GameInput
                                    value={rowsInput}
                                    onChange={setRowsInput}
                                    name="map-rows"
                                    type="number"
                                    onEnter={applySize}
                                    onBlur={applySize}
                                />
                            </div>
                        </div>
                        <div className={styles.hint}>{MIN_GRID}-{MAX_GRID} per side</div>

                        <div className={styles.paletteLabel}>Brush</div>
                        <div className={styles.palette}>
                            {BRUSHES.map((b) => (
                                <button
                                    key={b.brush}
                                    type="button"
                                    className={`${styles.swatch} ${brush === b.brush ? styles.swatchActive : ""}`}
                                    onClick={() => setBrush(b.brush)}
                                    aria-pressed={brush === b.brush}
                                >
                                    <span className={styles.swatchIcon}>
                                        <SwatchIcon brush={b.brush} color={b.color} />
                                    </span>
                                    <span className={styles.swatchLabel}>{b.label}</span>
                                </button>
                            ))}
                        </div>

                        <label className={styles.toggle}>
                            <input
                                type="checkbox"
                                checked={showCollision}
                                onChange={(e) => setShowCollision(e.target.checked)}
                            />
                            <span>Show collision</span>
                        </label>

                        <div className={styles.spawnNote}>
                            Spawns: {spawnCount}{spawnCount === 0 ? " (add at least one)" : ""}
                        </div>

                        <div className={styles.actions}>
                            <GameButton onClick={onExport}>Download JSON</GameButton>
                            <GameButton accent onClick={() => fileInputRef.current?.click()}>Import</GameButton>
                            <GameButton accent onClick={onClear}>Clear</GameButton>
                        </div>
                        {message.length > 0 && <div className={styles.message}>{message}</div>}

                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="application/json,.json"
                            className={styles.fileInput}
                            onChange={(e) => {
                                const file = e.target.files?.[0]
                                if(typeof file !== "undefined") onImportFile(file)
                                e.target.value = ""
                            }}
                        />
                    </div>

                    <div className={styles.canvasWrap}>
                        <canvas ref={canvasRef} className={styles.canvas} />
                    </div>
                </div>
            </div>
        </div>
    )
}

// Draw a single painted tile into a cell-sized box at (x, y). Full fills the
// box; the four diagonals fill the right-angle-cornered triangle (matching how
// grid-map.ts places the right angle in the named corner); deco fills a faded
// box so it reads as non-colliding decoration.
function drawTile(ctx: CanvasRenderingContext2D, shape: string, x: number, y: number, size: number){
    if(shape === "deco"){
        ctx.fillStyle = COLOR_DECO
        ctx.fillRect(x, y, size, size)
        return
    }
    if(shape === "full"){
        ctx.fillStyle = COLOR_BLOCK
        ctx.fillRect(x, y, size, size)
        return
    }
    // Diagonals: fill the triangle whose right angle sits in the named corner.
    ctx.fillStyle = shapeColor(shape)
    ctx.beginPath()
    const left = x
    const right = x + size
    const top = y
    const bottom = y + size
    if(shape === "diag_tl"){
        ctx.moveTo(left, top)
        ctx.lineTo(right, top)
        ctx.lineTo(left, bottom)
    } else if(shape === "diag_tr"){
        ctx.moveTo(left, top)
        ctx.lineTo(right, top)
        ctx.lineTo(right, bottom)
    } else if(shape === "diag_bl"){
        ctx.moveTo(left, top)
        ctx.lineTo(left, bottom)
        ctx.lineTo(right, bottom)
    } else {
        ctx.moveTo(right, top)
        ctx.lineTo(right, bottom)
        ctx.lineTo(left, bottom)
    }
    ctx.closePath()
    ctx.fill()
}

// A small SVG glyph for each palette swatch so the brush list reads at a glance:
// a filled square for blocks, a triangle for the matching diagonal, a faded box
// for deco, a ring for spawn, and a hollow box for erase.
function SwatchIcon({ brush, color }: { brush: EditorBrush, color: string }){
    const size = 20
    if(brush === "spawn"){
        return (
            <svg width={size} height={size} viewBox="0 0 20 20">
                <circle cx="10" cy="10" r="6" fill="none" stroke={color} strokeWidth="2.5" />
            </svg>
        )
    }
    if(brush === "empty"){
        return (
            <svg width={size} height={size} viewBox="0 0 20 20">
                <rect x="2" y="2" width="16" height="16" fill="none" stroke={color} strokeWidth="2" />
            </svg>
        )
    }
    if(brush === "full" || brush === "deco"){
        return (
            <svg width={size} height={size} viewBox="0 0 20 20">
                <rect x="2" y="2" width="16" height="16" fill={color} />
            </svg>
        )
    }
    // Diagonals: a right triangle in the matching corner.
    let points = "18,2 18,18 2,18"
    if(brush === "diag_tl") points = "2,2 18,2 2,18"
    else if(brush === "diag_tr") points = "2,2 18,2 18,18"
    else if(brush === "diag_bl") points = "2,2 2,18 18,18"
    return (
        <svg width={size} height={size} viewBox="0 0 20 20">
            <polygon points={points} fill={color} />
        </svg>
    )
}
