import { useCallback, useEffect, useRef, useState } from "react"
import Modal from "./Modal"
import GameButton from "./GameButton"
import MapThumbnail from "./MapThumbnail"
import {
    RecoveryCandidate,
    collectLocalRecoveryBlobs,
    collectOrphanRecoveryBlobs,
    scanRecoveryBlobs,
} from "../game/mapRecovery"
import { importRawMapToLibrary, saveMapToLibrary } from "../game/mapLibrary"
import { serializeGridMapData, mapFileName } from "../game/mapEditor"
import {
    openIndexedDbBackupStore,
    collectBackupRecoveryBlobs,
    mirrorLibraryFromStorage,
} from "../game/mapBackupDb"
import { trackEvent } from "../analytics"
import styles from "./RecoveryModal.module.sass"

// The "Recover lost maps" tool. It sweeps every place a map could be hiding on this
// device - the library (including entries that no longer load), the autosave draft,
// the play-map slot, the soft-delete archive, the IndexedDB backup, and any orphan
// pip-pip data - and offers every find as a one-tap, NON-DESTRUCTIVE restore. Restore
// always writes a fresh, non-colliding library entry, so nothing the author still has
// can ever be clobbered by recovering. All the heavy logic is in the pure game/map*
// modules; this component is just the touch-first surface over them.

// The guarded localStorage accessor, matching the other views (never throws in a
// non-DOM/SSR context).
function clientStorage(): Storage | null{
    try{
        return typeof window !== "undefined" ? window.localStorage : null
    } catch(e){
        return null
    }
}

// A human label for each status, leading with reassurance rather than jargon.
function statusLabel(status: RecoveryCandidate["status"]): string{
    if(status === "healthy") return "Ready to restore"
    if(status === "repairable") return "Needs a quick fix"
    return "Backup copy"
}

type Props = {
    onClose: () => void,
    // Called after any restore so the library grid behind the modal refreshes.
    onRestored: () => void,
}

export default function RecoveryModal({ onClose, onRestored }: Props){
    const [candidates, setCandidates] = useState<RecoveryCandidate[]>([])
    const [loading, setLoading] = useState(true)
    const [message, setMessage] = useState("")
    // Guard against setting state after the modal closes mid-scan.
    const aliveRef = useRef(true)
    // Re-entrancy guard so a fast double-tap (common on touch) can not run a restore
    // twice before the list refreshes and import a duplicate.
    const busyRef = useRef(false)

    // Sweep every storage surface (local + orphan are sync; the IndexedDB backup is
    // async). We HIDE candidates that are already healthy in the library, since those
    // are the cards the author can already see - "lost" means not currently loadable
    // there, or only present in a non-library surface.
    const scan = useCallback(async () => {
        // Show the searching state during EVERY scan (not just the first), so a rescan
        // after a restore replaces the now-stale rows instead of leaving them tappable.
        if(aliveRef.current) setLoading(true)
        const storage = clientStorage()
        if(storage === null){
            if(aliveRef.current){ setCandidates([]); setLoading(false) }
            return
        }
        const blobs = [
            ...collectLocalRecoveryBlobs(storage),
            ...collectOrphanRecoveryBlobs(storage),
        ]
        try{
            const store = await openIndexedDbBackupStore()
            if(store !== null) blobs.push(...await collectBackupRecoveryBlobs(store))
        } catch(e){
            // best-effort: the backup is a bonus surface
        }
        const found = scanRecoveryBlobs(blobs)
            .filter((c) => (c.status === "healthy" && c.source === "library") === false)
        if(aliveRef.current){
            setCandidates(found)
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        aliveRef.current = true
        scan()
        return () => { aliveRef.current = false }
    }, [scan])

    // Restore ONE candidate into the library. A repairable map that already lives in
    // the library (a "Needs recovery" card) is fixed IN PLACE - the broken entry is
    // overwritten with its repaired, loadable bytes - so the author ends with one good
    // map, not a broken one plus a copy. Everything else is written as a fresh, non-
    // colliding entry so nothing the author already has can be clobbered.
    const restoreOne = useCallback((c: RecoveryCandidate): string | null => {
        const storage = clientStorage()
        if(storage === null) return null
        if(c.status === "repairable" && c.data !== null && c.source === "library"){
            const res = saveMapToLibrary(storage, c.id, c.data, Date.now())
            return res.ok ? res.name : null
        }
        const payload = c.data !== null ? serializeGridMapData(c.data) : c.raw
        const base = c.data !== null && c.data.name.trim().length > 0 ? c.data.name : (c.label || "Recovered Map")
        const res = importRawMapToLibrary(storage, payload, base, Date.now())
        return res.ok ? res.name : null
    }, [])

    // Refresh the durable IndexedDB backup with the current library after a restore.
    const remirror = useCallback(() => {
        const storage = clientStorage()
        if(storage === null) return
        openIndexedDbBackupStore().then((store) => { if(store) mirrorLibraryFromStorage(store, storage, Date.now()) }).catch(() => undefined)
    }, [])

    const onRestore = useCallback(async (c: RecoveryCandidate) => {
        if(busyRef.current) return
        busyRef.current = true
        const name = restoreOne(c)
        if(name === null){
            setMessage("Could not restore (storage is full or unavailable).")
            busyRef.current = false
            return
        }
        trackEvent("recover_map_restore", { status: c.status, source: c.source })
        setMessage(`Restored "${name}" to your library.`)
        onRestored()
        remirror()
        await scan()
        busyRef.current = false
    }, [restoreOne, onRestored, remirror, scan])

    // Restore EVERYTHING found in one tap.
    const onRecoverAll = useCallback(async () => {
        if(busyRef.current) return
        busyRef.current = true
        let restored = 0
        for(const c of candidates){
            if(restoreOne(c) !== null) restored++
        }
        trackEvent("recover_map_restore_all", { count: restored })
        setMessage(restored > 0 ? `Restored ${restored} ${restored === 1 ? "map" : "maps"} to your library.` : "Nothing could be restored.")
        onRestored()
        remirror()
        await scan()
        busyRef.current = false
    }, [candidates, restoreOne, onRestored, remirror, scan])

    // Download a candidate's JSON so it can never be lost again, even if it cannot be
    // auto-fixed. Repairable candidates export the repaired (loadable) form; raw ones
    // export their exact stored bytes.
    const onExport = useCallback((c: RecoveryCandidate) => {
        const payload = c.data !== null ? serializeGridMapData(c.data) : c.raw
        const blob = new Blob([payload], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = mapFileName(c.data !== null ? c.data.name : c.label)
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
        trackEvent("recover_map_export", { status: c.status })
        setMessage(`Downloaded ${link.download}`)
    }, [])

    return (
        <Modal title="Recover lost maps" onClose={onClose}>
            <div className={styles.body}>
                <p className={styles.intro}>
                    These maps were found in this device&apos;s storage but are not showing in
                    your library. Restoring makes a fresh copy, so nothing you already have is
                    changed.
                </p>
                {message !== "" && <div className={styles.message} role="status">{message}</div>}

                {loading && <div className={styles.empty}>Searching this device for lost maps...</div>}

                {!loading && candidates.length === 0 && (
                    <div className={styles.empty}>
                        Good news: no lost maps were found in this device&apos;s storage.
                    </div>
                )}

                {!loading && candidates.length > 0 && (
                    <>
                        <div className={styles.toolbar}>
                            <span className={styles.foundCount}>
                                {candidates.length} {candidates.length === 1 ? "map" : "maps"} found
                            </span>
                            <GameButton onClick={onRecoverAll}>Recover everything</GameButton>
                        </div>
                        <ul className={styles.list}>
                            {candidates.map((c) => (
                                <li key={c.key} className={styles.row}>
                                    <div className={styles.thumb}>
                                        {c.data !== null
                                            ? <MapThumbnail data={c.data} />
                                            : <div className={styles.thumbMissing}>Raw data</div>}
                                    </div>
                                    <div className={styles.info}>
                                        <span className={styles.name}>
                                            {c.data !== null ? c.data.name : c.label}
                                        </span>
                                        <span className={`${styles.status} ${styles[`status_${c.status}`]}`}>
                                            {statusLabel(c.status)}
                                        </span>
                                        <span className={styles.meta}>
                                            {c.cols} x {c.rows} - {c.tileCount.toLocaleString()} blocks
                                        </span>
                                        {c.repairs.length > 0 && (
                                            <span className={styles.repairs}>
                                                Auto-fix will: {c.repairs.join(", ")}.
                                            </span>
                                        )}
                                    </div>
                                    <div className={styles.actions}>
                                        <button
                                            type="button"
                                            className={styles.action}
                                            onClick={() => onRestore(c)}
                                            aria-label={`${c.status === "repairable" ? "Auto-fix and restore" : c.status === "raw" ? "Keep a copy of" : "Restore"} ${c.data !== null ? c.data.name : c.label}`}
                                        >
                                            {c.status === "repairable" ? "Auto-fix and restore" : c.status === "raw" ? "Keep a copy" : "Restore"}
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.action}
                                            onClick={() => onExport(c)}
                                            aria-label={`Export ${c.data !== null ? c.data.name : c.label}`}
                                        >Export file</button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </div>
        </Modal>
    )
}
