import { EventEmitter } from "./events"

export type TickerEventMap = {
    tick: { deltaMs: number, deltaTime: number },
    start: undefined,
    stop: undefined,
}

export class Ticker extends EventEmitter<TickerEventMap>{
    tps = 20
    useRequestAnimationFrame = false
    lastUpdate = Date.now()
    ticking = false
    tickInterval?: ReturnType<typeof setInterval>

    deltaMsLog: number[] = []
    executionTimes: number[] = []
    maxLogs = 12

    constructor(tps = 20, useRaf = false, tickerId = "Ticker"){
        super(tickerId)
        this.setTps(tps, useRaf)
    }

    setTps(tps: number, useRaf = false){
        let restart = false
        if(this.ticking){
            restart = true
            this.stopTick()
        }

        this.tps = tps
        this.useRequestAnimationFrame = useRaf
        
        if(restart){
            this.startTick()
        }
    }

    tick(){
        const now = Date.now()
        const targetDeltaMs = 1000 / this.tps
        const deltaMs = now - this.lastUpdate
        const deltaTime = deltaMs / targetDeltaMs
        this.emit("tick", { deltaMs, deltaTime })
        const executionTime = Date.now() - now
        if(this.executionTimes.length > this.maxLogs){
            this.executionTimes.shift()
        }
        if(this.deltaMsLog.length > this.maxLogs){
            this.deltaMsLog.shift()
        }
        this.executionTimes.push(executionTime)
        this.deltaMsLog.push(deltaMs)
        this.lastUpdate = now
    }

    getPerformance(){
        let deltaMsSum = 0
        let executionTimesSum = 0
        for(const deltaMs of this.deltaMsLog){
            deltaMsSum += deltaMs
        }
        for(const execTime of this.executionTimes){
            executionTimesSum += execTime
        }
        const averageExecutionTime = executionTimesSum / Math.max(1, this.executionTimes.length)
        const averageDeltaMs = deltaMsSum / Math.max(1, this.deltaMsLog.length)
        const averageTPS = 1000 / averageDeltaMs
        const averageDeltaTime = averageDeltaMs / (1000 / this.tps)

        return {
            averageExecutionTime,
            averageDeltaMs,
            averageTPS,
            averageDeltaTime,
        }
    }

    startTick(){
        this.stopTick()
        this.lastUpdate = Date.now() - 1000 / this.tps
        this.ticking = true
        if(this.useRequestAnimationFrame && typeof requestAnimationFrame !== "undefined"){
            const loop = () => {
                if(this.ticking){
                    requestAnimationFrame(loop)
                    this.tick()
                }
            }
            loop()
        } else{
            this.tickInterval = setInterval(() => {
                this.tick()
            }, 1000 / this.tps)
        }
        this.emit("start")
    }

    stopTick(){
        if(this.ticking){
            if(typeof this.tickInterval !== "undefined"){
                clearInterval(this.tickInterval)
            }
            this.ticking = false
            this.emit("stop")
        }
    }

    destroy() {
        super.destroy()
        this.stopTick()
    }
}