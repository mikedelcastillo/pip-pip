import { useCallback, useMemo, useRef, useState } from "react"
import { PIP_MAPS } from "@pip-pip/game/src/maps"
import { GridMapData, validateGridMapData } from "@pip-pip/game/src/logic/grid-map"
import { GAME_CONTEXT } from "../game"
import { useGameStore } from "../game/store"
import { loadPlayMap, clearPlayMap } from "../game/mapEditor"
import { listLibraryMaps, loadMapFromLibrary, LibrarySummary } from "../game/mapLibrary"
import MapPreview from "./MapPreview"
import styles from "./MapSelect.module.sass"

// A cheap, read-only preview digest for each map. We instantiate each map once
// (throwaway, never added to the world) to read its wall counts, mirroring how
// ShipSelect builds its stat lines from a preview ship. No hardcoded numbers.
function getMapPreviews(): number[] {
    return PIP_MAPS.map((mapType) => {
        const map = mapType.createMap()
        return map.rectWalls.length + map.segWalls.length
    })
}

// The browser localStorage, guarded so a non-DOM/SSR context (and tests that
// import this component) never throw. Mirrors the editor's own guard.
function browserStorage(): Storage | null {
    try {
        return typeof window !== "undefined" ? window.localStorage : null
    } catch (e) {
        return null
    }
}

export default function MapSelect() {
    const isHost = useGameStore((s) => s.isHost)
    const activeIndex = useGameStore((s) => s.mapIndex)
    const customMapName = useGameStore((s) => s.customMapName)

    const wallCounts = useMemo(() => getMapPreviews(), [])
    const fileInputRef = useRef<HTMLInputElement | null>(null)
    const [error, setError] = useState("")

    // The editor->play handoff: read once per render whether a "Play this map"
    // stash exists, so the host can load it into the match. Only meaningful for a
    // host (non-hosts cannot change the map). Recomputed via the version bump
    // below after a successful load clears it.
    const [stashVersion, setStashVersion] = useState(0)
    const stashed = useMemo<GridMapData | null>(() => {
        // stashVersion bumps after a load so the memo recomputes and the button
        // disappears once the stash is consumed. Referenced here so the dependency
        // is real, not just listed.
        void stashVersion
        if (!isHost) return null
        const storage = browserStorage()
        if (storage === null) return null
        return loadPlayMap(storage)
    }, [isHost, stashVersion])

    // The host's SAVED maps library, read once per render-driven refresh. Only
    // meaningful for a host (non-hosts cannot change the map). It is recomputed via
    // the version bump below, which we fire on mount and whenever the section is
    // re-opened, so the list reflects what the editor has saved without any
    // cross-tab plumbing. Same no-window/try-catch guard as the stash read.
    const [libraryVersion, setLibraryVersion] = useState(0)
    const libraryMaps = useMemo<LibrarySummary[]>(() => {
        // libraryVersion is referenced so the memo recomputes on a bump; the actual
        // list is read fresh from storage each time.
        void libraryVersion
        if (!isHost) return []
        const storage = browserStorage()
        if (storage === null) return []
        try {
            return listLibraryMaps(storage)
        } catch (e) {
            return []
        }
    }, [isHost, libraryVersion])

    // Re-read the library when the saved-maps section is toggled open, so a map
    // saved in the editor (another view) shows up without a reload. Starts open so
    // the host sees their collection immediately on mount.
    const [libraryOpen, setLibraryOpen] = useState(true)
    const toggleLibrary = useCallback(() => {
        setLibraryOpen((open) => {
            const next = !open
            if (next) setLibraryVersion((v) => v + 1)
            return next
        })
    }, [])

    const select = (index: number) => {
        if (!isHost) return
        GAME_CONTEXT.setMap(index)
    }

    // Apply an already-parsed, valid GridMapData to the live match (host action).
    const applyCustom = useCallback((data: GridMapData) => {
        GAME_CONTEXT.setCustomMap(data)
        setError("")
    }, [])

    // Read an uploaded .json file, parse + validate it, and on success load it
    // into the match. Any failure (not JSON, wrong shape, oversized) shows a brief
    // inline error and never crashes. Mirrors the editor's import guard.
    const onUploadFile = useCallback((file: File) => {
        const reader = new FileReader()
        reader.onload = () => {
            let parsed: unknown
            try {
                parsed = JSON.parse(String(reader.result))
            } catch (e) {
                setError("That file is not valid JSON.")
                return
            }
            const data = validateGridMapData(parsed)
            if (data === null) {
                setError("That map file is invalid or too large.")
                return
            }
            applyCustom(data)
        }
        reader.onerror = () => setError("Could not read that file.")
        reader.readAsText(file)
    }, [applyCustom])

    // Load the stashed "Play this map" from the editor into the match, then clear
    // the stash so the button does not linger once the map is live.
    const onUseEditorMap = useCallback(() => {
        const storage = browserStorage()
        if (storage === null) return
        const data = loadPlayMap(storage)
        if (data === null) {
            setError("No editor map is queued.")
            return
        }
        const valid = validateGridMapData(data)
        if (valid === null) {
            setError("The editor map is invalid or too large.")
            clearPlayMap(storage)
            setStashVersion((v) => v + 1)
            return
        }
        applyCustom(valid)
        clearPlayMap(storage)
        setStashVersion((v) => v + 1)
    }, [applyCustom])

    // Load one of the host's SAVED library maps into the live match. The library
    // helper parses + validates (the SAME gate the upload / editor-map paths pass
    // through), so a corrupt/invalid entry returns null: we show a brief inline
    // error and do NOT send. On success we apply it exactly like every other
    // custom-map source. The library is read-only here (no save/delete in lobby).
    const onUseLibraryMap = useCallback((name: string) => {
        const storage = browserStorage()
        if (storage === null) return
        const data = loadMapFromLibrary(storage, name)
        if (data === null) {
            setError(`"${name}" could not be loaded (it may be corrupt).`)
            return
        }
        applyCustom(data)
    }, [applyCustom])

    const containerClasses = [styles.mapSelect]
    if (!isHost) containerClasses.push(styles.disabled)

    // A custom map is active when the store carries its name (mapIndex is -1, so
    // no built-in card is highlighted, which is correct).
    const customActive = customMapName !== null

    return (
        <div className={containerClasses.join(" ")}>
            <div className={styles.grid}>
                {PIP_MAPS.map((mapType, index) => {
                    const cardClasses = [styles.card]
                    if (index === activeIndex) cardClasses.push(styles.active)
                    return (
                        <div
                            key={mapType.id}
                            className={cardClasses.join(" ")}
                            onClick={() => select(index)}
                            // Keyboard + controller reachable: a real focus target
                            // with a button role and label, activated on Enter/Space
                            // (Space's default page-scroll is prevented). The
                            // existing onClick still handles mouse/touch. Only the
                            // host can change the map, so non-hosts are not tabbable.
                            role="button"
                            tabIndex={isHost ? 0 : -1}
                            aria-label={`Select map ${mapType.name}`}
                            aria-pressed={index === activeIndex}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    if (e.key === " ") e.preventDefault()
                                    select(index)
                                }
                            }}
                        >
                            <div className={styles.preview}>
                                <MapPreview mapType={mapType} />
                            </div>
                            <div className={styles.name}>{mapType.name}</div>
                            <div className={styles.stats}>
                                <div className={styles.stat}>
                                    <span className={styles.statLabel}>Walls</span>
                                    <span className={styles.statValue}>{wallCounts[index]}</span>
                                </div>
                            </div>
                            {index === activeIndex && <div className={styles.selectedTag}>Current</div>}
                        </div>
                    )
                })}
            </div>

            {/* When a custom map is live, show it as the current selection so the
                host can see which map is active even though no built-in card is
                highlighted (a custom mapIndex is -1). */}
            {customActive && (
                <div className={styles.customActive}>
                    <span className={styles.customLabel}>Custom map</span>
                    <span className={styles.customName}>{customMapName}</span>
                    <span className={styles.selectedTag}>Current</span>
                </div>
            )}

            {isHost && (
                <div className={styles.customRow}>
                    {/* Upload: a styled label wraps a visually-hidden file input so
                        the whole >=44px target is tappable on a 393px touch screen
                        (a bare file input is a tiny, hard-to-hit native control). */}
                    <label className={styles.uploadButton}>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json,application/json"
                            className={styles.hiddenInput}
                            onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (typeof file !== "undefined") onUploadFile(file)
                                e.target.value = ""
                            }}
                        />
                        Upload map
                    </label>

                    {stashed !== null && (
                        <button
                            type="button"
                            className={styles.editorButton}
                            onClick={onUseEditorMap}
                        >
                            Use editor map ({stashed.name})
                        </button>
                    )}
                </div>
            )}

            {/* Saved maps: the host's personal library, loaded read-only into the
                match. Renders nothing when the library is empty (no empty box). The
                list scrolls within a capped height so a large collection never
                pushes the lobby controls off a 393px screen or overlaps the grid. */}
            {isHost && libraryMaps.length > 0 && (
                <div className={styles.library}>
                    <button
                        type="button"
                        className={styles.libraryHeader}
                        onClick={toggleLibrary}
                        aria-expanded={libraryOpen}
                    >
                        <span className={styles.libraryTitle}>Saved maps</span>
                        <span className={styles.libraryCount}>{libraryMaps.length}</span>
                    </button>
                    {libraryOpen && (
                        <div className={styles.libraryList}>
                            {libraryMaps.map((summary) => (
                                <button
                                    key={summary.name}
                                    type="button"
                                    className={styles.libraryRow}
                                    onClick={() => onUseLibraryMap(summary.name)}
                                    aria-label={`Load saved map ${summary.name}`}
                                >
                                    <span className={styles.libraryRowName}>{summary.name}</span>
                                    <span className={styles.libraryRowMeta}>
                                        {summary.cols}x{summary.rows}, {summary.spawns} spawns
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {isHost && error.length > 0 && (
                <div className={styles.error} role="alert">{error}</div>
            )}

            {!isHost && (
                <div className={styles.hint}>Only the host can change the map.</div>
            )}
        </div>
    )
}
