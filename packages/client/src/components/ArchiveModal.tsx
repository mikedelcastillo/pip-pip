import { useCallback, useEffect, useState } from "react"
import Modal from "./Modal"
import ConfirmModal from "./ConfirmModal"
import {
    ArchiveSummary,
    listArchivedMaps,
    restoreArchivedMap,
    removeArchivedMap,
    ARCHIVE_RETENTION_MS,
} from "../game/mapArchive"
import { trackEvent } from "../analytics"
import styles from "./RecoveryModal.module.sass"

// The Archive modal: maps that Delete moved aside (instead of destroying) are listed
// here, restorable for 30 days. This is the undo for a mis-tap on Delete. Built on the
// same touch-first row layout as the recovery modal so the two read as a set.

function clientStorage(): Storage | null{
    try{
        return typeof window !== "undefined" ? window.localStorage : null
    } catch(e){
        return null
    }
}

// "deleted just now / 5m ago / 3h ago / 2d ago".
function deletedHint(deletedAt: number): string{
    const diff = Date.now() - deletedAt
    if(diff < 0) return "just now"
    const minute = 60_000
    const hour = 60 * minute
    const day = 24 * hour
    if(diff < minute) return "just now"
    if(diff < hour) return `${Math.floor(diff / minute)}m ago`
    if(diff < day) return `${Math.floor(diff / hour)}h ago`
    return `${Math.floor(diff / day)}d ago`
}

function keptUntil(deletedAt: number): string{
    try{
        return new Date(deletedAt + ARCHIVE_RETENTION_MS).toLocaleDateString()
    } catch(e){
        return "30 days"
    }
}

type Props = {
    onClose: () => void,
    onRestored: () => void,
}

export default function ArchiveModal({ onClose, onRestored }: Props){
    const [items, setItems] = useState<ArchiveSummary[]>([])
    const [message, setMessage] = useState("")
    const [confirmForget, setConfirmForget] = useState<string | null>(null)

    const refresh = useCallback(() => {
        const storage = clientStorage()
        setItems(storage === null ? [] : listArchivedMaps(storage, Date.now()))
    }, [])

    useEffect(() => {
        refresh()
    }, [refresh])

    const onRestore = useCallback((name: string) => {
        const storage = clientStorage()
        if(storage === null) return
        const res = restoreArchivedMap(storage, name, Date.now())
        if(res.ok === false){
            setMessage(res.message)
            return
        }
        trackEvent("archive_restore")
        setMessage(`Restored "${res.name}" to your library.`)
        onRestored()
        refresh()
    }, [onRestored, refresh])

    const onConfirmForget = useCallback(() => {
        const target = confirmForget
        setConfirmForget(null)
        if(target === null) return
        const storage = clientStorage()
        if(storage !== null) removeArchivedMap(storage, target)
        trackEvent("archive_delete_forever")
        setMessage(`Removed "${target}" from the archive.`)
        refresh()
    }, [confirmForget, refresh])

    return (
        <Modal title="Archived maps" onClose={onClose}>
            <div className={styles.body}>
                <p className={styles.intro}>
                    Deleting a map moves it here, where it is kept for 30 days. Restore anything
                    you still want.
                </p>
                {message !== "" && <div className={styles.message} role="status">{message}</div>}

                {items.length === 0 && (
                    <div className={styles.empty}>The archive is empty.</div>
                )}

                {items.length > 0 && (
                    <ul className={styles.list}>
                        {items.map((item) => (
                            <li key={item.name} className={styles.row}>
                                <div className={styles.info}>
                                    <span className={styles.name}>{item.name}</span>
                                    <span className={styles.meta}>
                                        {item.cols} x {item.rows} - deleted {deletedHint(item.deletedAt)}
                                    </span>
                                    <span className={styles.repairs}>Kept until {keptUntil(item.deletedAt)}</span>
                                </div>
                                <div className={styles.actions}>
                                    <button
                                        type="button"
                                        className={styles.action}
                                        onClick={() => onRestore(item.name)}
                                        aria-label={`Restore ${item.name}`}
                                    >Restore</button>
                                    <button
                                        type="button"
                                        className={styles.action}
                                        onClick={() => setConfirmForget(item.name)}
                                        aria-label={`Delete ${item.name} forever`}
                                    >Delete forever</button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {confirmForget !== null && (
                <ConfirmModal
                    title="Delete forever"
                    message={`Permanently delete "${confirmForget}"? This cannot be undone.`}
                    confirmLabel="Delete forever"
                    onConfirm={onConfirmForget}
                    onClose={() => setConfirmForget(null)}
                />
            )}
        </Modal>
    )
}
