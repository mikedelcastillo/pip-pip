export function generateId(length = 4, reference?: string[]){
    const pool = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMOPQRSTUVWXYZ"
    const getRandom = () => Array(length).fill(null).map(() => pool[Math.floor(Math.random()*pool.length)]).join("")
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