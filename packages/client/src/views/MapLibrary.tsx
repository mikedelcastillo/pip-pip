import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import GameButton from "../components/GameButton"
import GameInput from "../components/GameInput"
import ConfirmModal from "../components/ConfirmModal"
import Modal from "../components/Modal"
import HomeBackground from "../components/HomeBackground"
import MapThumbnail from "../components/MapThumbnail"
import { GridMapData } from "@pip-pip/game/src/logic/grid-map"
import {
    LibrarySummary,
    listLibraryMaps,
    loadMapFromLibrary,
    deleteMapFromLibrary,
    duplicateLibraryMap,
    renameLibraryMap,
    getLibraryEntry,
    editorMapPath,
} from "../game/mapLibrary"
import {
    mapFileName,
    serializeGridMapData,
} from "../game/mapEditor"
import {
    archivePut,
    purgeExpiredArchive,
    listArchivedMaps,
} from "../game/mapArchive"
import { scanLocalRecoverableMaps } from "../game/mapRecovery"
import { openIndexedDbBackupStore, mirrorLibraryFromStorage } from "../game/mapBackupDb"
import RecoveryModal from "../components/RecoveryModal"
import ArchiveModal from "../components/ArchiveModal"
import { trackEvent, trackPageView } from "../analytics"
import styles from "./MapLibrary.module.sass"

// The LIBRARY HOME for the Map Maker: a Procreate / Google-Docs style grid of
// cards, one per saved map (game/mapLibrary.ts), plus a leading "+ New Map" tile.
// This REPLACES the old "straight into a single autosaved draft" entry: the home
// menu's Map Maker button now lands here, and each card opens the editor on THAT
// specific map (route /editor/:mapName) which then autosaves back to that entry.
// Card management (open / rename / duplicate / export / delete) all routes through
// the pure mapLibrary helpers so the storage logic stays DOM-free + unit-tested.
//
// Mobile-first: the grid is a single column on a phone (auto-fill min 150px on
// wider screens), every card is a big tap target that opens the map, and the
// per-card actions are >= 44px touch buttons. Rename + delete go through the shared
// Modal/ConfirmModal so they get backdrop-tap / Escape dismissal on touch + desktop.

// The injectable storage the library reads. window.localStorage in the browser;
// guarded so a non-DOM/SSR context never throws.
function libraryStorage(): Storage | null{
    try{
        return typeof window !== "undefined" ? window.localStorage : null
    } catch(e){
        return null
    }
}

// A summary paired with its parsed map data (for the thumbnail). The data is loaded
// + validated by loadMapFromLibrary, so a corrupt entry yields null and its card
// simply shows the empty backdrop rather than crashing.
type LibraryCard = {
    summary: LibrarySummary,
    data: GridMapData | null,
}

// A short "last modified" hint from a savedAt epoch-millis stamp: "just now",
// "5m ago", "3h ago", "2d ago", else a locale date. Pure-ish (reads the clock once
// per render via Date.now), kept inline since it is purely presentational.
function lastModifiedHint(savedAt: number | undefined): string{
    if(typeof savedAt !== "number" || Number.isFinite(savedAt) === false) return "Saved"
    const diff = Date.now() - savedAt
    if(diff < 0) return "Just now"
    const minute = 60_000
    const hour = 60 * minute
    const day = 24 * hour
    if(diff < minute) return "Just now"
    if(diff < hour) return `${Math.floor(diff / minute)}m ago`
    if(diff < day) return `${Math.floor(diff / hour)}h ago`
    if(diff < 7 * day) return `${Math.floor(diff / day)}d ago`
    try{
        return new Date(savedAt).toLocaleDateString()
    } catch(e){
        return "Saved"
    }
}

export default function MapLibrary(){
    const navigate = useNavigate()
    const [cards, setCards] = useState<LibraryCard[]>([])
    const [message, setMessage] = useState("")
    // The name of the map a delete is awaiting confirmation for (a tap must not nuke
    // a map), null when none is pending. Mirrors the editor's confirmDeleteName.
    const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null)
    // The map being renamed (its current name) + the in-progress new-name text, or
    // null when the rename modal is closed.
    const [renaming, setRenaming] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState("")
    // The recovery + archive tools, plus a live badge count for each so the author can
    // see at a glance that there is something to recover or restore.
    const [recoveryOpen, setRecoveryOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [recoveryCount, setRecoveryCount] = useState(0)
    const [archiveCount, setArchiveCount] = useState(0)

    useEffect(() => {
        trackPageView("/maps")
    }, [])

    // On entering the library: purge any archive entries past their 30-day window, and
    // mirror the current library into the IndexedDB backup so there is a durable copy
    // beneath localStorage. Both are best-effort and never block the screen.
    useEffect(() => {
        const storage = libraryStorage()
        if(storage === null) return
        purgeExpiredArchive(storage, Date.now())
        openIndexedDbBackupStore()
            .then((store) => { if(store !== null) mirrorLibraryFromStorage(store, storage, Date.now()) })
            .catch(() => undefined)
    }, [])

    // Re-read the whole library (summaries + parsed data for thumbnails) from
    // storage. Called on mount and after every mutation so the grid always reflects
    // what is on disk. Never throws: an unavailable storage yields an empty grid.
    const refresh = useCallback(() => {
        const storage = libraryStorage()
        if(storage === null){
            setCards([])
            return
        }
        const summaries = listLibraryMaps(storage)
        setCards(summaries.map((summary) => ({
            summary,
            data: loadMapFromLibrary(storage, summary.name),
        })))
        // Refresh the tool badges. The recovery count is a quick LOCAL-only sweep
        // (the modal does the fuller async scan that also reads the IndexedDB backup)
        // and excludes maps that already show as healthy library cards.
        const recoverable = scanLocalRecoverableMaps(storage)
            .filter((c) => (c.status === "healthy" && c.source === "library") === false)
        setRecoveryCount(recoverable.length)
        setArchiveCount(listArchivedMaps(storage, Date.now()).length)
    }, [])

    useEffect(() => {
        refresh()
    }, [refresh])

    // NEW MAP: open the editor on a fresh blank map. The editor at /editor (no map
    // id) keeps its existing single-draft behaviour; the author names + saves it
    // into the library from there, which then shows up as a card here.
    const onNewMap = useCallback(() => {
        trackEvent("new_map_from_library")
        navigate("/editor")
    }, [navigate])

    // OPEN a specific saved map in the editor: route to /editor/:mapName so the
    // editor loads THAT library entry and autosaves back to it (not the shared
    // draft). The name is URL-encoded so spaces / punctuation survive the route.
    const onOpen = useCallback((name: string) => {
        trackEvent("open_map_from_library")
        navigate(editorMapPath(name))
    }, [navigate])

    // DUPLICATE a card under a fresh non-colliding name, then refresh so the copy
    // appears. The pure helper picks the name + re-stamps the copy's own map name.
    const onDuplicate = useCallback((name: string) => {
        const storage = libraryStorage()
        if(storage === null) return
        const result = duplicateLibraryMap(storage, name, Date.now())
        if(result.ok === false){
            setMessage(result.message)
            return
        }
        trackEvent("duplicate_map_from_library")
        setMessage(`Duplicated as "${result.name}"`)
        refresh()
    }, [refresh])

    // EXPORT / DOWNLOAD a card's map JSON. Builds the same pretty-printed file the
    // editor's Download produces (serializeGridMapData) and triggers a browser
    // download via a temporary anchor. A corrupt/unreadable entry is skipped.
    const onExport = useCallback((card: LibraryCard) => {
        if(card.data === null){
            setMessage(`Could not export "${card.summary.name}" (saved map is unreadable).`)
            return
        }
        const blob = new Blob([serializeGridMapData(card.data)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = mapFileName(card.summary.name)
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
        trackEvent("export_map_from_library")
        setMessage(`Downloaded ${link.download}`)
    }, [])

    // Open the rename modal seeded with the current name.
    const onStartRename = useCallback((name: string) => {
        setRenaming(name)
        setRenameValue(name)
    }, [])

    // Commit a rename through the pure helper. A blank / colliding target surfaces a
    // message and keeps the modal open so the author can fix it; success closes it.
    const onConfirmRename = useCallback(() => {
        if(renaming === null) return
        const storage = libraryStorage()
        if(storage === null) return
        const result = renameLibraryMap(storage, renaming, renameValue)
        if(result.ok === false){
            setMessage(result.message)
            return
        }
        trackEvent("rename_map_from_library")
        setRenaming(null)
        setMessage(`Renamed to "${result.name}"`)
        refresh()
    }, [renaming, renameValue, refresh])

    // Delete after the inline confirm. A delete now ARCHIVES first: the entry's exact
    // bytes (even an unreadable one) are moved into the 30-day archive, THEN removed
    // from the library, so a mis-tap on Delete can always be undone from the archive.
    const onConfirmDelete = useCallback(() => {
        const target = confirmDeleteName
        setConfirmDeleteName(null)
        if(target === null) return
        const storage = libraryStorage()
        let archivedOk = true
        if(storage !== null){
            // Archive the exact bytes BEFORE removing, and only remove the library entry
            // once they are safely archived (or there were no bytes to keep). If the
            // archive write fails (storage full / private mode), keep the map in place
            // so a delete can never become permanent loss.
            const entry = getLibraryEntry(storage, target)
            if(entry !== null){
                archivedOk = archivePut(storage, target, entry.data, Date.now(), entry.savedAt) !== null
            }
            if(archivedOk) deleteMapFromLibrary(storage, target)
        }
        trackEvent("delete_map_from_library")
        setMessage(archivedOk
            ? `Moved "${target}" to the archive. Restore it within 30 days.`
            : `Could not archive "${target}" (storage is full). It was kept - export it first, then delete.`)
        refresh()
    }, [confirmDeleteName, refresh])

    const count = cards.length
    const countLabel = useMemo(() => `${count} ${count === 1 ? "map" : "maps"}`, [count])

    return (
        <div className="center-container">
            <HomeBackground />
            <div className={`content-container ${styles.content}`}>
                <div className={styles.header}>
                    <div className={styles.titleRow}>
                        <GameButton accent onClick={() => navigate("/")}>Back</GameButton>
                        <h1 className={styles.title}>Map Maker</h1>
                        <span className={styles.count}>{countLabel}</span>
                    </div>
                    {message !== "" && <div className={styles.message} role="status">{message}</div>}
                    {/* Safety tools: recover maps that are not showing, and the 30-day
                        archive of deleted maps. Big touch targets; each badges its count. */}
                    <div className={styles.toolsRow}>
                        <GameButton onClick={() => setRecoveryOpen(true)}>
                            {recoveryCount > 0 ? `Recover lost maps (${recoveryCount})` : "Recover lost maps"}
                        </GameButton>
                        <GameButton accent onClick={() => setArchiveOpen(true)}>
                            {archiveCount > 0 ? `Archive (${archiveCount})` : "Archive"}
                        </GameButton>
                    </div>
                </div>

                <div className={styles.grid}>
                    {/* The leading "+ New Map" tile creates a fresh map + opens the
                        editor. Same card footprint as a map card so the grid reads
                        evenly; a big tap target on touch. */}
                    <button
                        type="button"
                        className={`${styles.card} ${styles.newCard}`}
                        onClick={onNewMap}
                        aria-label="New map"
                    >
                        <span className={styles.newPlus} aria-hidden="true">+</span>
                        <span className={styles.newLabel}>New Map</span>
                    </button>

                    {cards.map((card) => (
                        <div key={card.summary.name} className={styles.card}>
                            {/* Tapping the preview/title opens the map. A button so it
                                is keyboard + screen-reader reachable and a clear 44px+
                                tap target on mobile. */}
                            <button
                                type="button"
                                className={styles.openArea}
                                onClick={() => onOpen(card.summary.name)}
                                aria-label={`Open ${card.summary.name}`}
                            >
                                {card.data !== null
                                    ? <MapThumbnail data={card.data} />
                                    : <div className={styles.thumbnailMissing}>Needs recovery</div>}
                                <div className={styles.cardInfo}>
                                    <span className={styles.cardName}>{card.summary.name}</span>
                                    <span className={styles.cardMeta}>
                                        {card.summary.cols}x{card.summary.rows} - {lastModifiedHint(card.summary.savedAt)}
                                    </span>
                                </div>
                            </button>

                            {/* Per-card management. Each is a >= 44px touch target;
                                Delete is the danger action and routes through the
                                confirm modal so a tap never silently nukes a map. */}
                            <div className={styles.cardActions}>
                                <button
                                    type="button"
                                    className={styles.action}
                                    onClick={() => onStartRename(card.summary.name)}
                                    aria-label={`Rename ${card.summary.name}`}
                                >Rename</button>
                                <button
                                    type="button"
                                    className={styles.action}
                                    onClick={() => onDuplicate(card.summary.name)}
                                    aria-label={`Duplicate ${card.summary.name}`}
                                >Duplicate</button>
                                <button
                                    type="button"
                                    className={styles.action}
                                    onClick={() => onExport(card)}
                                    aria-label={`Export ${card.summary.name}`}
                                >Export</button>
                                <button
                                    type="button"
                                    className={`${styles.action} ${styles.actionDanger}`}
                                    onClick={() => setConfirmDeleteName(card.summary.name)}
                                    aria-label={`Delete ${card.summary.name}`}
                                >Delete</button>
                            </div>
                        </div>
                    ))}
                </div>

                {count === 0 && (
                    <div className={styles.empty}>
                        No saved maps yet. Tap <strong>New Map</strong> to start building, then
                        save it to your library from the editor.
                    </div>
                )}
            </div>

            {/* RENAME: a small modal with the shared input so it works the same on
                touch + desktop (Enter / backdrop-tap / Escape). */}
            {renaming !== null && (
                <Modal title="Rename map" onClose={() => setRenaming(null)} hideClose>
                    <div className={styles.renameBody}>
                        <GameInput
                            value={renameValue}
                            onChange={setRenameValue}
                            name="map-rename"
                            placeholder="Map name"
                            onEnter={onConfirmRename}
                        />
                        <div className={styles.renameActions}>
                            <GameButton accent onClick={() => setRenaming(null)}>Cancel</GameButton>
                            <GameButton onClick={onConfirmRename}>Rename</GameButton>
                        </div>
                    </div>
                </Modal>
            )}

            {/* DELETE confirm: a destructive action must never fire on a single tap.
                Delete now moves the map to the archive, so it is recoverable. */}
            {confirmDeleteName !== null && (
                <ConfirmModal
                    title="Delete map"
                    message={`Move "${confirmDeleteName}" to the archive? You can restore it for 30 days.`}
                    confirmLabel="Delete"
                    onConfirm={onConfirmDelete}
                    onClose={() => setConfirmDeleteName(null)}
                />
            )}

            {/* RECOVER: sweep every storage surface for maps that are not showing and
                restore them non-destructively. ARCHIVE: restore soft-deleted maps. */}
            {recoveryOpen && (
                <RecoveryModal onClose={() => setRecoveryOpen(false)} onRestored={refresh} />
            )}
            {archiveOpen && (
                <ArchiveModal onClose={() => setArchiveOpen(false)} onRestored={refresh} />
            )}
        </div>
    )
}
