import { INTERP_DELAY_TICKS } from "@pip-pip/game/src/logic/constants";
/**
 * Estimates the current authoritative server tick on a shared timeline so the
 * client can interpolate remote players against real server time instead of
 * guessing from round-trip ping.
 *
 * The server prepends one `serverTickHeader` per message. Each sample maps the
 * received tick to the local clock. The offset SNAPS UP to the freshest
 * (lowest-latency) sample so the clock never lags real time, and LEAKS DOWN
 * slowly when latency rises so it tracks a genuine increase instead of
 * drifting ahead of the data forever.
 */
export class ServerClock {
    deltaMs;
    // serverTickNow() === Date.now() / deltaMs + tickOffset
    tickOffset = 0;
    latestTick = 0;
    synced = false;
    // How fast the offset leaks toward a higher-latency reality, per sample.
    static LEAK = 0.02;
    constructor(deltaMs) {
        this.deltaMs = deltaMs;
    }
    get isSynced() { return this.synced; }
    /** Feed an authoritative server tick observed at local time `now`. */
    sync(serverTick, now = Date.now()) {
        const candidate = serverTick - now / this.deltaMs;
        if (this.synced === false) {
            this.tickOffset = candidate;
            this.synced = true;
        }
        else if (candidate > this.tickOffset) {
            this.tickOffset = candidate;
        }
        else {
            this.tickOffset += (candidate - this.tickOffset) * ServerClock.LEAK;
        }
        if (serverTick > this.latestTick)
            this.latestTick = serverTick;
    }
    /** Current estimated server tick (fractional). */
    serverTickNow(now = Date.now()) {
        return now / this.deltaMs + this.tickOffset;
    }
    /**
     * Tick to render remote entities at: a fixed delay behind the estimate so
     * two bracketing snapshots are available, and never past the freshest tick
     * we have actually received (which would force extrapolation).
     */
    renderTick(now = Date.now()) {
        return Math.min(this.serverTickNow(now) - INTERP_DELAY_TICKS, this.latestTick);
    }
}
//# sourceMappingURL=serverClock.js.map