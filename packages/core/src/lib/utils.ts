// Unbiased index in [0, max) drawn from a CSPRNG. Tokens (connection/websocket)
// are security-sensitive, so they must not be predictable from Math.random's
// weak, seedable PRNG. We use the Web Crypto API (`crypto.getRandomValues`),
// which is a global in both Node >= 20 and browsers — so this stays isomorphic
// and the browser bundle pulls in no node `crypto` module. Only when no
// webcrypto is exposed at all do we fall back to Math.random, so the function
// still works rather than throwing. Rejection sampling keeps the distribution
// flat (a plain `% max` over uint32 would bias the low indices for max=60).
function randomIndex(max: number){
    const webcrypto = (globalThis as unknown as {
        crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array },
    }).crypto
    if(typeof webcrypto?.getRandomValues === "function"){
        const limit = Math.floor(0x100000000 / max) * max
        const buf = new Uint32Array(1)
        let value = 0
        do{
            webcrypto.getRandomValues(buf)
            value = buf[0]
        } while(value >= limit)
        return value % max
    }
    // Last resort: no CSPRNG available at all.
    return Math.floor(Math.random() * max)
}

export function generateId(length = 4, reference?: string[]){
    const pool = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMOPQRSTUVWXYZ"
    const getRandom = () => Array(length).fill(null).map(() => pool[randomIndex(pool.length)]).join("")
    if(typeof reference === "undefined") return getRandom()
    if(reference.length >= Math.pow(pool.length, length)) throw new Error("No unique ID permutations left.")
    let output = getRandom()
    while(reference.includes(output)) output = getRandom()
    return output
}

export function getKeyDuplicates(...args: Record<string, unknown>[]){
    const keys = args.map(obj => Object.keys(obj))
    const keysUnion = keys.flat()
    const keysSet: string[] = []
    const duplicates: string[] = []

    for(const key of keysUnion){
        if(duplicates.includes(key)){
            continue
        }
        if(keysSet.includes(key)){
            duplicates.push(key)
            continue
        }
        keysSet.push(key)
    }

    return {
        union: keysUnion,
        set: keysSet,
        duplicates: duplicates,
        hasDuplicates: duplicates.length > 0,
    }
}

export function getLocalStorage(): Storage | undefined{
    if(typeof window === "undefined") return
    if(typeof window.localStorage === "undefined") return
    return window.localStorage
}

export function isObject(variable: any){
    return typeof variable === "object" &&
        variable !== null &&
        !Array.isArray(variable)
}