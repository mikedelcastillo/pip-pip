import { useEffect, useRef, useState } from "react"
import { useGameStore } from "../game/store"
import type { KillEntry } from "../game/store"
import { GAME_CONTEXT } from "../game"
import styles from "./KillStreakBanner.module.sass"

// The rolling window (ms) within which kills must land to chain into a multi-kill.
// Quake's classic spree timer is ~4s, which feels right for this pace: long
// enough to reward chained frags, short enough that unrelated kills never stack.
export const MULTI_KILL_WINDOW_MS = 4000

// How long (ms) the banner stays up after a tier is reached before it fades out.
// Punchy and brief so it celebrates without ever lingering over the combat HUD.
export const BANNER_DURATION_MS = 1800

// One celebratory multi-kill tier: the streak count that triggers it and the
// shout-y label shown on the banner. Escalates Quake/Krunker-style.
export interface MultiKillTier {
    count: number
    label: string
}

// Pure helper: how many kills the LOCAL player landed inside the rolling window
// ending at `now`, mapped to its multi-kill tier (or null below 2). A "kill" is a
// kill-feed entry whose killerName matches localName; SUICIDES (the local name
// also killed) do NOT count - dying to your own grenade is not a frag. Entries
// exactly at the window edge are excluded, mirroring visibleKills' strict age
// check. Kept pure (no store/Date access) so it is trivially unit-testable.
export function currentMultiKill(
    feed: KillEntry[],
    localName: string,
    now: number,
    windowMs = MULTI_KILL_WINDOW_MS,
): MultiKillTier | null {
    // An empty/blank local name (e.g. before the player has joined) can never own
    // a kill, so short-circuit rather than match stray blank killerNames.
    if (localName.length === 0) return null
    let count = 0
    for (const entry of feed) {
        if (entry.killerName !== localName) continue
        // A suicide (killer === killed) is a death, not a frag - never count it.
        if (entry.killerName === entry.killedName) continue
        if (now - entry.time >= windowMs) continue
        count += 1
    }
    return multiKillTier(count)
}

// Pure count-to-tier mapping. Below 2 there is nothing to celebrate (a single
// kill is just a kill), so it returns null. The labels escalate Quake-style:
// 5+ all read "Monster Kill" so a long spree keeps the top tier rather than
// running out of names. Kept pure so it is unit-testable on its own.
export function multiKillTier(count: number): MultiKillTier | null {
    if (count >= 5) return { count, label: "Monster Kill" }
    if (count === 4) return { count, label: "Multi Kill" }
    if (count === 3) return { count, label: "Triple Kill" }
    if (count === 2) return { count, label: "Double Kill" }
    return null
}

// Quake/Krunker-style multi-kill banner for the LOCAL player. Reads the kill feed
// + players from the store (never writes), finds the local name, and flashes a
// celebratory banner whenever the local player's rolling-window streak reaches a
// new, HIGHER tier. The banner is transient: it fades out after BANNER_DURATION_MS
// and only re-triggers when the tier increases (so a 2 -> 3 escalation re-flashes,
// but a 3 holding at 3 does not). Display-only + pointer-events:none so the
// floating touch sticks underneath stay usable on mobile.
export default function KillStreakBanner() {
    const killFeed = useGameStore((s) => s.killFeed)
    const players = useGameStore((s) => s.players)

    // The store re-syncs every tick, so reading Date.now() here gives a fresh
    // window edge on each render without a dedicated timer.
    const now = Date.now()
    const localName = players.find((p) => p.isClient)?.name ?? ""
    const tier = currentMultiKill(killFeed, localName, now)

    // The currently displayed tier + a monotonically rising trigger id. We only
    // (re)show the banner when the live tier's count exceeds the highest count we
    // have already celebrated, so a steady streak does not re-flash every tick.
    const [shown, setShown] = useState<MultiKillTier | null>(null)
    const [trigger, setTrigger] = useState(0)
    const lastCount = useRef(0)

    useEffect(() => {
        const count = tier?.count ?? 0
        if (tier !== null && count > lastCount.current) {
            // A new, higher tier: latch it, bump the trigger so the animation
            // restarts, and play the celebratory "pip" cue (no new audio plumbing).
            lastCount.current = count
            setShown(tier)
            setTrigger((t) => t + 1)
            GAME_CONTEXT.audio.play("pip")
        } else if (count === 0) {
            // The window emptied out (streak expired or feed cleared): reset so the
            // next kill starts a fresh Double Kill rather than chaining the old run.
            lastCount.current = 0
        }
    }, [tier])

    // Auto-hide the banner a short while after each trigger. Keyed on `trigger` so
    // every fresh escalation gets its own full visible window.
    useEffect(() => {
        if (trigger === 0) return
        const handle = setTimeout(() => setShown(null), BANNER_DURATION_MS)
        return () => clearTimeout(handle)
    }, [trigger])

    if (shown === null) return null

    return (
        <div className={styles.banner}>
            {/* Keyed on the trigger so React remounts the node and replays the
                scale+fade-in animation on every escalation, not just the first. */}
            <span key={trigger} className={styles.label}>{shown.label}</span>
        </div>
    )
}
