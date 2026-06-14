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
    HALF_BRUSHES,
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
    editorMapIssue,
    mirrorMap,
    MirrorAxis,
    CellRect,
    EditorClip,
    normalizeRect,
    extractClip,
    clearRegion,
    stampClip,
    rotateClipCW,
    flipClip,
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
// Dashed outline around the painted bounding box = the exact region that exports,
// so the author can see their map's edges on the otherwise-unbounded canvas.
const COLOR_BOUNDS = "rgba(230, 174, 16, 0.45)"
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
    // Half tiles are flyout-only: no clean non-clashing single key remains, so
    // they carry no keyboard shortcut (empty string -> the tooltip shows none).
    half_top: "",
    half_bottom: "",
    half_left: "",
    half_right: "",
}

type ToolDef = { brush: EditorBrush, label: string, color: string, shortcut: string }

// Human label per brush (the four slope directions show in the Auto-slope
// dropdown; the four half directions show in the Half tool's flyout). Pulled
// from the shared palette where possible.
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
    half_top: "Half Top",
    half_bottom: "Half Bottom",
    half_left: "Half Left",
    half_right: "Half Right",
}

// The rail tools, top to bottom. The four explicit slopes are NOT here: they are
// tucked into a dropdown under the Auto slope tool, which picks the direction
// from neighbours automatically.
const TOOLS: ToolDef[] = [
    { brush: "empty", label: LABEL_FOR.empty, color: COLOR_GRID_STRONG, shortcut: SHORTCUT_FOR.empty },
    { brush: "full", label: LABEL_FOR.full, color: COLOR_BLOCK, shortcut: SHORTCUT_FOR.full },
    { brush: "auto", label: LABEL_FOR.auto, color: COLOR_SLOPE, shortcut: SHORTCUT_FOR.auto },
    { brush: "half_top", label: "Half", color: COLOR_BLOCK, shortcut: SHORTCUT_FOR.half_top },
    { brush: "deco", label: LABEL_FOR.deco, color: COLOR_DECO, shortcut: SHORTCUT_FOR.deco },
    { brush: "spawn", label: LABEL_FOR.spawn, color: COLOR_SPAWN, shortcut: SHORTCUT_FOR.spawn },
]

// The explicit slope directions shown in the Auto slope dropdown.
const SLOPE_TOOLS: ToolDef[] = SLOPE_BRUSHES.map((b) => ({
    brush: b, label: LABEL_FOR[b], color: COLOR_SLOPE, shortcut: SHORTCUT_FOR[b],
}))

// The explicit half-tile directions shown in the Half tool's direction flyout
// (mirroring SLOPE_TOOLS under Auto slope). Half tiles are solid colliding
// boxes, so they take the active material colour like blocks/slopes.
const HALF_TOOLS: ToolDef[] = HALF_BRUSHES.map((b) => ({
    brush: b, label: LABEL_FOR[b], color: COLOR_BLOCK, shortcut: SHORTCUT_FOR[b],
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
// (Aseprite-like). "select" is the SELECTION / TRANSFORM tool: a one-finger drag
// marquees a rectangular region, which then becomes the active selection the
// action toolbar moves / copies / cuts / pastes / rotates / flips / deletes.
// Neither pick nor select is a DrawMode (they never paint a cell SET), so the
// pure model's DrawMode stays exactly the paint modes; EditorMode is DrawMode
// widened by "pick" and "select".
type EditorMode = DrawMode | "pick" | "select"
type ModeDef = { mode: EditorMode, label: string }
const MODE_DEFS: ModeDef[] = [
    { mode: "freehand", label: "Freehand" },
    { mode: "rect", label: "Rectangle" },
    { mode: "line", label: "Line" },
    { mode: "fill", label: "Fill" },
    { mode: "pick", label: "Pick (eyedropper)" },
    { mode: "select", label: "Select (marquee)" },
]

// The SELECTION marquee / active-selection outline colour: a bright cyan dashed
// rectangle, deliberately DISTINCT from the amber export-bounds outline so the
// author never confuses "the region I selected" with "the region that exports".
const COLOR_SELECTION = "rgba(80, 220, 255, 0.95)"
// The translucent tint a FLOATING CLIP's tiles render at while it follows a drag
// (or sits floating after a paste / move), so it reads as "lifted, not yet
// stamped" content hovering over the map.
const CLIP_OVERLAY_ALPHA = 0.66

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
    const [halfOpen, setHalfOpen] = useState(false)
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

    // SELECTION / TRANSFORM state. The active SELECTION is an inclusive cell rect
    // (null = nothing selected); a FLOATING CLIP is content lifted off the map (by
    // a move, a paste, or a rotate/flip of the selected region) that renders as a
    // translucent overlay and STAMPS into the map on commit. The CLIPBOARD holds a
    // copy/cut clip for paste. All three are mirrored into refs so the imperative
    // pointer handlers + draw() read the live values without re-binding; React
    // state drives the action toolbar's visibility + the Paste disabled flag.
    const [selection, setSelection] = useState<CellRect | null>(null)
    const selectionRef = useRef<CellRect | null>(selection)
    selectionRef.current = selection
    // The floating clip and the cell its top-left currently sits at. Kept in
    // refs (mutated by the move drag without a re-render per frame) AND mirrored
    // into state so the toolbar re-renders when a clip appears/clears.
    const [hasFloating, setHasFloating] = useState(false)
    const clipRef = useRef<EditorClip | null>(null)
    const clipPosRef = useRef<{ col: number, row: number }>({ col: 0, row: 0 })
    // The copy/cut clipboard (a detached clip). State so the toolbar can disable
    // Paste when empty; the ref is read by the imperative paste action.
    const [clipboardEmpty, setClipboardEmpty] = useState(true)
    const clipboardRef = useRef<EditorClip | null>(null)
    // The in-progress marquee drag for select mode: the down cell + the current
    // cell. Held in a ref so the high-rate drag updates the dashed preview without
    // a React re-render per move. null when no marquee is open.
    const marqueeRef = useRef<{ start: Cell, current: Cell } | null>(null)
    // Whether the floating clip already has an OPEN history step (a move/transform
    // LIFT clears the source region under one open step, committed only when the
    // clip is stamped, so the whole lift -> stamp is ONE undo step). A PASTE leaves
    // this false, so commitFloatingClip opens its own step around the stamp.
    const floatingHistoryOpenRef = useRef(false)

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

        // Export-bounds outline: a dashed rectangle around the painted bounding box
        // so the author sees EXACTLY what will export on the unbounded canvas (the
        // status bar shows the size as a number; this shows WHERE the edges are).
        const exportBox = map.bounds()
        if(exportBox.empty === false){
            const bx = ox + exportBox.minCol * cell
            const by = oy + exportBox.minRow * cell
            const bw = (exportBox.maxCol - exportBox.minCol + 1) * cell
            const bh = (exportBox.maxRow - exportBox.minRow + 1) * cell
            ctx.save()
            ctx.strokeStyle = COLOR_BOUNDS
            ctx.lineWidth = 1.5
            ctx.setLineDash([6, 4])
            ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh)
            ctx.restore()
        }

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

        // FLOATING CLIP overlay: a lifted clip (mid-move, pasted, or rotated/
        // flipped) renders its tiles translucent at its current cell offset so the
        // author sees the content hovering before it stamps. Culled to the visible
        // window like the painted tiles, so a big clip stays O(viewport).
        const clip = clipRef.current
        if(clip !== null){
            const at = clipPosRef.current
            ctx.save()
            ctx.globalAlpha = CLIP_OVERLAY_ALPHA
            for(const tile of clip.tiles){
                const col = at.col + tile.col
                const row = at.row + tile.row
                if(col < startCol || col >= endCol || row < startRow || row >= endRow) continue
                drawTile(ctx, tile.shape, blockFaceCss(tile.key), ox + col * cell, oy + row * cell, cell)
            }
            ctx.restore()
            // Clip spawns: draw the same green ring as a placed spawn so a clip with
            // spawn markers reads correctly while floating.
            ctx.save()
            ctx.globalAlpha = CLIP_OVERLAY_ALPHA
            ctx.strokeStyle = COLOR_SPAWN
            ctx.fillStyle = "rgba(51, 221, 85, 0.25)"
            ctx.lineWidth = 2
            for(const [c, r] of clip.spawns){
                const col = at.col + c
                const row = at.row + r
                if(col < startCol || col >= endCol || row < startRow || row >= endRow) continue
                const cx = ox + col * cell + cell / 2
                const cy = oy + row * cell + cell / 2
                const rr = Math.max(3, cell * 0.32)
                ctx.beginPath()
                ctx.arc(cx, cy, rr, 0, Math.PI * 2)
                ctx.fill()
                ctx.stroke()
            }
            ctx.restore()
        }

        // SELECTION rectangle: the live marquee while dragging, otherwise the
        // active selection (or, when a clip is floating, the clip's current
        // footprint). A bright cyan dashed outline, distinct from the amber
        // export-bounds outline, so "selected region" never reads as "exports".
        const marquee = marqueeRef.current
        let selRect: CellRect | null = null
        if(modeRef.current === "select" && marquee !== null){
            selRect = normalizeRect(marquee.start, marquee.current)
        } else if(clip !== null){
            const at = clipPosRef.current
            selRect = { minCol: at.col, minRow: at.row, maxCol: at.col + clip.cols - 1, maxRow: at.row + clip.rows - 1 }
        } else if(selectionRef.current !== null){
            selRect = selectionRef.current
        }
        if(selRect !== null){
            const sx = ox + selRect.minCol * cell
            const sy = oy + selRect.minRow * cell
            const sw = (selRect.maxCol - selRect.minCol + 1) * cell
            const sh = (selRect.maxRow - selRect.minRow + 1) * cell
            ctx.save()
            ctx.strokeStyle = COLOR_SELECTION
            ctx.lineWidth = 2
            ctx.setLineDash([5, 3])
            ctx.strokeRect(sx + 0.5, sy + 0.5, sw, sh)
            ctx.restore()
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
        // Interpolate from the LAST painted cell to this one so a fast drag paints a
        // CONTINUOUS stroke (no gaps), like a pencil: pointermove fires at discrete
        // positions, so without this a quick flick would dot only the cells it
        // happened to land on. lineCells is 8-connected and includes both ends; drop
        // the leading cell (it equals `last`, already painted) so a spawn toggle does
        // not re-fire on it. The first paint of a gesture (last === null) is one cell.
        const cells: Cell[] = last === null
            ? [[cellPos.col, cellPos.row]]
            : lineCells([last.col, last.row], [cellPos.col, cellPos.row]).slice(1)
        lastCellRef.current = cellPos
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

    // SELECTION / TRANSFORM actions. Each MAP MUTATION commits as ONE undo step:
    // a move/transform LIFT opens a history step (clearing the source) that the
    // matching STAMP closes, so lift -> drag/rotate/flip -> stamp is a single step;
    // a paste opens + closes its own step around the stamp; copy mutates nothing
    // (no step); cut and delete each commit one step.

    // STAMP any floating clip back into the map and clear the floating state. If a
    // history step is already open (from a move/transform lift) it is committed
    // here; otherwise (a paste) one is opened around the stamp. A no-op stamp
    // commits nothing. Returns true if the map changed. Always clears the floating
    // clip + selection so the caller lands in a clean state.
    const commitFloatingClip = useCallback(() => {
        const clip = clipRef.current
        if(clip === null) return false
        const at = clipPosRef.current
        const history = historyRef.current
        const alreadyOpen = floatingHistoryOpenRef.current
        if(alreadyOpen === false) history.begin(mapRef.current)
        const changed = stampClip(mapRef.current, clip, at.col, at.row)
        clipRef.current = null
        floatingHistoryOpenRef.current = false
        setHasFloating(false)
        if(history.commit(mapRef.current)){
            refreshHistoryFlags()
            markDirty()
        }
        if(changed){
            bump()
            draw()
        }
        return changed
    }, [bump, draw, markDirty, refreshHistoryFlags])

    // LIFT the active selection into a floating clip: open ONE history step,
    // extract the region's content into a clip, CLEAR the source region, and place
    // the clip back at the selection's top-left so it visually stays put. Used by
    // a move drag and by rotate/flip when nothing is floating yet. Returns the clip
    // (or null when there is no selection / nothing to lift). The open step is
    // closed later by commitFloatingClip when the clip is stamped.
    const liftSelectionToClip = useCallback((): EditorClip | null => {
        const sel = selectionRef.current
        if(sel === null) return null
        const clip = extractClip(mapRef.current, sel)
        historyRef.current.begin(mapRef.current)
        const cleared = clearRegion(mapRef.current, sel)
        floatingHistoryOpenRef.current = true
        clipRef.current = clip
        clipPosRef.current = { col: sel.minCol, row: sel.minRow }
        setHasFloating(true)
        if(cleared){
            markDirty()
            bump()
        }
        draw()
        return clip
    }, [bump, draw, markDirty])

    // COPY: snapshot the selected region (or the floating clip, if one is up) into
    // the clipboard. No map change, so no undo step.
    const onCopy = useCallback(() => {
        let clip: EditorClip | null = clipRef.current
        if(clip === null){
            const sel = selectionRef.current
            if(sel === null) return
            clip = extractClip(mapRef.current, sel)
        }
        clipboardRef.current = clip
        setClipboardEmpty(false)
        setMessage("Copied selection")
    }, [])

    // CUT: copy the selected region to the clipboard, then CLEAR it as ONE undo
    // step. The selection stays (now an empty source) so the author can paste
    // elsewhere or re-select. A floating clip is copied + dropped (the lift already
    // cleared its source under an open step, which is cancelled here).
    const onCut = useCallback(() => {
        const floating = clipRef.current
        if(floating !== null){
            // The clip is already lifted (source cleared under an open step): copy
            // it to the clipboard and drop the float, keeping the source-clear as
            // the committed edit so cut = "remove + clipboard".
            clipboardRef.current = floating
            setClipboardEmpty(false)
            const history = historyRef.current
            clipRef.current = null
            floatingHistoryOpenRef.current = false
            setHasFloating(false)
            if(history.commit(mapRef.current)){
                refreshHistoryFlags()
                markDirty()
            }
            bump()
            draw()
            setMessage("Cut selection")
            return
        }
        const sel = selectionRef.current
        if(sel === null) return
        clipboardRef.current = extractClip(mapRef.current, sel)
        setClipboardEmpty(false)
        const history = historyRef.current
        history.begin(mapRef.current)
        const changed = clearRegion(mapRef.current, sel)
        if(changed && history.commit(mapRef.current)){
            refreshHistoryFlags()
            markDirty()
            bump()
            draw()
        } else{
            history.cancel()
        }
        setMessage("Cut selection")
    }, [bump, draw, markDirty, refreshHistoryFlags])

    // PASTE: create a floating clip from the clipboard, placed at the current
    // selection's top-left (or, with no selection, the centre cell of the
    // viewport). Any clip already floating is stamped first so paste never silently
    // drops in-flight content. The new float stamps on commit (one undo step).
    const onPaste = useCallback(() => {
        const source = clipboardRef.current
        if(source === null) return
        commitFloatingClip()
        const sel = selectionRef.current
        let at: { col: number, row: number }
        if(sel !== null){
            at = { col: sel.minCol, row: sel.minRow }
        } else{
            // Centre of the viewport, in cells, so a paste with nothing selected
            // lands where the author is looking.
            const { w, h } = canvasSize()
            const c = cellFromEvent(w / 2, h / 2)
            at = c !== null ? { col: c.col, row: c.row } : { col: 0, row: 0 }
        }
        clipRef.current = source
        clipPosRef.current = at
        floatingHistoryOpenRef.current = false
        setHasFloating(true)
        // Select the pasted footprint so the toolbar + outline track the new clip.
        setSelection({ minCol: at.col, minRow: at.row, maxCol: at.col + source.cols - 1, maxRow: at.row + source.rows - 1 })
        draw()
        setMessage("Pasted clip")
    }, [canvasSize, cellFromEvent, commitFloatingClip, draw])

    // ROTATE the floating clip 90 degrees clockwise (lifting the selection into one
    // first when nothing is floating yet). The clip stays floating and re-renders;
    // it stamps on commit. The selection footprint follows the new (swapped) dims.
    const onRotate = useCallback(() => {
        let clip = clipRef.current
        if(clip === null){
            clip = liftSelectionToClip()
            if(clip === null) return
        }
        const rotated = rotateClipCW(clip)
        clipRef.current = rotated
        const at = clipPosRef.current
        setSelection({ minCol: at.col, minRow: at.row, maxCol: at.col + rotated.cols - 1, maxRow: at.row + rotated.rows - 1 })
        draw()
        setMessage("Rotated 90 degrees")
    }, [draw, liftSelectionToClip])

    // FLIP the floating clip across the given axis (lifting the selection into one
    // first when nothing is floating yet). Dims are unchanged, so the footprint
    // stays; the clip stamps on commit.
    const onFlip = useCallback((axis: MirrorAxis) => {
        let clip = clipRef.current
        if(clip === null){
            clip = liftSelectionToClip()
            if(clip === null) return
        }
        clipRef.current = flipClip(clip, axis)
        draw()
        setMessage(axis === "horizontal" ? "Flipped horizontally" : "Flipped vertically")
    }, [draw, liftSelectionToClip])

    // DELETE the selection's content as ONE undo step, then clear the selection. A
    // floating clip is simply discarded (its lift already cleared the source under
    // an open step, which is committed here so the content stays removed).
    const onDeleteSelection = useCallback(() => {
        const floating = clipRef.current
        if(floating !== null){
            const history = historyRef.current
            clipRef.current = null
            floatingHistoryOpenRef.current = false
            setHasFloating(false)
            if(history.commit(mapRef.current)){
                refreshHistoryFlags()
                markDirty()
            }
            setSelection(null)
            bump()
            draw()
            setMessage("Deleted selection")
            return
        }
        const sel = selectionRef.current
        if(sel === null) return
        const history = historyRef.current
        history.begin(mapRef.current)
        const changed = clearRegion(mapRef.current, sel)
        if(changed && history.commit(mapRef.current)){
            refreshHistoryFlags()
            markDirty()
            bump()
            draw()
        } else{
            history.cancel()
        }
        setSelection(null)
        setMessage("Deleted selection")
    }, [bump, draw, markDirty, refreshHistoryFlags])

    // DESELECT / COMMIT: stamp any floating clip back into the map (one undo step)
    // and clear the selection, landing in a clean canvas state. Also called when
    // switching away from select mode so a floating clip is never silently lost.
    const onDeselect = useCallback(() => {
        commitFloatingClip()
        marqueeRef.current = null
        setSelection(null)
        draw()
    }, [commitFloatingClip, draw])

    // Leaving SELECT mode COMMITS the selection: stamp any floating clip into the
    // map (one undo step) and clear the selection, so switching to another tool
    // never strands lifted content or leaves a dangling marquee. Runs only on the
    // transition INTO a non-select mode (the dep is `mode`).
    useEffect(() => {
        if(mode === "select") return
        if(clipRef.current === null && selectionRef.current === null && marqueeRef.current === null) return
        commitFloatingClip()
        marqueeRef.current = null
        setSelection(null)
        draw()
    }, [mode, commitFloatingClip, draw])

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
        // Deferred-paint state for the active single-pointer gesture. A TAP paints
        // on pointer-UP (not down), and a freehand DRAG only starts once the pointer
        // leaves its start cell. So the first finger of a pinch never drops a
        // tile/spawn/fill: when a second finger lands, a gesture that has not drawn
        // anything yet is cancelled (drewThisGesture stays false).
        let gestureMode: "freehand" | "fill" | null = null
        let downX = 0
        let downY = 0
        let drewThisGesture = false
        // SELECT mode sub-gesture: "marquee" draws a new selection rectangle,
        // "move" drags the active selection's content as a floating clip. null when
        // the live single-pointer gesture is not a select gesture. moveOriginCell +
        // moveClipStart capture where the move drag began so the clip's position
        // tracks the pointer's cell delta.
        let selectKind: "marquee" | "move" | null = null
        let moveOriginCell: Cell = [0, 0]
        let moveClipStart: { col: number, row: number } = { col: 0, row: 0 }
        // Whether a move drag has LIFTED the selection into a floating clip yet (the
        // lift happens on the first real cell move, so a tap inside a selection does
        // not disturb the map and a pinch that starts on a selection never lifts).
        let moveLifted = false

        // The current MOVE-able footprint in cells: a floating clip's footprint
        // (its position + dims) when one is up, otherwise the active selection.
        // null when there is nothing to move. Read at pointer-down to decide
        // whether a press lands inside the selection (a move) or outside (a new
        // marquee).
        const footprintRect = (): CellRect | null => {
            const clip = clipRef.current
            if(clip !== null){
                const at = clipPosRef.current
                return { minCol: at.col, minRow: at.row, maxCol: at.col + clip.cols - 1, maxRow: at.row + clip.rows - 1 }
            }
            return selectionRef.current
        }

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
                if(m === "select"){
                    // SELECT mode: a one-finger drag is either a MOVE (the down cell
                    // sits inside the active selection / floating clip footprint) or
                    // a fresh MARQUEE. Neither opens a PAINT history step here: the
                    // lift/stamp actions own selection history. A two-finger pinch is
                    // handled by the pointers.size === 2 branch, so a select gesture
                    // never fires during a pinch.
                    painting = true
                    drewThisGesture = false
                    moveLifted = false
                    downX = e.clientX
                    downY = e.clientY
                    const cellPos = cellFromEvent(e.clientX, e.clientY)
                    const footprint = footprintRect()
                    if(cellPos !== null && footprint !== null
                        && cellPos.col >= footprint.minCol && cellPos.col <= footprint.maxCol
                        && cellPos.row >= footprint.minRow && cellPos.row <= footprint.maxRow){
                        // Inside the current selection / clip: start a MOVE drag. The
                        // actual lift is deferred to the first cell move (onMove).
                        selectKind = "move"
                        moveOriginCell = [cellPos.col, cellPos.row]
                        moveClipStart = { col: footprint.minCol, row: footprint.minRow }
                    } else if(cellPos !== null){
                        // Outside any current footprint: a fresh marquee begins. Any
                        // clip still floating is STAMPED first (one undo step) so a
                        // new selection never strands lifted content on the canvas.
                        if(clipRef.current !== null) commitFloatingClip()
                        selectKind = "marquee"
                        marqueeRef.current = { start: [cellPos.col, cellPos.row], current: [cellPos.col, cellPos.row] }
                        draw()
                    }
                    e.preventDefault()
                    return
                }
                painting = true
                lastCellRef.current = null
                drewThisGesture = false
                gestureMode = null
                downX = e.clientX
                downY = e.clientY
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
                    // DEFER the flood fill to pointer-up (a tap): filling on
                    // pointer-down would fill under the first finger of a pinch.
                    gestureMode = "fill"
                } else{
                    // Freehand: DEFER the paint. A tap paints on release; a drag
                    // starts only once the pointer leaves the start cell (onMove).
                    // Deferring means the first finger of a pinch never drops a tile
                    // before the second finger lands.
                    gestureMode = "freehand"
                }
            } else if(pointers.size === 2){
                // A second finger turns the gesture into a pinch/pan: abandon any
                // open shape preview. For freehand/fill, only commit if a DRAG
                // already painted cells; a gesture that has not drawn anything
                // (a tap that turned into a pinch) is cancelled, so pinch-to-zoom
                // never drops a tile/spawn/fill under the first finger.
                if(selectKind !== null){
                    // A select gesture became a pinch: a not-yet-dragged marquee is
                    // dropped (pinch never selects), and a MOVE that already lifted
                    // a clip simply stops dragging (the clip stays floating where it
                    // is, still pending its stamp). A move that never lifted leaves
                    // the map untouched. Either way the pinch never paints/selects.
                    painting = false
                    if(selectKind === "marquee"){
                        marqueeRef.current = null
                        draw()
                    }
                    selectKind = null
                    drewThisGesture = false
                    moveLifted = false
                    gesture = pinchState()
                } else if(shapeRef.current !== null){
                    abandonGesture()
                } else{
                    painting = false
                    if(drewThisGesture && historyRef.current.commit(mapRef.current)){
                        refreshHistoryFlags()
                    } else{
                        historyRef.current.cancel()
                    }
                    gestureMode = null
                    drewThisGesture = false
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
            } else if(painting && selectKind !== null){
                // SELECT drag. A marquee updates its current cell and re-renders the
                // dashed preview; a move drags the floating clip by the pointer's
                // cell delta, LIFTING the selection into a clip on the first real
                // move (so a tap inside a selection disturbs nothing).
                const cellPos = cellFromEvent(e.clientX, e.clientY)
                if(cellPos !== null){
                    if(selectKind === "marquee"){
                        const mq = marqueeRef.current
                        if(mq !== null && (mq.current[0] !== cellPos.col || mq.current[1] !== cellPos.row)){
                            marqueeRef.current = { start: mq.start, current: [cellPos.col, cellPos.row] }
                            drewThisGesture = true
                            draw()
                        }
                    } else if(selectKind === "move"){
                        const dCol = cellPos.col - moveOriginCell[0]
                        const dRow = cellPos.row - moveOriginCell[1]
                        if(moveLifted === false){
                            // Only lift once the pointer leaves its start cell, so a
                            // tap-inside is not a move and a pinch never lifts.
                            if(dCol !== 0 || dRow !== 0){
                                if(clipRef.current === null){
                                    if(liftSelectionToClip() === null){ selectKind = null; return }
                                }
                                moveLifted = true
                                drewThisGesture = true
                            }
                        }
                        if(moveLifted){
                            clipPosRef.current = { col: moveClipStart.col + dCol, row: moveClipStart.row + dRow }
                            // Keep the active-selection footprint following the clip
                            // so the dashed outline tracks it.
                            const c = clipRef.current
                            if(c !== null){
                                setSelection({
                                    minCol: clipPosRef.current.col,
                                    minRow: clipPosRef.current.row,
                                    maxCol: clipPosRef.current.col + c.cols - 1,
                                    maxRow: clipPosRef.current.row + c.rows - 1,
                                })
                            }
                            draw()
                        }
                    }
                }
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
                } else if(gestureMode === "freehand"){
                    // Freehand drag. The down-cell paint was DEFERRED (so a pinch
                    // does not paint), so the stroke only begins once the pointer
                    // leaves its start cell: a move WITHIN the start cell is still a
                    // tap/pinch candidate. On the first real move we paint the start
                    // cell then interpolate to the current cell; after that every
                    // move continues the stroke.
                    if(drewThisGesture){
                        paintAt(e.clientX, e.clientY)
                    } else{
                        const cur = cellFromEvent(e.clientX, e.clientY)
                        const down = cellFromEvent(downX, downY)
                        if(cur !== null && down !== null && (cur.col !== down.col || cur.row !== down.row)){
                            paintAt(downX, downY)
                            paintAt(e.clientX, e.clientY)
                            drewThisGesture = true
                        }
                    }
                }
            }
            e.preventDefault()
        }
        const onUp = (e: PointerEvent) => {
            const wasPainting = painting
            const openShape = shapeRef.current
            const wasSelect = selectKind
            const wasMarquee = marqueeRef.current
            const didDrag = drewThisGesture
            pointers.delete(e.pointerId)
            if(canvas.hasPointerCapture(e.pointerId)){
                canvas.releasePointerCapture(e.pointerId)
            }
            if(pointers.size < 2) gesture = null
            if(pointers.size === 0){
                painting = false
                lastCellRef.current = null
                if(wasSelect !== null){
                    // Close a SELECT gesture. A MARQUEE that actually dragged becomes
                    // the new active selection; a marquee TAP (no drag) clears any
                    // selection (stamping a floating clip first so it is not lost). A
                    // MOVE just leaves its clip floating where the drag ended (it
                    // stamps later on deselect / mode switch / Enter).
                    selectKind = null
                    drewThisGesture = false
                    moveLifted = false
                    if(wasMarquee !== null){
                        marqueeRef.current = null
                        if(didDrag){
                            setSelection(normalizeRect(wasMarquee.start, wasMarquee.current))
                        } else{
                            // A tap with no drag: clear the selection (committing any
                            // floating clip into the map first so it is not dropped).
                            commitFloatingClip()
                            setSelection(null)
                        }
                    }
                    draw()
                } else if(wasPainting && openShape !== null){
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
                } else if(wasPainting && gestureMode === "freehand" && drewThisGesture === false){
                    // A freehand TAP (pressed and released without dragging out of
                    // the start cell): apply the single cell now, on RELEASE. This is
                    // what makes placing a block/spawn happen on touch-up rather than
                    // touch-down, so a press that turns into a pinch never paints.
                    paintAt(downX, downY)
                    if(historyRef.current.commit(mapRef.current)) refreshHistoryFlags()
                    else historyRef.current.cancel()
                } else if(wasPainting && gestureMode === "fill" && drewThisGesture === false){
                    // A fill TAP: flood-fill the connected region on release (deferred
                    // from pointer-down so a pinch never fills), bounded as in model.
                    const cellPos = cellFromEvent(downX, downY)
                    if(cellPos !== null){
                        const map = mapRef.current
                        const start: Cell = [cellPos.col, cellPos.row]
                        const cells = boundedFloodFill(start, (col, row) => map.tileAt(col, row), map.fillClamp(start))
                        applyCells(cells)
                    }
                    if(historyRef.current.commit(mapRef.current)) refreshHistoryFlags()
                    else historyRef.current.cancel()
                } else if(wasPainting && historyRef.current.commit(mapRef.current)){
                    // A freehand DRAG already painted its cells: commit the one step.
                    refreshHistoryFlags()
                } else if(floatingHistoryOpenRef.current === false){
                    // Nothing of this gesture survives, so drop its pending snapshot.
                    // GUARD: do NOT cancel when a floating clip is holding an OPEN
                    // history step (floatingHistoryOpenRef === true). That happens when
                    // a move LIFT (or a cut/delete of a float) cleared the source under
                    // a begin() and a pinch then ended the gesture early: wasSelect and
                    // wasPainting were already reset, so this terminal path runs even
                    // though the lift's pre-clear pending snapshot must live on. The map
                    // stays mutated (source cleared, clip floating), and the eventual
                    // commitFloatingClip / cut / delete is the ONLY thing that may close
                    // this step. Cancelling here would discard the pre-lift snapshot and
                    // make that committed move un-undoable, so we leave the step open.
                    historyRef.current.cancel()
                }
                gestureMode = null
                drewThisGesture = false
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
    }, [paintAt, applyCells, pickAt, cellFromEvent, applyZoom, applyPan, draw, refreshHistoryFlags, liftSelectionToClip, commitFloatingClip])

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
        // Download always works (it is just a file, and autosave keeps the draft),
        // but flag a playability issue so a downloaded map is not silently broken.
        const issue = editorMapIssue(mapRef.current)
        setMessage(issue !== null ? `Downloaded ${link.download} - ${issue}` : `Downloaded ${link.download}`)
    }, [])

    // Play this map: stash the current exported GridMapData to localStorage under
    // a stable key, then route home. The home lobby's MapSelect (host-only) reads
    // the stash and offers a button to load it into the live match. This is an
    // EXPLICIT handoff - it never auto-hosts and starts no match - so there is no
    // timing race: the host clicks again in the lobby to apply it.
    const onPlay = useCallback(() => {
        // Block the handoff when the map cannot be played (no spawn, or over the
        // server cell cap) so the host never carries a map the match would reject.
        const issue = editorMapIssue(mapRef.current)
        if(issue !== null){
            setMessage(issue)
            return
        }
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

    // Reflect everything painted across the bounding-box centre to build a
    // symmetric arena in one click. One undo step, autosave-dirtying like any edit.
    const onMirror = useCallback((axis: MirrorAxis) => {
        const history = historyRef.current
        history.begin(mapRef.current)
        const changed = mirrorMap(mapRef.current, axis)
        if(changed && history.commit(mapRef.current)){
            refreshHistoryFlags()
            markDirty()
            bump()
            draw()
            setMessage(axis === "horizontal" ? "Mirrored left and right" : "Mirrored top and bottom")
        } else{
            history.cancel()
            setMessage("Nothing to mirror")
        }
    }, [bump, draw, markDirty, refreshHistoryFlags])

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
                // Clipboard shortcuts, gated to SELECT mode so they never shadow the
                // browser's copy/paste while painting. Cmd/Ctrl+C copies, +X cuts,
                // +V pastes the selection / clipboard clip.
                if(modeRef.current === "select"){
                    if(lower === "c"){ e.preventDefault(); onCopy(); return }
                    if(lower === "x"){ e.preventDefault(); onCut(); return }
                    if(lower === "v"){ e.preventDefault(); onPaste(); return }
                }
            }
            if(e.metaKey || e.ctrlKey || e.altKey) return

            // SELECT-mode keys (no modifier): Enter / Escape COMMIT (stamp any
            // floating clip + deselect), Delete / Backspace clears the selection.
            // Gated to select mode so they never affect painting elsewhere.
            if(modeRef.current === "select"){
                if(e.key === "Enter" || e.key === "Escape"){
                    e.preventDefault()
                    onDeselect()
                    return
                }
                if(e.key === "Delete" || e.key === "Backspace"){
                    e.preventDefault()
                    onDeleteSelection()
                    return
                }
            }

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
    }, [confirmLeave, onExport, fitNow, undo, redo, onCopy, onCut, onPaste, onDeselect, onDeleteSelection])

    // The active material's face colour as a CSS hex, derived from the shared
    // TILE_BLOCK_STYLES so the rail's block/slope icons (and the material picker
    // swatches) read as the EXACT in-game colour the author is about to paint.
    const materialFace = blockFaceCss(material)

    // The rail-icon colour for a tool: block + slope tools (auto and the four
    // explicit directions) and the half tools all show the ACTIVE material colour
    // so the rail mirrors what a stroke will paint; deco/spawn/erase keep their
    // fixed affordance colours.
    const toolIconColor = useCallback((brushFor: EditorBrush, fallback: string): string => {
        if(brushFor === "full" || brushFor === "auto"
            || SLOPE_BRUSHES.indexOf(brushFor) !== -1
            || HALF_BRUSHES.indexOf(brushFor) !== -1){
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

    // The one blocking reason this map cannot be played yet (no spawn, or over the
    // server cell cap), or null when it is playable. Recomputed off `version` so it
    // tracks the live map. Drives the status-bar warning and gates Play/Download so
    // a host never ships a map the server would reject or that has no spawn. The
    // model is a ref, so `version` (bumped on every mutation) is the dependency.
    const mapIssue = useMemo(() => editorMapIssue(mapRef.current), [version])

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
                        if(tool.brush === "half_top"){
                            // Half tile: a single tool whose active state covers the
                            // whole half-brush group, with a DIRECTION FLYOUT listing
                            // the four half shapes (mirroring the Auto-slope tool +
                            // its slope flyout). The half shapes have no keyboard
                            // shortcut, so the flyout is the one place a direction is
                            // chosen. The rail icon mirrors whichever half is selected
                            // (defaulting to half_top when none is).
                            const halfActive = HALF_BRUSHES.indexOf(brush) !== -1
                            const iconBrush: EditorBrush = halfActive ? brush : "half_top"
                            return (
                                <div key="half" className={styles.toolGroup}>
                                    <Tooltip label={tool.label} placement="right">
                                        <button
                                            type="button"
                                            className={`${styles.tool} ${halfActive ? styles.toolActive : ""}`}
                                            onClick={() => setBrush("half_top")}
                                            aria-pressed={halfActive}
                                            aria-label={tool.label}
                                            title={tool.label}
                                        >
                                            <span className={styles.toolIcon}>
                                                <ToolIcon brush={iconBrush} color={toolIconColor(iconBrush, tool.color)} />
                                            </span>
                                        </button>
                                    </Tooltip>
                                    <Tooltip label="Half directions" placement="right">
                                        <button
                                            type="button"
                                            className={styles.toolCaret}
                                            onClick={() => setHalfOpen((o) => !o)}
                                            aria-label="Half directions"
                                            aria-expanded={halfOpen}
                                            title="Half directions"
                                        >&#9656;</button>
                                    </Tooltip>
                                    {halfOpen && (
                                        <div className={styles.slopeFlyout} role="menu">
                                            {HALF_TOOLS.map((s) => (
                                                <Tooltip key={s.brush} label={s.label} placement="right">
                                                    <button
                                                        type="button"
                                                        className={`${styles.slopeItem} ${brush === s.brush ? styles.slopeItemActive : ""}`}
                                                        onClick={() => { setBrush(s.brush); setHalfOpen(false) }}
                                                        aria-pressed={brush === s.brush}
                                                        aria-label={s.label}
                                                        title={s.label}
                                                    >
                                                        <span className={styles.toolIcon}>
                                                            <ToolIcon brush={s.brush} color={toolIconColor(s.brush, s.color)} />
                                                        </span>
                                                        <span className={styles.slopeItemLabel}>{s.label}</span>
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
                {mapIssue !== null && <span className={styles.statusWarn}>{mapIssue}</span>}
                {message.length > 0 && <span className={styles.statusMsg}>{message}</span>}
            </div>

            {/* SELECTION ACTION TOOLBAR: appears whenever a selection (or floating
                clip) is active. A compact row of >= 44px buttons with portal
                Tooltips, pinned bottom-centre ABOVE the status bar so it never
                overlaps the rails / top bar / status bar at 393px. Move is a hint
                (the gesture is dragging inside the selection); Paste disables when
                the clipboard is empty. MOBILE-first: every action is reachable by
                thumb without the Alt/Ctrl keys a phone lacks. */}
            {(selection !== null || hasFloating) && (
                <div className={styles.selectBar} role="toolbar" aria-label="Selection actions">
                    <span className={styles.selectHint} title="Drag inside the selection to move it">
                        <SelectActionIcon kind="move" />
                        <span className={styles.selectHintLabel}>Drag to move</span>
                    </span>
                    <Tooltip label="Copy" shortcut={`${MOD_KEY}+C`} placement="bottom-left">
                        <button type="button" className={styles.selectButton} onClick={onCopy} aria-label="Copy selection" title="Copy">
                            <SelectActionIcon kind="copy" />
                        </button>
                    </Tooltip>
                    <Tooltip label="Cut" shortcut={`${MOD_KEY}+X`} placement="bottom-left">
                        <button type="button" className={styles.selectButton} onClick={onCut} aria-label="Cut selection" title="Cut">
                            <SelectActionIcon kind="cut" />
                        </button>
                    </Tooltip>
                    <Tooltip label="Paste" shortcut={`${MOD_KEY}+V`} placement="bottom-left">
                        <button
                            type="button"
                            className={styles.selectButton}
                            onClick={onPaste}
                            disabled={clipboardEmpty}
                            aria-label="Paste clip"
                            title="Paste"
                        >
                            <SelectActionIcon kind="paste" />
                        </button>
                    </Tooltip>
                    <Tooltip label="Rotate 90 CW" placement="bottom-left">
                        <button type="button" className={styles.selectButton} onClick={onRotate} aria-label="Rotate selection 90 degrees clockwise" title="Rotate">
                            <SelectActionIcon kind="rotate" />
                        </button>
                    </Tooltip>
                    <Tooltip label="Flip horizontal" placement="bottom-left">
                        <button type="button" className={styles.selectButton} onClick={() => onFlip("horizontal")} aria-label="Flip selection horizontally" title="Flip H">
                            <SelectActionIcon kind="flipH" />
                        </button>
                    </Tooltip>
                    <Tooltip label="Flip vertical" placement="bottom-left">
                        <button type="button" className={styles.selectButton} onClick={() => onFlip("vertical")} aria-label="Flip selection vertically" title="Flip V">
                            <SelectActionIcon kind="flipV" />
                        </button>
                    </Tooltip>
                    <Tooltip label="Delete" shortcut="Del" placement="bottom-left">
                        <button type="button" className={styles.selectButton} onClick={onDeleteSelection} aria-label="Delete selection" title="Delete">
                            <SelectActionIcon kind="delete" />
                        </button>
                    </Tooltip>
                    <Tooltip label="Deselect" shortcut="Enter" placement="bottom-left">
                        <button type="button" className={styles.selectButton} onClick={onDeselect} aria-label="Deselect (commit)" title="Deselect">
                            <SelectActionIcon kind="deselect" />
                        </button>
                    </Tooltip>
                </div>
            )}

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

                        {mapIssue !== null && (
                            <div className={styles.issue}>{mapIssue}</div>
                        )}

                        <div className={styles.actions}>
                            <GameButton onClick={onPlay}>Play this map</GameButton>
                            <GameButton accent onClick={onExport}>Download JSON</GameButton>
                            <GameButton accent onClick={() => fileInputRef.current?.click()}>Import</GameButton>
                            <GameButton accent onClick={() => onMirror("horizontal")}>Mirror left/right</GameButton>
                            <GameButton accent onClick={() => onMirror("vertical")}>Mirror top/bottom</GameButton>
                            <GameButton accent onClick={fitNow}>Fit view</GameButton>
                            <GameButton accent onClick={onClear}>Clear</GameButton>
                        </div>
                        <div className={styles.hint}>
                            Pick a draw mode (freehand, rectangle, line, fill, select) on the left, then a brush.
                            The Select tool marquees a region you can move, copy, rotate, flip or delete.
                            Scroll to pan, pinch (or ctrl+scroll) to zoom. Two fingers pan/zoom on touch.
                            Press F to fit, Cmd/Ctrl+S to download.
                        </div>

                        <details className={styles.shortcuts}>
                            <summary>Keyboard shortcuts and controls</summary>
                            <dl className={styles.shortcutList}>
                                {(Object.keys(SHORTCUT_FOR) as EditorBrush[])
                                    .filter((b) => SHORTCUT_FOR[b].length > 0)
                                    .map((b) => (
                                        <div key={b} className={styles.shortcutRow}>
                                            <dt><kbd>{SHORTCUT_FOR[b]}</kbd></dt>
                                            <dd>{LABEL_FOR[b]}</dd>
                                        </div>
                                    ))}
                                <div className={styles.shortcutRow}><dt><kbd>Cmd/Ctrl+Z</kbd></dt><dd>Undo</dd></div>
                                <div className={styles.shortcutRow}><dt><kbd>Cmd/Ctrl+Shift+Z</kbd></dt><dd>Redo</dd></div>
                                <div className={styles.shortcutRow}><dt><kbd>F</kbd></dt><dd>Fit view</dd></div>
                                <div className={styles.shortcutRow}><dt><kbd>O</kbd></dt><dd>Options</dd></div>
                                <div className={styles.shortcutRow}><dt><kbd>Cmd/Ctrl+S</kbd></dt><dd>Download JSON</dd></div>
                                <div className={styles.shortcutRow}><dt><kbd>Enter / Esc</kbd></dt><dd>Commit / deselect (Select tool)</dd></div>
                                <div className={styles.shortcutRow}><dt><kbd>Del</kbd></dt><dd>Delete selection (Select tool)</dd></div>
                                <div className={styles.shortcutRow}><dt><kbd>Cmd/Ctrl+C/X/V</kbd></dt><dd>Copy / cut / paste (Select tool)</dd></div>
                            </dl>
                            <div className={styles.hint}>
                                One finger (or left-drag) paints. Two fingers pan and pinch-zoom (trackpad:
                                scroll pans, ctrl+scroll zooms). Alt+click picks the brush under the cursor.
                                The four half-block shapes live in the Half tool flyout; the four slope
                                directions in the Auto slope flyout.
                            </div>
                        </details>
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
// grid-map.ts places the right angle in the named corner); the four half tiles
// fill a half-cell rectangle (matching their axis-aligned half-cell rect wall);
// deco fills a faded box so it reads as non-colliding decoration. `faceColor` is
// the tile's MATERIAL face colour (a CSS "#rrggbb" derived from the same
// TILE_BLOCK_STYLES the in-game Pixi renderer uses), so the editor preview
// matches what the author will see in a match. Deco is non-colliding decoration
// and ignores the material, painting a fixed faded box so it always reads as deco.
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
    // Half tiles: fill the half-cell rectangle with a flat edge down the middle,
    // matching tilePolygon / the axis-aligned half-cell rect wall.
    if(shape === "half_top"){
        ctx.fillStyle = faceColor
        ctx.fillRect(x, y, size, size / 2)
        return
    }
    if(shape === "half_bottom"){
        ctx.fillStyle = faceColor
        ctx.fillRect(x, y + size / 2, size, size / 2)
        return
    }
    if(shape === "half_left"){
        ctx.fillStyle = faceColor
        ctx.fillRect(x, y, size / 2, size)
        return
    }
    if(shape === "half_right"){
        ctx.fillStyle = faceColor
        ctx.fillRect(x + size / 2, y, size / 2, size)
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
    // Half tiles: a half-filled square. The filled rectangle covers the named
    // half (top / bottom / left / right) with a flat edge down the middle, plus
    // a faint outline of the whole cell so the empty half still reads as a cell.
    if(brush === "half_top" || brush === "half_bottom" || brush === "half_left" || brush === "half_right"){
        // x, y, width, height of the filled half within the 2..18 cell box.
        let fx = 2
        let fy = 2
        let fw = 16
        let fh = 16
        if(brush === "half_top"){ fh = 8 }
        else if(brush === "half_bottom"){ fy = 10; fh = 8 }
        else if(brush === "half_left"){ fw = 8 }
        else{ fx = 10; fw = 8 }
        return (
            <svg width={size} height={size} viewBox="0 0 20 20">
                <rect x="2" y="2" width="16" height="16" fill="none" stroke={color} strokeWidth="1.5" opacity="0.45" />
                <rect x={fx} y={fy} width={fw} height={fh} fill={color} />
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
    if(mode === "select"){
        // A marquee: a dashed selection rectangle, signalling "select a region".
        return (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="1" strokeDasharray="3 2.5" />
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

// The glyphs for the selection action toolbar. Each is a 20px line icon so the
// row reads at a glance: move (four-way arrows), copy (stacked sheets), cut
// (scissors), paste (clipboard), rotate (a curved arrow), flip H / flip V
// (mirrored triangles across a dashed axis), delete (a trash can), deselect (a
// dashed box with an x). currentColor so the button's own colour drives them.
function SelectActionIcon({ kind }: { kind: "move" | "copy" | "cut" | "paste" | "rotate" | "flipH" | "flipV" | "delete" | "deselect" }){
    const common = {
        width: 20, height: 20, viewBox: "0 0 24 24", fill: "none",
        stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    }
    if(kind === "move"){
        return (
            <svg {...common}>
                <path d="M12 3v18M3 12h18" />
                <path d="M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5" />
            </svg>
        )
    }
    if(kind === "copy"){
        return (
            <svg {...common}>
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h8" />
            </svg>
        )
    }
    if(kind === "cut"){
        return (
            <svg {...common}>
                <circle cx="6" cy="6" r="2.5" />
                <circle cx="6" cy="18" r="2.5" />
                <path d="M8 7.5L20 18M8 16.5L20 6" />
            </svg>
        )
    }
    if(kind === "paste"){
        return (
            <svg {...common}>
                <rect x="6" y="4" width="12" height="16" rx="2" />
                <path d="M9 4V3h6v1" />
            </svg>
        )
    }
    if(kind === "rotate"){
        return (
            <svg {...common}>
                <path d="M20 11a8 8 0 1 0-2.3 5.7" />
                <path d="M20 5v6h-6" />
            </svg>
        )
    }
    if(kind === "flipH"){
        return (
            <svg {...common}>
                <path d="M12 3v18" strokeDasharray="3 2" />
                <path d="M9 7l-5 5 5 5z" />
                <path d="M15 7l5 5-5 5z" />
            </svg>
        )
    }
    if(kind === "flipV"){
        return (
            <svg {...common}>
                <path d="M3 12h18" strokeDasharray="3 2" />
                <path d="M7 9l5-5 5 5z" />
                <path d="M7 15l5 5 5-5z" />
            </svg>
        )
    }
    if(kind === "delete"){
        return (
            <svg {...common}>
                <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
            </svg>
        )
    }
    // deselect: a dashed box with a small x, "drop the selection".
    return (
        <svg {...common}>
            <rect x="3" y="3" width="18" height="18" rx="1" strokeDasharray="3 2.5" />
            <path d="M9 9l6 6M15 9l-6 6" />
        </svg>
    )
}
