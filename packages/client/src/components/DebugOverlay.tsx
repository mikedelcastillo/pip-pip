import { useEffect, useState } from "react"
import { PipPipGamePhase } from "@pip-pip/game/src/logic"
import { GAME_CONTEXT } from "../game"
import styles from "./DebugOverlay.module.sass"

// How often the panel re-reads live game state. A lightweight 4Hz snapshot
// rather than a per-frame subscription — the game runs at 20Hz update / 60Hz
// render, and tying this to the tick would force React renders every frame.
const REFRESH_MS = 250

// Backquote (the `~ key, left of 1) toggles the panel. It is not bound to any
// gameplay input, so it never clashes with movement/fire/reload during play.
const TOGGLE_CODE = "Backquote"

// Human-readable phase names indexed by the PipPipGamePhase enum value.
const PHASE_NAMES: Record<number, string> = {
    [PipPipGamePhase.SETUP]: "SETUP",
    [PipPipGamePhase.COUNTDOWN]: "COUNTDOWN",
    [PipPipGamePhase.MATCH]: "MATCH",
    [PipPipGamePhase.RESULTS]: "RESULTS",
}

type RemoteRow = {
    id: string,
    name: string,
    ping: number,
    spawned: boolean,
    snapshots: number,
}

type DebugSnapshot = {
    tick: number,
    phase: string,
    map: string,
    playerCount: number,
    activeBullets: number,
    fps: number,
    tps: number,
    local?: {
        id: string,
        ping: number,
        posX: number,
        posY: number,
        velX: number,
        velY: number,
        errX: number,
        errY: number,
        predicted: number,
        snapshots: number,
        spawned: boolean,
        health: number,
        healthMax: number,
        ammo: number,
        ammoMax: number,
        reloading: boolean,
    },
    remotes: RemoteRow[],
}

// Read a complete snapshot straight from GAME_CONTEXT.game (authoritative live
// values) plus the tickers' measured rates. Defensive throughout — the game can
// be mid-mount/unmount when the interval fires.
function readSnapshot(): DebugSnapshot {
    const ctx = GAME_CONTEXT
    const game = ctx.game

    const empty: DebugSnapshot = {
        tick: 0, phase: "-", map: "-", playerCount: 0, activeBullets: 0,
        fps: 0, tps: 0, remotes: [],
    }

    if (typeof game === "undefined") return empty

    // Tickers expose getPerformance().averageTPS — render ticker → FPS, update
    // ticker → TPS. Both are derived from measured Date.now() deltas.
    const fps = ctx.renderTick ? ctx.renderTick.getPerformance().averageTPS : 0
    const tps = ctx.updateTick ? ctx.updateTick.getPerformance().averageTPS : 0

    const players = Object.values(game.players)
    const localId = game.clientPlayerId
    const localPlayer = localId in game.players ? game.players[localId] : undefined

    const snapshot: DebugSnapshot = {
        tick: game.tickNumber,
        phase: PHASE_NAMES[game.phase] ?? String(game.phase),
        map: game.mapType ? game.mapType.name : "-",
        playerCount: players.length,
        activeBullets: game.bullets.getActive().length,
        fps: Math.round(fps),
        tps: Math.round(tps),
        remotes: [],
    }

    if (typeof localPlayer !== "undefined") {
        const phys = localPlayer.ship.physics
        snapshot.local = {
            id: localPlayer.id,
            ping: localPlayer.ping,
            posX: Math.round(phys.position.x),
            posY: Math.round(phys.position.y),
            velX: Math.round(phys.velocity.x * 100) / 100,
            velY: Math.round(phys.velocity.y * 100) / 100,
            errX: Math.round(localPlayer.renderError.x * 100) / 100,
            errY: Math.round(localPlayer.renderError.y * 100) / 100,
            predicted: localPlayer.predictedStates.length,
            snapshots: localPlayer.snapshots.length,
            spawned: localPlayer.spawned,
            health: Math.ceil(localPlayer.ship.capacities.health),
            healthMax: localPlayer.ship.maxHealth,
            ammo: localPlayer.ship.capacities.weapon,
            ammoMax: localPlayer.ship.stats.weapon.capacity,
            reloading: localPlayer.ship.isReloading,
        }
    }

    for (const player of players) {
        if (player.id === localId) continue
        snapshot.remotes.push({
            id: player.id,
            name: player.name,
            ping: player.ping,
            spawned: player.spawned,
            snapshots: player.snapshots.length,
        })
    }

    return snapshot
}

export default function DebugOverlay() {
    const [visible, setVisible] = useState(false)
    const [data, setData] = useState<DebugSnapshot | null>(null)

    // Toggle on the backquote key. Bound to window directly so it works
    // regardless of focus and independent of the game's keyboard listener.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.code === TOGGLE_CODE) {
                e.preventDefault()
                setVisible((v) => !v)
            }
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [])

    // Snapshot live values on a 4Hz interval — only while visible, so a hidden
    // panel costs nothing and the open panel never adds per-frame React churn.
    useEffect(() => {
        if (!visible) return
        setData(readSnapshot())
        const interval = setInterval(() => setData(readSnapshot()), REFRESH_MS)
        return () => clearInterval(interval)
    }, [visible])

    if (!visible || data === null) return null

    const local = data.local

    return (
        <div className={styles.root}>
            <div className={styles.title}>DEBUG ` to hide</div>

            <div className={styles.section}>
                <Row label="tick" value={String(data.tick)} />
                <Row label="phase" value={data.phase} />
                <Row label="map" value={data.map} />
                <Row label="players" value={String(data.playerCount)} />
                <Row label="bullets" value={String(data.activeBullets)} />
                <Row label="fps" value={String(data.fps)} />
                <Row label="tps" value={String(data.tps)} />
            </div>

            <div className={styles.heading}>LOCAL</div>
            <div className={styles.section}>
                {typeof local === "undefined" ? (
                    <div className={styles.muted}>no local player</div>
                ) : (
                    <>
                        <Row label="id" value={local.id} />
                        <Row label="ping" value={`${local.ping}ms`} />
                        <Row label="pos" value={`${local.posX}, ${local.posY}`} />
                        <Row label="vel" value={`${local.velX}, ${local.velY}`} />
                        <Row label="error" value={`${local.errX}, ${local.errY}`} />
                        <Row label="predicted" value={String(local.predicted)} />
                        <Row label="snapshots" value={String(local.snapshots)} />
                        <Row label="spawned" value={local.spawned ? "yes" : "no"} />
                        <Row label="health" value={`${local.health} / ${local.healthMax}`} />
                        <Row
                            label="ammo"
                            value={local.reloading
                                ? "RELOADING"
                                : `${local.ammo} / ${local.ammoMax}`}
                        />
                    </>
                )}
            </div>

            <div className={styles.heading}>REMOTES ({data.remotes.length})</div>
            <div className={styles.section}>
                {data.remotes.length === 0 ? (
                    <div className={styles.muted}>none</div>
                ) : (
                    data.remotes.map((p) => (
                        <div key={p.id} className={styles.remote}>
                            <span className={styles.remoteId}>{p.id}</span>
                            <span className={styles.remoteName}>{p.name}</span>
                            <span>{p.ping}ms</span>
                            <span className={p.spawned ? styles.alive : styles.dead}>
                                {p.spawned ? "alive" : "dead"}
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}

function Row({ label, value }: { label: string, value: string }) {
    return (
        <div className={styles.row}>
            <span className={styles.label}>{label}</span>
            <span className={styles.value}>{value}</span>
        </div>
    )
}
