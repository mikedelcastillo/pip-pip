import { useMemo, useState, useEffect } from "react"
import { GAME_CONTEXT } from "../game"
import { useGameStore } from "../game/store"
import GameButton from "./GameButton"
import GamePlayerList from "./GamePlayerList"
import GameChat from "./GameChat"
import ShipSelect from "./ShipSelect"
import MapSelect from "./MapSelect"
import AudioVolumeToggle from "./AudioVolumeToggle"
import audioStyles from "./AudioVolumeToggle.module.sass"
import styles from "./GameOverlaySetup.module.sass"

type SetupTab = {
    id: string,
    name: string,
    notifCount?: string,
    show?: boolean,
}

export default function GameOverlaySetup() {
    const isHost = useGameStore((s) => s.isHost)
    const playerCount = useGameStore((s) => s.players.length)
    const [activeIndex, setActiveIndex] = useState(0)

    const displayTabs = useMemo<SetupTab[]>(() => {
        const tabs: SetupTab[] = []
        if (isHost) tabs.push({ id: "host", name: "Host" })
        tabs.push({ id: "ship", name: "Ship" })
        tabs.push({ id: "map", name: "Map" })
        tabs.push({ id: "players", name: "Players", notifCount: playerCount.toString() })
        return tabs
    }, [isHost, playerCount])

    useEffect(() => {
        if (activeIndex >= displayTabs.length) setActiveIndex(0)
    }, [displayTabs.length, activeIndex])

    const displayTab = displayTabs[activeIndex] ?? displayTabs[0]

    const startGame = () => GAME_CONTEXT.startGame()

    return (
        <div className="game-overlay">
            <AudioVolumeToggle className={audioStyles.corner} />
            <div className={styles.overlayContainer}>
                <div className={styles.setupContainer}>
                    <div className={styles.setupTabsNav}>
                        {displayTabs.map((tab, index) => (
                            <div
                                key={tab.id}
                                className={`${styles.setupTabNav} ${activeIndex === index ? styles.active : ""}`}
                                onClick={() => setActiveIndex(index)}
                            >
                                <div className={styles.text}>{tab.name}</div>
                                {typeof tab.notifCount !== "undefined" && (
                                    <div className={styles.notif}>{tab.notifCount}</div>
                                )}
                            </div>
                        ))}
                    </div>

                    {displayTab?.id === "host" && (
                        <div className={styles.setupTab}>
                            {isHost && <GameButton onClick={startGame}>Start Game</GameButton>}
                        </div>
                    )}

                    {displayTab?.id === "ship" && (
                        <div className={`${styles.setupTab} ${styles.ship}`}>
                            <ShipSelect />
                        </div>
                    )}

                    {displayTab?.id === "map" && (
                        <div className={`${styles.setupTab} ${styles.map}`}>
                            <MapSelect />
                        </div>
                    )}

                    {displayTab?.id === "players" && (
                        <div className={`${styles.setupTab} ${styles.players}`}>
                            <GamePlayerList />
                        </div>
                    )}
                </div>
                <GameChat />
            </div>
        </div>
    )
}
