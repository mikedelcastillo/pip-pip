import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router-dom"
import GameButton from "../components/GameButton"
import GameInput from "../components/GameInput"
import ConfirmModal from "../components/ConfirmModal"
import { loadGridMap } from "@pip-pip/game/src/logic/grid-map"
import {
    EditorMap,
    EditorBrush,
    EditorHistory,
    DrawMode,
    SLOPE_BRUSHES,
    DEFAULT_MAP_NAME,
    parseCellKey,
    serializeGridMapData,
    parseGridMapData,
    mapFileName,
    brushForKey,
    saveEditorMap,
    loadEditorMap,
    clearEditorMap,
    stashPlayMap,
    rectCells,
    lineCells,
    boundedFloodFill,
    brushAtCell,
    materialAtCell,
    EDITOR_MATERIALS,
    DEFAULT_MATERIAL_KEY,
    Cell,
} from "../game/mapEditor"
import { blockFaceCss } from "../game/mapGraphics"
import { trackEvent, trackPageView } from "../analytics"
import styles from "./MapEditor.module.sass"

// The homepage MAP EDITOR, redesigned to feel like Aseprite: an edge-to-edge
// paint canvas with a dark sprite-style checkerboard behind empty cells, a
// compact vertical TOOL RAIL of brush tools, and an OPTIONS popover that hides
// map settings + actions so the canvas stays uncluttered. Every tool and action
// has a single-key keyboard shortcut (shown in a portal tooltip), painting works
// click-and-drag, an autosaved draft survives a reload, and leaving with unsaved
// work asks for confirmation.
//
// The canvas is UNBOUNDED: there is no fixed grid size, the author paints cells
// at ANY coordinate (reachable by panning/zooming), and the exported cols/rows
// are computed from the bounding box of everything painted at export time. The
// paintable grid lives in a SPARSE EditorMap (pure model, see game/mapEditor.ts);
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
// A neutral light tint for the draw-mode glyphs, so the mode strip reads as
// monochrome "how to paint" controls distinct from the coloured brush swatches.
const COLOR_MODE_ICON = "rgba(255, 255, 255, 0.85)"

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

// How many cells wide/tall a FRESH (empty) canvas fits to, so the author opens
// at a comfortable zoom around the origin instead of a single giant cell. Once
// anything is painted, Fit uses the real bounding box instead.
const DEFAULT_FIT_SPAN = 20

// How many cells of EMPTY grid to draw beyond the painted content + viewport, so
// the author always sees a little room to paint into without the grid appearing
// to be a hard edge. The canvas itself is unbounded; this is only how much of it
// we bother stroking.
const VIEWPORT_PADDING_CELLS = 2

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

// The DRAW MODES, orthogonal to the brush: the brush says WHAT to paint, the
// mode says HOW. Freehand is the default (one cell per pointer position);
// rect/line draw a previewed shape committed on pointer-up; fill flood-fills the
// connected region under a click. Modes are CLICK-ONLY (no keyboard shortcut):
// the single-key brush shortcuts already claim the obvious letters (R is free but
// L/F/B clash, and keeping modes click-only avoids any ambiguity), so the mode
// strip is the one place modes are chosen. Each entry carries an icon kind drawn
// by ModeIcon and a label shown in the portal tooltip.
// The mode strip carries the four DRAW MODES plus one TOOL: "pick" (the
// eyedropper). Pick is NOT a DrawMode (it never paints a cell set, so the pure
// model's DrawMode stays exactly the paint modes); it is a VIEW-only mode that, on
// a single tap, reads the tapped cell's brush back into the active brush and then
// auto-returns to freehand so the author paints immediately with the picked brush
// (Aseprite-like). EditorMode is therefore DrawMode widened by "pick".
type EditorMode = DrawMode | "pick"
type ModeDef = { mode: EditorMode, label: string }
const MODE_DEFS: ModeDef[] = [
    { mode: "freehand", label: "Freehand" },
    { mode: "rect", label: "Rectangle" },
    { mode: "line", label: "Line" },
    { mode: "fill", label: "Fill" },
    { mode: "pick", label: "Pick (eyedropper)" },
]

// Translucent fill for the live rect/line ERASE preview overlay drawn while
// dragging, so the author sees the cells a stroke would clear before committing.
// Adding strokes preview in the active material colour instead (see
// previewFillStyle), so the preview shows both the shape and the colour.
const COLOR_PREVIEW_ERASE = "rgba(255, 80, 80, 0.30)"

// The opacity (0..1) the rect/line ADD preview overlay tints the active material
// at, so the shape reads as "about to paint here in this colour" without fully
// hiding the grid underneath.
const PREVIEW_ALPHA = 0.42

// Parse a "#rrggbb" CSS colour into an "rgba(r, g, b, a)" string at the given
// alpha. Used to tint the shape preview in the active material's face colour
// (which arrives as a hex string from blockFaceCss) at PREVIEW_ALPHA. Falls back
// to the raw colour when the input is not a 6-digit hex.
function hexToRgba(hex: string, alpha: number): string{
    const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
    if(m === null) return hex
    const n = parseInt(m[1], 16)
    const r = (n >> 16) & 0xff
    const g = (n >> 8) & 0xff
    const b = n & 0xff
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// The fill style for the rect/line preview overlay, given the active brush +
// material: an erase brush previews red (removing), deco previews its fixed faded
// hue (deco ignores the material), and every colourable brush previews in its
// material's face colour so the author sees the colour they will paint.
function previewFillStyle(brush: EditorBrush, materialKey: string): string{
    if(brush === "empty") return COLOR_PREVIEW_ERASE
    if(brush === "deco") return hexToRgba(rgbHexFromCss(COLOR_DECO), PREVIEW_ALPHA)
    return hexToRgba(blockFaceCss(materialKey), PREVIEW_ALPHA)
}

// Normalise a CSS colour that is already a 6-digit hex (our COLOR_* constants
// are) so hexToRgba can tint it. A passthrough today, kept as a single seam so a
// later non-hex constant degrades gracefully rather than silently mis-tinting.
function rgbHexFromCss(css: string): string{
    return /^#([0-9a-fA-F]{6})$/.test(css) ? css : "#5A4A54"
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

// Show the right modifier in the undo/redo tooltips: Cmd on a Mac, Ctrl
// everywhere else, so the on-screen hint matches the key the author would
// actually press. Best-effort platform sniff; falls back to Ctrl when unknown.
function isApplePlatform(): boolean{
    try{
        return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "")
    } catch(e){
        return false
    }
}

const MOD_KEY = isApplePlatform() ? "Cmd" : "Ctrl"
const UNDO_SHORTCUT = `${MOD_KEY}+Z`
const REDO_SHORTCUT = `${MOD_KEY}+Shift+Z`

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

    // Aseprite-style undo/redo, scoped to canvas CONTENT (tiles + spawns; the map
    // name is a text field and is not undoable). The history lives in a ref (it is
    // a mutable model the imperative pointer handlers drive), while `canUndo` /
    // `canRedo` are mirrored into React state so the on-screen buttons can show a
    // disabled state. A single paint GESTURE (pointer-down -> drag -> up) commits
    // as ONE step: the view begins a snapshot at pointer-down and commits it at
    // pointer-up.
    const historyRef = useRef<EditorHistory>(new EditorHistory())
    const [canUndo, setCanUndo] = useState(false)
    const [canRedo, setCanRedo] = useState(false)
    const refreshHistoryFlags = useCallback(() => {
        const history = historyRef.current
        setCanUndo(history.canUndo())
        setCanRedo(history.canRedo())
    }, [])

    // The pan/zoom viewport. Held in a ref (mutated by gesture handlers without a
    // re-render) - `ready` is false until the first fit so a fresh/resized grid
    // auto-fits the canvas. Active touch pointers are tracked so one finger paints
    // and two fingers pinch/pan.
    const viewRef = useRef({ scale: 1, offsetX: 0, offsetY: 0, ready: false })
    const pointersRef = useRef<Map<number, { x: number, y: number }>>(new Map())

    const initial = mapRef.current
    const [brush, setBrush] = useState<EditorBrush>("full")
    // The active MATERIAL (block colour). Applies to the block brush AND every
    // slope (explicit + auto) so a slope matches its block colour; deco ignores it
    // (it stays the non-colliding tile_hidden). Held in React state so the picker
    // and previews re-render, and mirrored to a ref below so the imperative pointer
    // handlers paint with the live selection. Defaults to the original plum so a
    // fresh editor looks exactly like today until a colour is picked.
    const [material, setMaterial] = useState<string>(DEFAULT_MATERIAL_KEY)
    // The active mode (orthogonal to the brush). Freehand by default = the
    // original one-cell-per-position painting; rect/line preview then commit a
    // shape; fill flood-fills under a click; pick is the eyedropper (a single tap
    // reads the cell's brush, then auto-returns to freehand).
    const [mode, setMode] = useState<EditorMode>("freehand")
    const [name, setName] = useState(initial.name)
    const [showCollision, setShowCollision] = useState(false)
    const [message, setMessage] = useState("")
    const [optionsOpen, setOptionsOpen] = useState(false)
    const [slopeOpen, setSlopeOpen] = useState(false)
    const [confirmLeave, setConfirmLeave] = useState(false)
    // Becomes true on the first paint/import/clear so the leave guard (Back
    // button + browser beforeunload) only fires when there is real work to lose.
    // A freshly restored draft counts as dirty too (see restore below).
    const [dirty, setDirty] = useState<boolean>(initial.tiles.size > 0 || initial.spawns.length > 0)

    // The active brush is read inside imperative pointer handlers, which capture
    // their closure once; mirror it into a ref so a drag always paints the
    // currently selected brush, not the one selected when the canvas mounted.
    const brushRef = useRef(brush)
    brushRef.current = brush
    // The active material is likewise read inside the imperative pointer handlers,
    // so mirror it into a ref so a drag always paints the currently selected
    // colour, not the one selected when the canvas mounted.
    const materialRef = useRef(material)
    materialRef.current = material
    // The active mode is likewise read inside the imperative pointer handlers, so
    // mirror it into a ref so a gesture always uses the currently selected mode.
    const modeRef = useRef(mode)
    modeRef.current = mode
    const showCollisionRef = useRef(showCollision)
    showCollisionRef.current = showCollision

    // The in-progress shape gesture for rect/line: the cell the pointer went down
    // on (start) and the cell it is currently over (current). Held in a ref (not
    // state) so the high-rate drag updates it and re-draws the preview without a
    // React re-render per move. null when no shape gesture is open. draw() reads
    // this to render the translucent preview overlay; pointer-up reads it to
    // compute the committed cell set.
    const shapeRef = useRef<{ start: Cell, current: Cell } | null>(null)

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

    // Fit + centre the painted content in the canvas (the default view, and what
    // the "Fit" button returns to). The canvas is unbounded, so we fit the
    // BOUNDING BOX of everything painted; an empty map falls back to a default
    // span so a fresh canvas opens at a sensible zoom around the origin. Leaves a
    // small margin so edge cells are not flush against the frame.
    const fitView = useCallback(() => {
        const map = mapRef.current
        const { w, h } = canvasSize()
        const box = map.bounds()
        const spanCols = box.empty ? DEFAULT_FIT_SPAN : box.maxCol - box.minCol + 1
        const spanRows = box.empty ? DEFAULT_FIT_SPAN : box.maxRow - box.minRow + 1
        const scale = clampScale(Math.min(w / (spanCols * BASE_CELL), h / (spanRows * BASE_CELL)) * 0.92)
        const cell = BASE_CELL * scale
        const v = viewRef.current
        v.scale = scale
        // Place the bbox min cell so the painted content (or the default span,
        // centred on the origin) sits centred in the viewport.
        const originCol = box.empty ? -DEFAULT_FIT_SPAN / 2 : box.minCol
        const originRow = box.empty ? -DEFAULT_FIT_SPAN / 2 : box.minRow
        v.offsetX = (w - spanCols * cell) / 2 - originCol * cell
        v.offsetY = (h - spanRows * cell) / 2 - originRow * cell
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
        const ox = geo.ox
        const oy = geo.oy

        // Fill the whole viewport with the space colour so the canvas reads
        // edge to edge as one surface (the grid sits on top of it).
        ctx.fillStyle = "#0D090B"
        ctx.fillRect(0, 0, cssW, cssH)

        // The canvas is UNBOUNDED, so we draw only the cells inside the VISIBLE
        // viewport, padded a little so there is room to paint into. Screen (0,0)
        // maps to cell (-ox/cell, -oy/cell); the far corner maps to the cell under
        // (cssW, cssH). This window is intentionally viewport-only (not unioned
        // with the painted bounding box): painted tiles are culled to it below, so
        // the grid lines + checkerboard cost stays O(viewport) no matter how far
        // apart cells are painted. A Fit zooms so all content lands inside the
        // viewport, so the whole map is still drawn after fitting.
        const startCol = Math.floor(-ox / cell) - VIEWPORT_PADDING_CELLS
        const startRow = Math.floor(-oy / cell) - VIEWPORT_PADDING_CELLS
        const endCol = Math.ceil((cssW - ox) / cell) + VIEWPORT_PADDING_CELLS
        const endRow = Math.ceil((cssH - oy) / cell) + VIEWPORT_PADDING_CELLS
        const gridX = ox + startCol * cell
        const gridY = oy + startRow * cell
        const gridW = (endCol - startCol) * cell
        const gridH = (endRow - startRow) * cell

        // Aseprite-style transparency checkerboard behind the grid, so empty
        // cells read as a sprite canvas rather than flat dark. Two squares per
        // cell, clipped to the visible grid rectangle.
        drawCheckerboard(ctx, gridX, gridY, gridW, gridH, cell / CHECKER_DIV)

        // Painted tiles: walk only the cells that actually exist (sparse model),
        // skipping any outside the visible window so a far-away cell costs
        // nothing to keep but nothing to draw off-screen.
        for(const [key, value] of map.tiles){
            const [col, row] = parseCellKey(key)
            if(col < startCol || col >= endCol || row < startRow || row >= endRow) continue
            const entry = map.palette[value - 1]
            if(typeof entry === "undefined") continue
            // Colour each tile by its palette entry's material KEY through the same
            // TILE_BLOCK_STYLES the in-game renderer uses, so the editor preview is
            // the in-game look (deco ignores it inside drawTile).
            drawTile(ctx, entry.shape, blockFaceCss(entry.key), ox + col * cell, oy + row * cell, cell)
        }

        // Grid lines on top of fills so cell edges stay legible while painting.
        ctx.strokeStyle = COLOR_GRID
        ctx.lineWidth = 1
        ctx.beginPath()
        for(let col = startCol; col <= endCol; col++){
            const x = ox + col * cell + 0.5
            ctx.moveTo(x, gridY)
            ctx.lineTo(x, gridY + gridH)
        }
        for(let row = startRow; row <= endRow; row++){
            const y = oy + row * cell + 0.5
            ctx.moveTo(gridX, y)
            ctx.lineTo(gridX + gridW, y)
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

        // Live shape PREVIEW for rect/line: while a shape gesture is open, draw a
        // translucent overlay of the cells the shape WOULD paint, so the author
        // sees the result before pointer-up commits it. Erase brushes preview in
        // red (removing), everything else in amber (adding). Culled to the visible
        // window like the painted tiles so a huge rectangle stays cheap.
        const shape = shapeRef.current
        const activeMode = modeRef.current
        if(shape !== null && (activeMode === "rect" || activeMode === "line")){
            const previewCells = activeMode === "rect"
                ? rectCells(shape.start, shape.current)
                : lineCells(shape.start, shape.current)
            // Preview adds in the ACTIVE material colour (semi-transparent) so the
            // author sees the shape AND the colour it will paint; erase previews in
            // red. Deco previews as the fixed deco hue (it ignores the material).
            ctx.fillStyle = previewFillStyle(brushRef.current, materialRef.current)
            for(const [col, row] of previewCells){
                if(col < startCol || col >= endCol || row < startRow || row >= endRow) continue
                ctx.fillRect(ox + col * cell, oy + row * cell, cell, cell)
            }
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
        const rect = canvas.getBoundingClientRect()
        const { cell, ox, oy } = geometry()
        // The canvas is unbounded, so every screen point maps to a paintable
        // cell; no bounds check (the model accepts any integer coordinate).
        const col = Math.floor((clientX - rect.left - ox) / cell)
        const row = Math.floor((clientY - rect.top - oy) / cell)
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
        const changed = mapRef.current.setCell(cellPos.col, cellPos.row, brushRef.current, materialRef.current)
        if(changed){
            markDirty()
            bump()
            draw()
        }
    }, [cellFromEvent, bump, draw, markDirty])

    // PICK / eyedropper: read the brush of the cell under the pointer back into
    // the active brush (Aseprite's eyedropper). PURE READ: it calls brushAtCell on
    // the model and never mutates the map, so it paints/erases nothing and creates
    // NO undo step. A pick over empty space picks "empty" (the eraser). When
    // `returnToFreehand` is true (the Pick MODE path) the mode auto-switches back
    // to freehand so the author paints immediately with the picked brush; the
    // one-shot Alt+click path passes false so the current mode is preserved.
    const pickAt = useCallback((clientX: number, clientY: number, returnToFreehand: boolean) => {
        const cellPos = cellFromEvent(clientX, clientY)
        if(cellPos === null) return
        const picked = brushAtCell(mapRef.current, cellPos.col, cellPos.row)
        setBrush(picked)
        // Adopt the cell's MATERIAL (colour) too, so picking a blue slope keeps
        // painting blue slopes. materialAtCell is null over empty/spawn/deco cells
        // (nothing colourable to adopt), in which case the active material stays.
        const pickedMaterial = materialAtCell(mapRef.current, cellPos.col, cellPos.row)
        if(pickedMaterial !== null) setMaterial(pickedMaterial)
        if(returnToFreehand) setMode("freehand")
    }, [cellFromEvent])

    // Apply the active brush to a whole SET of cells in one batch, then redraw
    // once. Used by the rect/line/fill modes on pointer-up: each cell routes
    // through setCell so spawn/tile mutual exclusion and the spawn toggle stay
    // correct (a spawn brush over the set toggles a spawn per cell). The caller
    // owns the history step (begin before, commit after), so the whole shape is
    // ONE undo step. Returns true if any cell changed, so a no-op shape commits
    // nothing.
    const applyCells = useCallback((cells: Cell[]) => {
        const map = mapRef.current
        const brushNow = brushRef.current
        const materialNow = materialRef.current
        let changed = false
        for(const [col, row] of cells){
            if(map.setCell(col, row, brushNow, materialNow)) changed = true
        }
        if(changed){
            markDirty()
            bump()
            draw()
        }
        return changed
    }, [bump, draw, markDirty])

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
        // Whether a single-pointer gesture is live and may paint/preview/commit.
        // Cleared the instant a second finger lands so two-finger gestures never
        // paint and any open shape preview is abandoned.
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

        // Abandon any in-progress single-pointer gesture WITHOUT committing it:
        // drop the open history step and clear a rect/line preview. Called when a
        // second finger lands (the gesture becomes a pinch/pan) so a half-drawn
        // shape never paints and the snapshot opened at pointer-down is discarded.
        const abandonGesture = () => {
            painting = false
            if(shapeRef.current !== null){
                shapeRef.current = null
                historyRef.current.cancel()
                draw()
            }
        }

        const onDown = (e: PointerEvent) => {
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
            canvas.setPointerCapture(e.pointerId)
            if(pointers.size === 1){
                // PICK paths first (they never paint, never open a history step):
                // (a) Alt+click is a desktop one-shot eyedropper in ANY mode and
                // leaves the current mode unchanged; (b) the Pick MODE reads the
                // cell and auto-returns to freehand. Either way we read the cell and
                // stop: no `painting`, no history.begin, so a pick can never paint,
                // erase, or create an undo step.
                const m = modeRef.current
                if(e.altKey){
                    pickAt(e.clientX, e.clientY, false)
                    e.preventDefault()
                    return
                }
                if(m === "pick"){
                    pickAt(e.clientX, e.clientY, true)
                    e.preventDefault()
                    return
                }
                painting = true
                lastCellRef.current = null
                // Open one history step for this whole gesture: snapshot the
                // pre-gesture canvas now, commit it at pointer-up if anything
                // changed. A freehand drag, a rect/line shape, or a fill each
                // therefore undoes in ONE step (Aseprite-style).
                historyRef.current.begin(mapRef.current)
                if(m === "rect" || m === "line"){
                    // Record the shape's start cell but do NOT mutate the map yet:
                    // the preview overlay shows the shape, and pointer-up commits it.
                    const cellPos = cellFromEvent(e.clientX, e.clientY)
                    if(cellPos !== null){
                        const c: Cell = [cellPos.col, cellPos.row]
                        shapeRef.current = { start: c, current: c }
                        draw()
                    }
                } else if(m === "fill"){
                    // Flood-fill the connected region under the click in one batch,
                    // bounded by the painted-content bbox + margin and a hard cap so
                    // an open empty region can never run forever (see model).
                    const cellPos = cellFromEvent(e.clientX, e.clientY)
                    if(cellPos !== null){
                        const map = mapRef.current
                        const start: Cell = [cellPos.col, cellPos.row]
                        const cells = boundedFloodFill(start, (col, row) => map.tileAt(col, row), map.fillClamp(start))
                        applyCells(cells)
                    }
                } else{
                    // Freehand: paint the cell under the pointer immediately, then
                    // each cell the drag passes over.
                    paintAt(e.clientX, e.clientY)
                }
            } else if(pointers.size === 2){
                // A second finger turns the drag into a pinch/pan gesture: abandon
                // any open shape preview, then commit whatever a freehand/fill
                // gesture already painted as its own step so the tap that preceded
                // the pinch is not lost.
                if(shapeRef.current !== null){
                    abandonGesture()
                } else{
                    painting = false
                    if(historyRef.current.commit(mapRef.current)) refreshHistoryFlags()
                }
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
                if(shapeRef.current !== null){
                    // Rect/line drag: update the current cell and re-render the
                    // preview overlay; the map is not mutated until pointer-up.
                    const cellPos = cellFromEvent(e.clientX, e.clientY)
                    if(cellPos !== null){
                        const cur = shapeRef.current.current
                        if(cur[0] !== cellPos.col || cur[1] !== cellPos.row){
                            shapeRef.current = { start: shapeRef.current.start, current: [cellPos.col, cellPos.row] }
                            draw()
                        }
                    }
                } else if(modeRef.current === "freehand"){
                    // Freehand drag paints each cell the pointer passes over. Fill
                    // is a single click applied on pointer-down, so a drag after it
                    // must NOT freehand-paint with the fill brush.
                    paintAt(e.clientX, e.clientY)
                }
            }
            e.preventDefault()
        }
        const onUp = (e: PointerEvent) => {
            const wasPainting = painting
            const openShape = shapeRef.current
            pointers.delete(e.pointerId)
            if(canvas.hasPointerCapture(e.pointerId)){
                canvas.releasePointerCapture(e.pointerId)
            }
            if(pointers.size < 2) gesture = null
            if(pointers.size === 0){
                painting = false
                lastCellRef.current = null
                if(wasPainting && openShape !== null){
                    // Close a rect/line gesture: compute the final cell set and
                    // apply the active brush to every cell in ONE batch, then commit
                    // the history step opened at pointer-down (a no-op shape commits
                    // nothing). A zero-length drag (tap) is a single cell.
                    shapeRef.current = null
                    const cells = modeRef.current === "rect"
                        ? rectCells(openShape.start, openShape.current)
                        : lineCells(openShape.start, openShape.current)
                    applyCells(cells)
                    if(historyRef.current.commit(mapRef.current)){
                        refreshHistoryFlags()
                    } else{
                        historyRef.current.cancel()
                    }
                } else if(wasPainting && historyRef.current.commit(mapRef.current)){
                    // Close a freehand/fill gesture: commit the single undo step (a
                    // no-op gesture commits nothing).
                    refreshHistoryFlags()
                } else{
                    historyRef.current.cancel()
                }
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
    }, [paintAt, applyCells, pickAt, cellFromEvent, applyZoom, applyPan, draw, refreshHistoryFlags])

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

    // Play this map: stash the current exported GridMapData to localStorage under
    // a stable key, then route home. The home lobby's MapSelect (host-only) reads
    // the stash and offers a button to load it into the live match. This is an
    // EXPLICIT handoff - it never auto-hosts and starts no match - so there is no
    // timing race: the host clicks again in the lobby to apply it.
    const onPlay = useCallback(() => {
        const data = mapRef.current.toGridMapData()
        const storage = editorStorage()
        if(storage !== null) stashPlayMap(data, storage)
        trackEvent("play_map")
        navigate("/")
    }, [navigate])

    // Import a previously exported map JSON back into the editor.
    const onImportFile = useCallback((file: File) => {
        const reader = new FileReader()
        reader.onload = () => {
            try{
                const data = parseGridMapData(String(reader.result))
                const map = EditorMap.fromGridMapData(data)
                mapRef.current = map
                setName(map.name)
                // A fresh map replaces the canvas wholesale, so the old history no
                // longer applies: reset it and refresh the button flags. The
                // imported content is the new baseline (not undoable back into the
                // previous map).
                historyRef.current.reset()
                refreshHistoryFlags()
                // Re-fit the viewport to the imported content.
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
    }, [bump, draw, markDirty, refreshHistoryFlags])

    // Clear every tile/spawn AND forget the autosaved draft, so this is a true
    // "start fresh" (a reload after Clear comes up blank, not the cleared map).
    // The clear is recorded as one undo step, so an accidental Clear can be undone
    // back to the pre-clear canvas (the autosave then re-persists it on the next
    // edit/restore), staying consistent with every other edit.
    const onClear = useCallback(() => {
        const history = historyRef.current
        history.begin(mapRef.current)
        mapRef.current.clear()
        if(history.commit(mapRef.current)) refreshHistoryFlags()
        const storage = editorStorage()
        if(storage !== null) clearEditorMap(storage)
        setDirty(false)
        bump()
        draw()
        setMessage("Cleared")
    }, [bump, draw, refreshHistoryFlags])

    // Reset the pan/zoom to fit the whole grid (geometry() refits when !ready).
    const fitNow = useCallback(() => {
        viewRef.current.ready = false
        draw()
    }, [draw])

    // Undo / redo the last paint GESTURE. Both round-trip the SPARSE model (so a
    // later export reflects the restored state), then integrate exactly like a
    // normal edit: keep the viewport (no refit), redraw, mark dirty so the leave
    // guard knows there is unsaved work, and let the debounced autosave persist
    // the restored draft (it fires off the `version` bump). The button
    // disabled-state flags are refreshed after each.
    const undo = useCallback(() => {
        if(historyRef.current.undo(mapRef.current) === false) return
        refreshHistoryFlags()
        markDirty()
        bump()
        draw()
    }, [bump, draw, markDirty, refreshHistoryFlags])

    const redo = useCallback(() => {
        if(historyRef.current.redo(mapRef.current) === false) return
        refreshHistoryFlags()
        markDirty()
        bump()
        draw()
    }, [bump, draw, markDirty, refreshHistoryFlags])

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
    // Ignored while typing in an input/textarea so the name field works, and
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
            // Undo / redo, Aseprite-style. Cmd/Ctrl+Z undoes; Cmd/Ctrl+Shift+Z and
            // Cmd/Ctrl+Y redo. preventDefault so the browser does not navigate
            // back or run its own undo. These sit BEFORE the modifier guard below
            // so they are not swallowed by it, and after the input guard above so
            // typing in the name field keeps the browser's native text undo.
            if(e.metaKey || e.ctrlKey){
                const lower = e.key.toLowerCase()
                if(lower === "z"){
                    e.preventDefault()
                    if(e.shiftKey){
                        redo()
                    } else{
                        undo()
                    }
                    return
                }
                if(lower === "y"){
                    e.preventDefault()
                    redo()
                    return
                }
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
    }, [confirmLeave, onExport, fitNow, undo, redo])

    // The active material's face colour as a CSS hex, derived from the shared
    // TILE_BLOCK_STYLES so the rail's block/slope icons (and the material picker
    // swatches) read as the EXACT in-game colour the author is about to paint.
    const materialFace = blockFaceCss(material)

    // The rail-icon colour for a tool: block + slope tools (auto and the four
    // explicit directions) show the ACTIVE material colour so the rail mirrors what
    // a stroke will paint; deco/spawn/erase keep their fixed affordance colours.
    const toolIconColor = useCallback((brushFor: EditorBrush, fallback: string): string => {
        if(brushFor === "full" || brushFor === "auto" || SLOPE_BRUSHES.indexOf(brushFor) !== -1){
            return materialFace
        }
        return fallback
    }, [materialFace])

    const spawnCount = mapRef.current.spawns.length
    // The size the map would EXPORT at: the bounding box of everything painted.
    // Recomputed off `version` (which bumps on every model mutation) so the
    // status readout always reflects the live extent on an unbounded canvas.
    const exportSize = useMemo(() => {
        const box = mapRef.current.bounds()
        return {
            cols: box.empty ? 0 : box.maxCol - box.minCol + 1,
            rows: box.empty ? 0 : box.maxRow - box.minRow + 1,
        }
        // The model is a ref, so `version` (bumped on every mutation) is the only
        // meaningful dependency.
    }, [version])

    return (
        <div className={styles.root}>
            <canvas ref={canvasRef} className={styles.canvas} />

            {/* Mode strip: HOW to paint (freehand / rect / line / fill) plus the
                eyedropper (pick), orthogonal to the brush rail below (WHAT to
                paint). Click-only, each a 46px tap target with a portal tooltip and
                a clear active state. Pick is the MOBILE-first eyedropper (no Alt key
                on a phone): a single tap reads the cell's brush, then auto-returns
                to freehand so the author paints with the picked brush right away. */}
            <div className={styles.leftRail}>
                <div className={styles.railSection} role="toolbar" aria-label="Draw modes">
                    {MODE_DEFS.map((m) => (
                        <Tooltip key={m.mode} label={m.label} placement="right">
                            <button
                                type="button"
                                className={`${styles.tool} ${mode === m.mode ? styles.toolActive : ""}`}
                                onClick={() => setMode(m.mode)}
                                aria-pressed={mode === m.mode}
                                aria-label={m.label}
                                title={m.label}
                            >
                                <span className={styles.toolIcon}>
                                    <ModeIcon mode={m.mode} />
                                </span>
                            </button>
                        </Tooltip>
                    ))}
                </div>

                <div className={styles.railDivider} />

                {/* Tool rail: compact vertical toolbar of brush tools, Aseprite-style. */}
                <div className={styles.railSection} role="toolbar" aria-label="Brush tools">
                    {TOOLS.map((tool) => {
                        if(tool.brush === "auto"){
                        // Auto slope: the active state covers the auto brush AND any
                        // explicit direction (they live in its dropdown). The rail
                        // icon mirrors whichever is selected.
                            const slopeActive = brush === "auto" || SLOPE_BRUSHES.indexOf(brush) !== -1
                            const iconBrush: EditorBrush = SLOPE_BRUSHES.indexOf(brush) !== -1 ? brush : "auto"
                            return (
                                <div key="auto" className={styles.toolGroup}>
                                    <Tooltip label={tool.label} shortcut={tool.shortcut} placement="right">
                                        <button
                                            type="button"
                                            className={`${styles.tool} ${slopeActive ? styles.toolActive : ""}`}
                                            onClick={() => setBrush("auto")}
                                            aria-pressed={slopeActive}
                                            aria-label={`${tool.label} (${tool.shortcut})`}
                                            title={`${tool.label} (${tool.shortcut})`}
                                        >
                                            <span className={styles.toolIcon}>
                                                <ToolIcon brush={iconBrush} color={toolIconColor(iconBrush, tool.color)} />
                                            </span>
                                            <span className={styles.toolKey}>{tool.shortcut}</span>
                                        </button>
                                    </Tooltip>
                                    <Tooltip label="Slope directions" placement="right">
                                        <button
                                            type="button"
                                            className={styles.toolCaret}
                                            onClick={() => setSlopeOpen((o) => !o)}
                                            aria-label="Slope directions"
                                            aria-expanded={slopeOpen}
                                            title="Slope directions"
                                        >&#9656;</button>
                                    </Tooltip>
                                    {slopeOpen && (
                                        <div className={styles.slopeFlyout} role="menu">
                                            {SLOPE_TOOLS.map((s) => (
                                                <Tooltip key={s.brush} label={s.label} shortcut={s.shortcut} placement="right">
                                                    <button
                                                        type="button"
                                                        className={`${styles.slopeItem} ${brush === s.brush ? styles.slopeItemActive : ""}`}
                                                        onClick={() => { setBrush(s.brush); setSlopeOpen(false) }}
                                                        aria-pressed={brush === s.brush}
                                                        aria-label={`${s.label} (${s.shortcut})`}
                                                        title={`${s.label} (${s.shortcut})`}
                                                    >
                                                        <span className={styles.toolIcon}>
                                                            <ToolIcon brush={s.brush} color={toolIconColor(s.brush, s.color)} />
                                                        </span>
                                                        <span className={styles.slopeItemLabel}>{s.label}</span>
                                                        <span className={styles.toolKey}>{s.shortcut}</span>
                                                    </button>
                                                </Tooltip>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )
                        }
                        return (
                            <Tooltip key={tool.brush} label={tool.label} shortcut={tool.shortcut} placement="right">
                                <button
                                    type="button"
                                    className={`${styles.tool} ${brush === tool.brush ? styles.toolActive : ""}`}
                                    onClick={() => setBrush(tool.brush)}
                                    aria-pressed={brush === tool.brush}
                                    aria-label={`${tool.label} (${tool.shortcut})`}
                                    title={`${tool.label} (${tool.shortcut})`}
                                >
                                    <span className={styles.toolIcon}>
                                        <ToolIcon brush={tool.brush} color={toolIconColor(tool.brush, tool.color)} />
                                    </span>
                                    <span className={styles.toolKey}>{tool.shortcut}</span>
                                </button>
                            </Tooltip>
                        )
                    })}
                </div>
            </div>

            {/* Material (colour) picker: a strip of >= 44px swatches showing each
                colourable material's FACE colour (the same hue the in-game block
                renders), docked to the RIGHT edge so it never overlaps the left
                rails, the top bar, or the bottom status bar (verified at 393px
                width). The active swatch is highlighted; each carries a portal
                Tooltip naming the colour. Picking a swatch sets the active material,
                which the block brush + every slope (explicit + auto) paint with;
                deco stays non-colliding decoration and ignores it. */}
            <div className={styles.materialRail} role="toolbar" aria-label="Block colours">
                {EDITOR_MATERIALS.map((m) => (
                    <Tooltip key={m.key} label={m.label} placement="left">
                        <button
                            type="button"
                            className={`${styles.swatch} ${material === m.key ? styles.swatchActive : ""}`}
                            onClick={() => setMaterial(m.key)}
                            aria-pressed={material === m.key}
                            aria-label={`${m.label} block colour`}
                            title={`${m.label} block colour`}
                        >
                            <span className={styles.swatchChip} style={{ backgroundColor: blockFaceCss(m.key) }} />
                        </button>
                    </Tooltip>
                ))}
            </div>

            {/* Top bar: title, Undo/Redo, Options, and Back. Floats over the
                canvas. Undo/Redo are first so they sit nearest the brand and are
                an easy thumb reach on a phone (there is no Ctrl+Z on touch). */}
            <div className={styles.topBar}>
                <div className={styles.brand}>Map Maker</div>
                <div className={styles.topActions}>
                    <Tooltip label="Undo" shortcut={UNDO_SHORTCUT} placement="bottom-left">
                        <button
                            type="button"
                            className={styles.iconButton}
                            onClick={undo}
                            disabled={canUndo === false}
                            aria-label={`Undo (${UNDO_SHORTCUT})`}
                            aria-keyshortcuts="Control+Z Meta+Z"
                            title={`Undo (${UNDO_SHORTCUT})`}
                        >
                            <UndoIcon />
                        </button>
                    </Tooltip>
                    <Tooltip label="Redo" shortcut={REDO_SHORTCUT} placement="bottom-left">
                        <button
                            type="button"
                            className={styles.iconButton}
                            onClick={redo}
                            disabled={canRedo === false}
                            aria-label={`Redo (${REDO_SHORTCUT})`}
                            aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y"
                            title={`Redo (${REDO_SHORTCUT})`}
                        >
                            <RedoIcon />
                        </button>
                    </Tooltip>
                    <Tooltip label="Map options" shortcut="O" placement="bottom-left">
                        <button
                            type="button"
                            className={`${styles.iconButton} ${optionsOpen ? styles.iconButtonActive : ""}`}
                            onClick={() => setOptionsOpen((v) => v === false)}
                            aria-label="Map options (O)"
                            aria-expanded={optionsOpen}
                            title="Map options (O)"
                        >
                            <GearIcon />
                        </button>
                    </Tooltip>
                    <Tooltip label="Back" placement="bottom-left">
                        <button
                            type="button"
                            className={styles.iconButton}
                            onClick={onBack}
                            aria-label="Back to home"
                            title="Back"
                        >
                            <BackIcon />
                        </button>
                    </Tooltip>
                </div>
            </div>

            {/* A compact status readout pinned to the bottom: spawn count + the
                exported size (the bounding box of everything painted, computed
                live) + last message. */}
            <div className={styles.statusBar}>
                <span className={spawnCount === 0 ? styles.statusWarn : styles.statusGood}>
                    {spawnCount} spawn{spawnCount === 1 ? "" : "s"}
                </span>
                <span className={styles.statusDim}>
                    {exportSize.cols} x {exportSize.rows}
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

                        <div className={styles.hint}>
                            The canvas is unbounded. Paint anywhere; the exported size is the
                            bounding box of everything you paint ({exportSize.cols} x {exportSize.rows}).
                        </div>

                        <label className={styles.toggle}>
                            <input
                                type="checkbox"
                                checked={showCollision}
                                onChange={(e) => setShowCollision(e.target.checked)}
                            />
                            <span>Show collision</span>
                        </label>

                        <div className={styles.actions}>
                            <GameButton onClick={onPlay}>Play this map</GameButton>
                            <GameButton accent onClick={onExport}>Download JSON</GameButton>
                            <GameButton accent onClick={() => fileInputRef.current?.click()}>Import</GameButton>
                            <GameButton accent onClick={fitNow}>Fit view</GameButton>
                            <GameButton accent onClick={onClear}>Clear</GameButton>
                        </div>
                        <div className={styles.hint}>
                            Pick a draw mode (freehand, rectangle, line, fill) on the left, then a brush.
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

// Restore the autosaved draft on mount, or fall back to a fresh blank map. The
// canvas is unbounded, so a fresh map starts empty (no fixed size) and the
// author paints anywhere. Kept out of the component body so the initial
// useRef/useState reads stay a single synchronous call.
function restoreInitialMap(): EditorMap{
    const storage = editorStorage()
    if(storage !== null){
        const restored = loadEditorMap(storage)
        if(restored !== null) return restored
    }
    return new EditorMap(DEFAULT_MAP_NAME)
}

// Where a tooltip bubble sits relative to its trigger. "right" hangs it to the
// right of the element (rail tools); "left" hangs it to the left (the right-docked
// material picker, whose right-hung bubble would run off-screen); "bottom-left"
// drops it below and aligns its right edge to the trigger's right edge (top-bar
// buttons near the screen edge).
type TooltipPlacement = "right" | "left" | "bottom-left"

// A UNIVERSAL tooltip. It wraps a single trigger element and renders its bubble
// through a PORTAL to document.body, so the bubble is NEVER clipped by an
// ancestor's overflow/scroll (the old data-tip lived inside the rail's scroll
// container and was cut off). It shows the label plus an optional keyboard
// shortcut, appears on hover OR keyboard focus, and degrades gracefully on
// touch: touch devices fire no hover, so the bubble simply never shows and the
// trigger's own title=/aria-label keep the shortcut discoverable. Positioned
// imperatively off the trigger's measured rect each time it opens.
//
// Show the focus-driven tooltip ONLY for keyboard focus, never the residual
// focus a tap leaves on a button: on touch, tapping a tool focuses it, and an
// ungated onFocus would flash the bubble until blur. :focus-visible matches
// keyboard focus but not pointer/touch focus, so it is the right gate.
function isKeyboardFocus(target: EventTarget | null): boolean{
    if(target === null || !(target instanceof Element)) return false
    try{
        return target.matches(":focus-visible")
    } catch{
        // Engines without :focus-visible: stay hover-only so it never flashes on touch.
        return false
    }
}

// The bubble's transform class for a placement: right-hung centres vertically;
// left-hung centres vertically AND shifts fully left of its anchor; bottom-left
// shifts fully left so it tucks under a top-bar button near the screen edge.
function tooltipPlacementClass(placement: TooltipPlacement): string{
    if(placement === "bottom-left") return styles.tooltipBottomLeft
    if(placement === "left") return styles.tooltipLeft
    return styles.tooltipRight
}

function Tooltip({ label, shortcut, placement = "right", children }: {
    label: string,
    shortcut?: string,
    placement?: TooltipPlacement,
    children: ReactNode,
}){
    const wrapRef = useRef<HTMLSpanElement | null>(null)
    const [open, setOpen] = useState(false)
    const [pos, setPos] = useState<{ left: number, top: number }>({ left: 0, top: 0 })

    // Measure the trigger and place the bubble next to it, in viewport (fixed)
    // coordinates so the portal layer (fixed, inset 0) lines up exactly.
    const show = useCallback(() => {
        const wrap = wrapRef.current
        if(wrap === null) return
        const rect = wrap.getBoundingClientRect()
        if(placement === "bottom-left"){
            setPos({ left: rect.right, top: rect.bottom + 6 })
        } else if(placement === "left"){
            // Hang the bubble to the LEFT of the trigger (toward the canvas), so a
            // right-docked swatch's tooltip never runs off the right screen edge.
            setPos({ left: rect.left - 8, top: rect.top + rect.height / 2 })
        } else{
            setPos({ left: rect.right + 8, top: rect.top + rect.height / 2 })
        }
        setOpen(true)
    }, [placement])

    const hide = useCallback(() => setOpen(false), [])

    return (
        <span
            ref={wrapRef}
            className={styles.tooltipWrap}
            onPointerEnter={(e) => { if(e.pointerType !== "touch") show() }}
            onPointerLeave={hide}
            onFocus={(e) => { if(isKeyboardFocus(e.target)) show() }}
            onBlur={hide}
        >
            {children}
            {open && createPortal(
                <div
                    className={`${styles.tooltip} ${tooltipPlacementClass(placement)}`}
                    style={{ left: pos.left, top: pos.top }}
                    role="tooltip"
                >
                    <span>{label}</span>
                    {typeof shortcut === "string" && shortcut.length > 0 && (
                        <span className={styles.tooltipKey}>{shortcut}</span>
                    )}
                </div>,
                document.body,
            )}
        </span>
    )
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
// box so it reads as non-colliding decoration. `faceColor` is the tile's MATERIAL
// face colour (a CSS "#rrggbb" derived from the same TILE_BLOCK_STYLES the in-game
// Pixi renderer uses), so the editor preview matches what the author will see in
// a match. Deco is non-colliding decoration and ignores the material, painting a
// fixed faded box so it always reads as deco.
function drawTile(ctx: CanvasRenderingContext2D, shape: string, faceColor: string, x: number, y: number, size: number){
    if(shape === "deco"){
        ctx.fillStyle = COLOR_DECO
        ctx.fillRect(x, y, size, size)
        return
    }
    if(shape === "full"){
        ctx.fillStyle = faceColor
        ctx.fillRect(x, y, size, size)
        return
    }
    // Diagonals: fill the triangle whose right angle sits in the named corner.
    ctx.fillStyle = faceColor
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

// A small SVG glyph for each draw mode so the mode strip reads at a glance: a
// pencil for freehand, a hollow square for rectangle, a slash for line, and a
// paint-bucket-ish wedge for fill. Tinted with the accent so they read as
// "how to paint" controls distinct from the coloured brush swatches.
function ModeIcon({ mode }: { mode: EditorMode }){
    const size = 22
    const stroke = COLOR_MODE_ICON
    if(mode === "pick"){
        // An eyedropper: a slanted dropper with a bulb, signalling "pick the cell".
        return (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 19l8-8" />
                <path d="M13 5l6 6-2 2-6-6 2-2z" />
                <path d="M4 20l3-1 1-3-3 3z" fill={stroke} stroke="none" />
            </svg>
        )
    }
    if(mode === "freehand"){
        // A pencil drawing a freehand squiggle.
        return (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 18c2-4 4 2 6-1s2-6 4-7" />
                <path d="M14 4l6 6-9 9-6 1 1-6 8-10z" opacity="0.45" />
            </svg>
        )
    }
    if(mode === "rect"){
        return (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinejoin="round">
                <rect x="4" y="5" width="16" height="14" />
            </svg>
        )
    }
    if(mode === "line"){
        return (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round">
                <path d="M5 19L19 5" />
                <circle cx="5" cy="19" r="1.6" fill={stroke} stroke="none" />
                <circle cx="19" cy="5" r="1.6" fill={stroke} stroke="none" />
            </svg>
        )
    }
    // Fill: a tipped paint bucket pouring.
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 11l6-6 7 7-6 6a2 2 0 0 1-3 0l-4-4a2 2 0 0 1 0-3z" />
            <path d="M19 16c1.2 1.6 1.2 3 0 4" />
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

// A counter-clockwise arrow for Undo: a curved arc with an arrowhead pointing
// back to the start.
function UndoIcon(){
    return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 14L4 9l5-5" />
            <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
        </svg>
    )
}

// A clockwise arrow for Redo: the Undo glyph mirrored.
function RedoIcon(){
    return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 14l5-5-5-5" />
            <path d="M20 9H10a6 6 0 0 0 0 12h3" />
        </svg>
    )
}
