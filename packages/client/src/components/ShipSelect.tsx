import { useMemo } from "react"
import { PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PIP_SHIPS } from "@pip-pip/game/src/ships"
import { GAME_CONTEXT } from "../game"
import { shipAssets } from "../game/assets"
import { useGameStore } from "../game/store"
import styles from "./ShipSelect.module.sass"

type ShipStatLine = {
    label: string,
    value: string,
}

// A small, read-only digest of each ship's stats for the cards. Built from a
// throwaway instance per ship against the already-mounted game, so it picks up
// whatever the game-logic side defines (no hardcoded numbers). The preview
// ships are never added to the world, so there are no side effects.
function getShipStatLines(): ShipStatLine[][] {
    return PIP_SHIPS.map((shipType) => {
        const { stats } = new shipType.Ship(GAME_CONTEXT.game, "preview")
        const bullet = stats.bullet.damage.normal
        const pellets = stats.weapon.spread.count
        return [
            { label: "Health", value: Math.round(stats.health.capacity.normal).toString() },
            { label: "Damage", value: pellets > 1 ? `${bullet} (x${pellets})` : bullet.toString() },
            { label: "Speed", value: Math.round(stats.movement.acceleration.normal).toString() },
            { label: "Fire rate", value: stats.weapon.rate.toString() },
        ]
    })
}

export default function ShipSelect() {
    const phase = useGameStore((s) => s.phase)
    const activeIndex = useGameStore((s) => s.clientPlayerShipIndex)

    const statLines = useMemo(() => getShipStatLines(), [])

    const isSetup = phase === PipPipGamePhase.SETUP

    const select = (index: number) => {
        if (!isSetup) return
        GAME_CONTEXT.setShip(index)
    }

    const containerClasses = [styles.shipSelect]
    if (!isSetup) containerClasses.push(styles.disabled)

    return (
        <div className={containerClasses.join(" ")}>
            <div className={styles.grid}>
                {PIP_SHIPS.map((ship, index) => {
                    const cardClasses = [styles.card]
                    if (index === activeIndex) cardClasses.push(styles.active)
                    return (
                        <div
                            key={ship.id}
                            className={cardClasses.join(" ")}
                            onClick={() => select(index)}
                        >
                            <div className={styles.preview}>
                                <img src={shipAssets[ship.texture as keyof typeof shipAssets]} alt={ship.name} />
                            </div>
                            <div className={styles.name}>{ship.name}</div>
                            <div className={styles.description}>{ship.description}</div>
                            <div className={styles.stats}>
                                {statLines[index].map((stat) => (
                                    <div key={stat.label} className={styles.stat}>
                                        <span className={styles.statLabel}>{stat.label}</span>
                                        <span className={styles.statValue}>{stat.value}</span>
                                    </div>
                                ))}
                            </div>
                            {index === activeIndex && <div className={styles.selectedTag}>Selected</div>}
                        </div>
                    )
                })}
            </div>
            {!isSetup && (
                <div className={styles.hint}>Ships can only be changed in the lobby.</div>
            )}
        </div>
    )
}
