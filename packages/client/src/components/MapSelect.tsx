import { useMemo } from "react"
import { PIP_MAPS } from "@pip-pip/game/src/maps"
import { GAME_CONTEXT } from "../game"
import { useGameStore } from "../game/store"
import styles from "./MapSelect.module.sass"

// A cheap, read-only preview digest for each map. We instantiate each map once
// (throwaway, never added to the world) to read its wall counts — mirroring how
// ShipSelect builds its stat lines from a preview ship. No hardcoded numbers.
function getMapPreviews(): number[] {
    return PIP_MAPS.map((mapType) => {
        const map = mapType.createMap()
        return map.rectWalls.length + map.segWalls.length
    })
}

export default function MapSelect() {
    const isHost = useGameStore((s) => s.isHost)
    const activeIndex = useGameStore((s) => s.mapIndex)

    const wallCounts = useMemo(() => getMapPreviews(), [])

    const select = (index: number) => {
        if (!isHost) return
        GAME_CONTEXT.setMap(index)
    }

    const containerClasses = [styles.mapSelect]
    if (!isHost) containerClasses.push(styles.disabled)

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
                        >
                            <div className={styles.preview}>{index + 1}</div>
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
            {!isHost && (
                <div className={styles.hint}>Only the host can change the map.</div>
            )}
        </div>
    )
}
