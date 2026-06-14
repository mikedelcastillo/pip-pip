import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import GameButton from "../components/GameButton"
import GameInput from "../components/GameInput"
import ConfirmModal from "../components/ConfirmModal"
import { loadGridMap } from "@pip-pip/game/src/logic/grid-map"
import {
    EditorMap,
    EditorBrush,
    SLOPE_BRUSHES,
    MIN_GRID,
    MAX_GRID,
    DEFAULT_COLS,
    DEFAULT_ROWS,
    DEFAULT_MAP_NAME,
    clampGrid,
    serializeGridMapData,
    parseGridMapData,
    mapFileName,
    brushForKey,
    saveEditorMap,
    loadEditorMap,
    clearEditorMap,
} from "../game/mapEditor"
import { trackEvent, trackPageView } from "../analytics"
import styles from "./MapEditor.module.sass"

// The homepage MAP EDITOR, redesigned to feel like Aseprite: an edge-to-edge
// paint canvas with a dark sprite-style checkerboard behind empty cells, a
// compact vertical TOOL RAIL of brush tools, and an OPTIONS popover that hides
// map settings + actions so the canvas stays uncluttered. Every tool and action
// has a single-key keyboard shortcut (shown in a styled tooltip), painting works
// click-and-drag, an autosaved draft survives a reload, and leaving with unsaved
// work asks for confirmation.
//
// The paintable grid lives in an EditorMap (pure model, see game/mapEditor.ts);
// this view only renders it to a <canvas> and wires pointer (mouse + touch)
// events to map.setCell. A second pass overlays the REAL collision/spawn
// geometry from loadGridMap so the author sees exactly the walls the game will
// build. Export downloads the GridMapData JSON loadGridMap consumes - no server.

// Palette swatch colours, kept in sync with the on-canvas tile fills so a
// button reads as the thing it paints. Amber blocks, purple slopes, muted deco.
const COLOR_BLOCK = "#E6AE10"
const COLOR_SLOPE = "#B07FC7"
const COLOR_DECO = "#5A4A54"
const COLOR_SPAWN = "#33DD55"
const COLOR_GRID = "rgba(255, 255, 255, 0.08)"
const COLOR_GRID_STRONG = "rgba(255, 255, 255, 0.18)"
const COLOR_COLLISION = "rgba(51, 221, 85, 0.9)"

// Aseprite-style transparency checkerboard behind empty cells, so the grid reads
// as a sprite canvas. Two near-black shades; one square per CHECKER_DIV-th of a
// cell so the pattern stays fine no matter the zoom.
const COLOR_CHECKER_A = "#141014"
const COLOR_CHECKER_B = "#0C090B"
const CHECKER_DIV = 2

// Viewport: cells are BASE_CELL * scale pixels, and the grid's top-left corner
// sits at (offsetX, offsetY) on screen. The author pans (trackpad two-finger
// scroll / two-finger touch drag) and zooms (Mac trackpad pinch -> ctrl+wheel,
// or two-finger touch pinch) around the cursor/midpoint, so a big map feels
// like a native canvas. Scale is clamped so it never collapses or explodes.
const BASE_CELL = 34
const MIN_SCALE = 0.12
const MAX_SCALE = 4

function clampScale(scale: number): number{
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
}

// Display labels for the brush shortcut keys, used to stamp each rail tool's
// tooltip. The pure model owns the actual key -> brush mapping (BRUSH_SHORTCUTS);
// this is only the human-facing letter shown to the author, and must agree with
// it so keyboard and rail stay in lockstep.
const SHORTCUT_FOR: Record<EditorBrush, string> = {
    empty: "E",
    full: "B",
    auto: "S",
    diag_tl: "Q",
    diag_tr: "W",
    diag_bl: "A",
    diag_br: "X",
    deco: "D",
    spawn: "G",
}

type ToolDef = { brush: EditorBrush, label: string, color: string, shortcut: string }

// Human label per brush (the four slope directions show in the Auto-slope
// dropdown). Pulled from the shared palette where possible.
const LABEL_FOR: Record<EditorBrush, string> = {
    empty: "Erase",
    full: "Block",
    auto: "Auto slope",
    diag_tl: "Slope TL",
    diag_tr: "Slope TR",
    diag_bl: "Slope BL",
    diag_br: "Slope BR",
    deco: "Deco",
    spawn: "Spawn",
}

// The rail tools, top to bottom. The four explicit slopes are NOT here: they are
// tucked into a dropdown under the Auto slope tool, which picks the direction
// from neighbours automatically.
const TOOLS: ToolDef[] = [
    { brush: "empty", label: LABEL_FOR.empty, color: COLOR_GRID_STRONG, shortcut: SHORTCUT_FOR.empty },
    { brush: "full", label: LABEL_FOR.full, color: COLOR_BLOCK, shortcut: SHORTCUT_FOR.full },
    { brush: "auto", label: LABEL_FOR.auto, color: COLOR_SLOPE, shortcut: SHORTCUT_FOR.auto },
    { brush: "deco", label: LABEL_FOR.deco, color: COLOR_DECO, shortcut: SHORTCUT_FOR.deco },
    { brush: "spawn", label: LABEL_FOR.spawn, color: COLOR_SPAWN, shortcut: SHORTCUT_FOR.spawn },
]

// The explicit slope directions shown in the Auto slope dropdown.
const SLOPE_TOOLS: ToolDef[] = SLOPE_BRUSHES.map((b) => ({
    brush: b, label: LABEL_FOR[b], color: COLOR_SLOPE, shortcut: SHORTCUT_FOR[b],
}))

// Fill colour for a painted shape, used by both the canvas tiles and the
// rail icons.
function shapeColor(shape: string): string{
    if(shape === "full") return COLOR_BLOCK
    if(shape === "deco") return COLOR_DECO
    return COLOR_SLOPE
}

// The injectable storage the autosave uses. window.localStorage in the browser;
// guarded so a non-DOM/SSR context (and tests that import the view) never throw.
function editorStorage(): Storage | null{
    try{
        return typeof window !== "undefined" ? window.localStorage : null
    } catch(e){
        return null
    }
}

export default function MapEditor(){
    const navigate = useNavigate()
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const fileInputRef = useRef<HTMLInputElement | null>(null)

    // The mutable editor model. Held in a ref (not React state) so high-rate
    // pointer drags mutate it directly without a re-render per cell; a separate
    // `version` counter bumps to trigger redraws/UI refreshes when needed. On
    // mount we restore an autosaved draft if one exists, so a reload or crash
    // never loses progress; otherwise we start from a default-sized blank map.
    const mapRef = useRef<EditorMap>(restoreInitialMap())
    const [version, setVersion] = useState(0)
    const bump = useCallback(() => setVersion((v) => v + 1), [])

    // The pan/zoom viewport. Held in a ref (mutated by gesture handlers without a
    // re-render) - `ready` is false until the first fit so a fresh/resized grid
    // auto-fits the canvas. Active touch pointers are tracked so one finger paints
    // and two fingers pinch/pan.
    const viewRef = useRef({ scale: 1, offsetX: 0, offsetY: 0, ready: false })
    const pointersRef = useRef<Map<number, { x: number, y: number }>>(new Map())

    const initial = mapRef.current
    const [brush, setBrush] = useState<EditorBrush>("full")
    const [name, setName] = useState(initial.name)
    const [colsInput, setColsInput] = useState(String(initial.cols))
    const [rowsInput, setRowsInput] = useState(String(initial.rows))
    const [showCollision, setShowCollision] = useState(false)
    const [message, setMessage] = useState("")
    const [optionsOpen, setOptionsOpen] = useState(false)
    const [slopeOpen, setSlopeOpen] = useState(false)
    const [confirmLeave, setConfirmLeave] = useState(false)
    // Becomes true on the first paint/resize/import/clear so the leave guard
    // (Back button + browser beforeunload) only fires when there is real work to
    // lose. A freshly restored draft counts as dirty too (see restore below).
    const [dirty, setDirty] = useState<boolean>(initial.tiles.some((v) => v > 0) || initial.spawns.length > 0)

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

    // Mark the map dirty (used by every mutating action so the leave guard knows
    // there is unsaved work) and clear any stale status message.
    const markDirty = useCallback(() => {
        setDirty(true)
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

    // Debounced localStorage autosave: persist the in-progress GridMapData a
    // short moment after the last edit so a reload/crash recovers the draft. The
    // persistence itself lives in the pure model (saveEditorMap) for testability;
    // here we only schedule it off the `version` counter.
    useEffect(() => {
        const storage = editorStorage()
        if(storage === null) return
        const id = window.setTimeout(() => {
            saveEditorMap(mapRef.current, storage)
        }, 400)
        return () => window.clearTimeout(id)
    }, [version, name])

    // Canvas CSS size (rounded up, never 0) so geometry maths stay finite.
    const canvasSize = useCallback(() => {
        const canvas = canvasRef.current
        if(canvas === null) return { w: 1, h: 1 }
        const rect = canvas.getBoundingClientRect()
        return { w: Math.max(1, rect.width), h: Math.max(1, rect.height) }
    }, [])

    // Fit + centre the whole grid in the canvas (the default view, and what the
    // "Fit" button / a grid resize returns to). Leaves a small margin so edge
    // cells are not flush against the frame.
    const fitView = useCallback(() => {
        const map = mapRef.current
        const { w, h } = canvasSize()
        const scale = clampScale(Math.min(w / (map.cols * BASE_CELL), h / (map.rows * BASE_CELL)) * 0.92)
        const cell = BASE_CELL * scale
        const v = viewRef.current
        v.scale = scale
        v.offsetX = (w - map.cols * cell) / 2
        v.offsetY = (h - map.rows * cell) / 2
        v.ready = true
    }, [canvasSize])

    // Current on-screen geometry: cell pixel size + the grid's top-left origin.
    // Fits on first use so the canvas always shows the grid before any gesture.
    const geometry = useCallback(() => {
        if(viewRef.current.ready === false) fitView()
        const v = viewRef.current
        return { cell: BASE_CELL * v.scale, ox: v.offsetX, oy: v.offsetY }
    }, [fitView])

    // Draw the entire editor: the Aseprite checkerboard backdrop, grid lines,
    // painted tiles (squares / diagonals / deco), spawn markers, and (optionally)
    // the loadGridMap collision overlay.
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

        const geo = geometry()
        const cell = geo.cell
        const gridW = cell * map.cols
        const gridH = cell * map.rows
        const ox = geo.ox
        const oy = geo.oy

        // Fill the whole viewport with the space colour so the canvas reads
        // edge to edge as one surface (the grid sits on top of it).
        ctx.fillStyle = "#0D090B"
        ctx.fillRect(0, 0, cssW, cssH)

        // Aseprite-style transparency checkerboard behind the grid, so empty
        // cells read as a sprite canvas rather than flat dark. Two squares per
        // cell, clipped to the grid rectangle.
        drawCheckerboard(ctx, ox, oy, gridW, gridH, cell / CHECKER_DIV)

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

        // A brighter border around the whole grid so its extent reads clearly
        // against the full-screen backdrop.
        ctx.strokeStyle = COLOR_GRID_STRONG
        ctx.lineWidth = 2
        ctx.strokeRect(ox - 1, oy - 1, gridW + 2, gridH + 2)

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
    }, [collision, geometry])

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
        const { cell, ox, oy } = geometry()
        const col = Math.floor((clientX - rect.left - ox) / cell)
        const row = Math.floor((clientY - rect.top - oy) / cell)
        if(map.inBounds(col, row) === false) return null
        return { col, row }
    }, [geometry])

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
            markDirty()
            bump()
            draw()
        }
    }, [cellFromEvent, bump, draw, markDirty])

    // Zoom by `ratio` around a canvas-relative focal point, keeping the world
    // point under the focal fixed (natural pinch / scroll-wheel zoom).
    const applyZoom = useCallback((focalX: number, focalY: number, ratio: number) => {
        const v = viewRef.current
        const newScale = clampScale(v.scale * ratio)
        const worldX = (focalX - v.offsetX) / (BASE_CELL * v.scale)
        const worldY = (focalY - v.offsetY) / (BASE_CELL * v.scale)
        v.scale = newScale
        v.offsetX = focalX - worldX * BASE_CELL * newScale
        v.offsetY = focalY - worldY * BASE_CELL * newScale
    }, [])

    // Slide the viewport by a screen-space delta (trackpad scroll / two-finger drag).
    const applyPan = useCallback((dx: number, dy: number) => {
        const v = viewRef.current
        v.offsetX += dx
        v.offsetY += dy
    }, [])

    // Pointer-event wiring. Pointer Events unify mouse + touch + pen, so a single
    // set of handlers paints on desktop and mobile. setPointerCapture keeps the
    // drag alive even if the finger/cursor briefly leaves the canvas. touchAction
    // none (set in the module) stops the browser scrolling/zooming the page while
    // the author paints.
    useEffect(() => {
        const canvas = canvasRef.current
        if(canvas === null) return

        const pointers = pointersRef.current
        let painting = false
        // Pinch/pan gesture state while two pointers are down.
        let gesture: { dist: number, midX: number, midY: number } | null = null

        // Distance + midpoint (canvas-relative) of the two active pointers.
        const pinchState = () => {
            const rect = canvas.getBoundingClientRect()
            const pts = Array.from(pointers.values())
            const ax = pts[0].x - rect.left, ay = pts[0].y - rect.top
            const bx = pts[1].x - rect.left, by = pts[1].y - rect.top
            return { dist: Math.max(1, Math.hypot(bx - ax, by - ay)), midX: (ax + bx) / 2, midY: (ay + by) / 2 }
        }

        const onDown = (e: PointerEvent) => {
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
            canvas.setPointerCapture(e.pointerId)
            if(pointers.size === 1){
                painting = true
                lastCellRef.current = null
                paintAt(e.clientX, e.clientY)
            } else if(pointers.size === 2){
                // A second finger turns the drag into a pinch/pan gesture: stop
                // painting and seed the gesture from the current two-finger pose.
                painting = false
                gesture = pinchState()
            }
            e.preventDefault()
        }
        const onMove = (e: PointerEvent) => {
            if(pointers.has(e.pointerId) === false) return
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
            if(pointers.size >= 2){
                const next = pinchState()
                if(gesture !== null){
                    // Zoom around the previous midpoint by the distance ratio, then
                    // pan by how far the midpoint moved: a natural pinch + drag.
                    applyZoom(gesture.midX, gesture.midY, next.dist / gesture.dist)
                    applyPan(next.midX - gesture.midX, next.midY - gesture.midY)
                    draw()
                }
                gesture = next
            } else if(painting){
                paintAt(e.clientX, e.clientY)
            }
            e.preventDefault()
        }
        const onUp = (e: PointerEvent) => {
            pointers.delete(e.pointerId)
            if(canvas.hasPointerCapture(e.pointerId)){
                canvas.releasePointerCapture(e.pointerId)
            }
            if(pointers.size < 2) gesture = null
            if(pointers.size === 0){
                painting = false
                lastCellRef.current = null
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
    }, [paintAt, applyZoom, applyPan, draw])

    // Native trackpad: a Mac pinch arrives as wheel + ctrlKey (so does Ctrl+wheel)
    // -> zoom around the cursor; a plain two-finger scroll -> pan. passive:false so
    // we can preventDefault and stop the page from scrolling/zooming underneath.
    useEffect(() => {
        const canvas = canvasRef.current
        if(canvas === null) return
        const onWheel = (e: WheelEvent) => {
            e.preventDefault()
            const rect = canvas.getBoundingClientRect()
            const fx = e.clientX - rect.left
            const fy = e.clientY - rect.top
            if(e.ctrlKey){
                applyZoom(fx, fy, Math.exp(-e.deltaY * 0.01))
            } else{
                applyPan(-e.deltaX, -e.deltaY)
            }
            draw()
        }
        canvas.addEventListener("wheel", onWheel, { passive: false })
        return () => canvas.removeEventListener("wheel", onWheel)
    }, [applyZoom, applyPan, draw])

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
            // Re-fit the viewport to the new grid (geometry() refits when !ready).
            viewRef.current.ready = false
            markDirty()
            bump()
            draw()
        }
    }, [colsInput, rowsInput, bump, draw, markDirty])

    // Keep the model name in sync as the author types.
    const onNameChange = useCallback((value: string) => {
        setName(value)
        mapRef.current.name = value
        markDirty()
    }, [markDirty])

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
                // Re-fit the viewport to the imported grid.
                viewRef.current.ready = false
                markDirty()
                bump()
                draw()
                setMessage(`Loaded ${map.name}`)
            } catch(e){
                setMessage(e instanceof Error ? e.message : "Could not load map")
            }
        }
        reader.readAsText(file)
    }, [bump, draw, markDirty])

    // Clear every tile/spawn AND forget the autosaved draft, so this is a true
    // "start fresh" (a reload after Clear comes up blank, not the cleared map).
    const onClear = useCallback(() => {
        mapRef.current.clear()
        const storage = editorStorage()
        if(storage !== null) clearEditorMap(storage)
        setDirty(false)
        bump()
        draw()
        setMessage("Cleared")
    }, [bump, draw])

    // Reset the pan/zoom to fit the whole grid (geometry() refits when !ready).
    const fitNow = useCallback(() => {
        viewRef.current.ready = false
        draw()
    }, [draw])

    // Leaving the editor: only confirm when there is unsaved work, otherwise go
    // straight back. The ConfirmModal handles the in-app Back prompt; the
    // beforeunload effect below handles a browser tab close / reload.
    const onBack = useCallback(() => {
        if(dirty){
            setConfirmLeave(true)
        } else{
            navigate("/")
        }
    }, [dirty, navigate])

    const leaveNow = useCallback(() => {
        setConfirmLeave(false)
        navigate("/")
    }, [navigate])

    // Browser-level leave guard: a tab close / reload with unsaved work triggers
    // the native "leave site?" prompt. Removed when clean so we never nag.
    useEffect(() => {
        if(dirty === false) return
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault()
            e.returnValue = ""
            return ""
        }
        window.addEventListener("beforeunload", onBeforeUnload)
        return () => window.removeEventListener("beforeunload", onBeforeUnload)
    }, [dirty])

    // Global keyboard shortcuts, Aseprite-style. A single key selects a tool
    // (via the pure brushForKey mapping); F fits the view; Cmd/Ctrl+S downloads.
    // Ignored while typing in an input/textarea so size/name fields work, and
    // while a modal is open so Escape/typing there is unaffected.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if(confirmLeave) return
            const target = e.target as HTMLElement | null
            const tag = target?.tagName
            if(tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable === true) return

            // Cmd/Ctrl+S downloads instead of triggering the browser's save page.
            if((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s"){
                e.preventDefault()
                onExport()
                return
            }
            if(e.metaKey || e.ctrlKey || e.altKey) return

            const key = e.key.toLowerCase()
            const toolBrush = brushForKey(e.key)
            if(toolBrush !== null){
                e.preventDefault()
                setBrush(toolBrush)
                return
            }
            if(key === "f"){
                e.preventDefault()
                fitNow()
            } else if(key === "o"){
                e.preventDefault()
                setOptionsOpen((v) => v === false)
            }
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [confirmLeave, onExport, fitNow])

    const spawnCount = mapRef.current.spawns.length

    return (
        <div className={styles.root}>
            <canvas ref={canvasRef} className={styles.canvas} />

            {/* Tool rail: compact vertical toolbar of brush tools, Aseprite-style. */}
            <div className={styles.toolRail} role="toolbar" aria-label="Brush tools">
                {TOOLS.map((tool) => {
                    if(tool.brush === "auto"){
                        // Auto slope: the active state covers the auto brush AND any
                        // explicit direction (they live in its dropdown). The rail
                        // icon mirrors whichever is selected.
                        const slopeActive = brush === "auto" || SLOPE_BRUSHES.indexOf(brush) !== -1
                        const iconBrush: EditorBrush = SLOPE_BRUSHES.indexOf(brush) !== -1 ? brush : "auto"
                        return (
                            <div key="auto" className={styles.toolGroup}>
                                <button
                                    type="button"
                                    className={`${styles.tool} ${slopeActive ? styles.toolActive : ""}`}
                                    onClick={() => setBrush("auto")}
                                    aria-pressed={slopeActive}
                                    aria-label={`${tool.label} (${tool.shortcut})`}
                                    title={`${tool.label} (${tool.shortcut})`}
                                    data-tip={`${tool.label} (${tool.shortcut})`}
                                >
                                    <span className={styles.toolIcon}>
                                        <ToolIcon brush={iconBrush} color={tool.color} />
                                    </span>
                                    <span className={styles.toolKey}>{tool.shortcut}</span>
                                </button>
                                <button
                                    type="button"
                                    className={styles.toolCaret}
                                    onClick={() => setSlopeOpen((o) => !o)}
                                    aria-label="Slope directions"
                                    aria-expanded={slopeOpen}
                                    title="Slope directions"
                                >&#9656;</button>
                                {slopeOpen && (
                                    <div className={styles.slopeFlyout} role="menu">
                                        {SLOPE_TOOLS.map((s) => (
                                            <button
                                                key={s.brush}
                                                type="button"
                                                className={`${styles.slopeItem} ${brush === s.brush ? styles.slopeItemActive : ""}`}
                                                onClick={() => { setBrush(s.brush); setSlopeOpen(false) }}
                                                aria-pressed={brush === s.brush}
                                                aria-label={`${s.label} (${s.shortcut})`}
                                                title={`${s.label} (${s.shortcut})`}
                                            >
                                                <span className={styles.toolIcon}>
                                                    <ToolIcon brush={s.brush} color={s.color} />
                                                </span>
                                                <span className={styles.slopeItemLabel}>{s.label}</span>
                                                <span className={styles.toolKey}>{s.shortcut}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )
                    }
                    return (
                        <button
                            key={tool.brush}
                            type="button"
                            className={`${styles.tool} ${brush === tool.brush ? styles.toolActive : ""}`}
                            onClick={() => setBrush(tool.brush)}
                            aria-pressed={brush === tool.brush}
                            aria-label={`${tool.label} (${tool.shortcut})`}
                            title={`${tool.label} (${tool.shortcut})`}
                            data-tip={`${tool.label} (${tool.shortcut})`}
                        >
                            <span className={styles.toolIcon}>
                                <ToolIcon brush={tool.brush} color={tool.color} />
                            </span>
                            <span className={styles.toolKey}>{tool.shortcut}</span>
                        </button>
                    )
                })}
            </div>

            {/* Top bar: title, Options, and Back. Floats over the canvas. */}
            <div className={styles.topBar}>
                <div className={styles.brand}>Map Maker</div>
                <div className={styles.topActions}>
                    <button
                        type="button"
                        className={`${styles.iconButton} ${optionsOpen ? styles.iconButtonActive : ""}`}
                        onClick={() => setOptionsOpen((v) => v === false)}
                        aria-label="Map options (O)"
                        aria-expanded={optionsOpen}
                        title="Map options (O)"
                        data-tip="Map options (O)"
                    >
                        <GearIcon />
                    </button>
                    <button
                        type="button"
                        className={styles.iconButton}
                        onClick={onBack}
                        aria-label="Back to home"
                        title="Back"
                        data-tip="Back"
                    >
                        <BackIcon />
                    </button>
                </div>
            </div>

            {/* A compact status readout pinned to the bottom: spawn count + tip. */}
            <div className={styles.statusBar}>
                <span className={spawnCount === 0 ? styles.statusWarn : styles.statusGood}>
                    {spawnCount} spawn{spawnCount === 1 ? "" : "s"}
                </span>
                <span className={styles.statusDim}>
                    {mapRef.current.cols} x {mapRef.current.rows}
                </span>
                {message.length > 0 && <span className={styles.statusMsg}>{message}</span>}
            </div>

            {/* Options popover: map settings + actions, hidden until opened. */}
            {optionsOpen && (
                <>
                    <div className={styles.scrim} onClick={() => setOptionsOpen(false)} />
                    <div className={styles.optionsPanel} role="dialog" aria-label="Map options">
                        <div className={styles.optionsHeader}>
                            <span>Map Options</span>
                            <button
                                type="button"
                                className={styles.closeButton}
                                onClick={() => setOptionsOpen(false)}
                                aria-label="Close options"
                                title="Close"
                            >
                                <CloseIcon />
                            </button>
                        </div>

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

                        <label className={styles.toggle}>
                            <input
                                type="checkbox"
                                checked={showCollision}
                                onChange={(e) => setShowCollision(e.target.checked)}
                            />
                            <span>Show collision</span>
                        </label>

                        <div className={styles.actions}>
                            <GameButton onClick={onExport}>Download JSON</GameButton>
                            <GameButton accent onClick={() => fileInputRef.current?.click()}>Import</GameButton>
                            <GameButton accent onClick={fitNow}>Fit view</GameButton>
                            <GameButton accent onClick={onClear}>Clear</GameButton>
                        </div>
                        <div className={styles.hint}>
                            Scroll to pan, pinch (or ctrl+scroll) to zoom. Two fingers pan/zoom on touch.
                            Press F to fit, Cmd/Ctrl+S to download.
                        </div>
                    </div>
                </>
            )}

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

            {confirmLeave && (
                <ConfirmModal
                    title="Leave editor?"
                    message="Are you sure you want to leave? Your map is autosaved here, but unexported changes will not be downloaded."
                    confirmLabel="Leave"
                    cancelLabel="Stay"
                    onConfirm={leaveNow}
                    onClose={() => setConfirmLeave(false)}
                />
            )}
        </div>
    )
}

// Restore the autosaved draft on mount, or fall back to a default-sized blank
// map. Kept out of the component body so the initial useRef/useState reads stay
// a single synchronous call.
function restoreInitialMap(): EditorMap{
    const storage = editorStorage()
    if(storage !== null){
        const restored = loadEditorMap(storage)
        if(restored !== null) return restored
    }
    return new EditorMap(DEFAULT_COLS, DEFAULT_ROWS, DEFAULT_MAP_NAME)
}

// Paint the Aseprite transparency checkerboard inside the grid rectangle. Two
// alternating near-black squares of side `sq`, clipped to (ox, oy, w, h) so it
// never bleeds past the grid edge.
function drawCheckerboard(ctx: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number, sq: number){
    if(sq <= 0) return
    ctx.save()
    ctx.beginPath()
    ctx.rect(ox, oy, w, h)
    ctx.clip()
    const cols = Math.ceil(w / sq)
    const rows = Math.ceil(h / sq)
    for(let r = 0; r < rows; r++){
        for(let c = 0; c < cols; c++){
            ctx.fillStyle = (r + c) % 2 === 0 ? COLOR_CHECKER_A : COLOR_CHECKER_B
            ctx.fillRect(ox + c * sq, oy + r * sq, sq, sq)
        }
    }
    ctx.restore()
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

// A small SVG glyph for each rail tool so the toolbar reads at a glance: a
// filled square for blocks, a triangle for the matching diagonal, a faded box
// for deco, a ring for spawn, and a hollow box for erase.
function ToolIcon({ brush, color }: { brush: EditorBrush, color: string }){
    const size = 22
    if(brush === "spawn"){
        return (
            <svg width={size} height={size} viewBox="0 0 20 20">
                <circle cx="10" cy="10" r="6" fill="none" stroke={color} strokeWidth="2.5" />
                <circle cx="10" cy="10" r="1.6" fill={color} />
            </svg>
        )
    }
    if(brush === "empty"){
        return (
            <svg width={size} height={size} viewBox="0 0 20 20">
                <rect x="2.5" y="2.5" width="15" height="15" fill="none" stroke={color} strokeWidth="2" strokeDasharray="3 2" />
            </svg>
        )
    }
    if(brush === "full" || brush === "deco"){
        return (
            <svg width={size} height={size} viewBox="0 0 20 20">
                <rect x="2" y="2" width="16" height="16" fill={color} opacity={brush === "deco" ? 0.85 : 1} />
            </svg>
        )
    }
    if(brush === "auto"){
        // A slope triangle with a small spark, signalling "smart / auto" slope.
        return (
            <svg width={size} height={size} viewBox="0 0 20 20">
                <polygon points="3,17 17,17 17,4" fill={color} opacity="0.9" />
                <circle cx="6" cy="6" r="1.8" fill={color} />
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

// A gear glyph for the Options button.
function GearIcon(){
    return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
        </svg>
    )
}

// A left-chevron glyph for the Back button.
function BackIcon(){
    return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
        </svg>
    )
}

// An X glyph for the close-options button.
function CloseIcon(){
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
        </svg>
    )
}
