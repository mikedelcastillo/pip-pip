export const getForceLatency = () => {
    const latency = getForceLatencyAmount()
    const jitter = getForceLatencyJitter()

    if(latency > 0 || jitter > 0){
        const value = Math.floor(Math.max(0, latency + (Math.random() - 0.5) * jitter * 2))
        // console.log(`FORCING LATENCY: ${value.toFixed(2)}ms`)
        return value
    }
    return 0 
}

export const getForceLatencyAmount = () => {
    if(typeof process.env.HRZN_FORCE_LATENCY !== "undefined"){
        const value = Number(process.env.HRZN_FORCE_LATENCY)
        if(!Number.isNaN(value)) return value
    }

    return 0
}

export const getForceLatencyJitter = () => {
    if(typeof process.env.HRZN_FORCE_JITTER !== "undefined"){
        const value = Number(process.env.HRZN_FORCE_JITTER)
        if(!Number.isNaN(value)) return value
    }

    return 0
}

export const getServerPort = (defaultPort: number) => {
    for(const name of ["HRZN_PORT", "PORT"]){
        if(typeof process.env[name] !== "undefined"){
            const value = Number(process.env[name])
            if(!Number.isNaN(value) && value > 0) return value
        }
    }

    return defaultPort
}