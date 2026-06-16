import { PickRecord, TypeOrFactoryType } from "../lib/types"
import { EventEmitter } from "./events"
import { isObject } from "../lib/utils"

export type StateSnapshot<T> = {
    time: number,
    state: T,
    previousState: T,
    changes: StatePartial<T>,
    deletions: StateBoolean<T>,
}

export type StateEventMap<T> = {
    change: StateSnapshot<T>,
    flush: StateSnapshot<T>,
}

export type StateBoolean<T> = {
    [K in keyof T]?: T[K] extends Record<string, any> ? StateBoolean<T[K]> : boolean
}

export type StatePartial<T> = {
    [K in keyof T]?: T[K] extends Record<string, any> ? StatePartial<T[K]> : T[K]
}

export type StateSchema = Record<string, any>

// TODO: Fix typing
export function getStateChanges<T extends StateSchema>(to: T, from: T){

    function loop<T extends Record<string, unknown>>(to: T, from: T){
        const changes: StatePartial<T> = {}
        const deletions: StateBoolean<T> = {}

        const keys = Array.from(new Set([
            ...Object.keys(to || {}),
            ...Object.keys(from || {}),
        ])) as unknown as Array<keyof T>

        for(const key of keys){
            const toValue = to?.[key]
            const fromValue = from?.[key]

            let changeValue: undefined | typeof toValue
            let deletionValue: undefined | typeof deletions

            // isObject excludes arrays, so an array field falls into the else branch
            // and is compared by reference, NOT deep-diffed. Callers must reuse the
            // same array reference for an unchanged field or it broadcasts every diff.
            const objType = isObject(toValue)
            if(objType){
                const objectChanges = loop(toValue as Record<string, unknown>, fromValue as Record<string, unknown>)
                if(Object.keys(objectChanges.changes).length !== 0){
                    changeValue = objectChanges.changes as typeof toValue
                } 
                if(Object.keys(objectChanges.deletions).length !== 0){
                    deletionValue = objectChanges.deletions as typeof deletionValue
                } 

            } else{
                if(fromValue !== toValue){
                    changeValue = toValue
                }
            }

            if(typeof toValue === "undefined"){
                deletions[key] = true as any
            }

            if(typeof deletionValue !== "undefined"){
                deletions[key] = deletionValue as any
            }

            if(typeof changeValue !== "undefined"){
                changes[key] = changeValue as typeof toValue
            }
        }

        return { changes, deletions }
    }
    
    return loop(to, from)
}


export class State<T extends StateSchema>{
    queueHistory: StateSnapshot<T>[] = []
    history: StateSnapshot<T>[] = []
    initialState: T
    state: T
    events: EventEmitter<StateEventMap<T>> = new EventEmitter("State")
    slowState: T

    constructor(initialState: T){
        this.state = {...initialState}
        this.initialState = {...initialState}
        this.slowState = {...initialState}
    }

    reset(){
        this.setState({
            ...this.initialState,
        })
    }

    flushQueue(){
        const previousState = this.slowState
        const state = this.state
        const { changes, deletions } = getStateChanges(state, previousState)
        const snapshot: StateSnapshot<T> = {
            time: Date.now(),
            state,
            previousState,
            changes, deletions,
        }
        this.slowState = this.state
        this.queueHistory = [snapshot, ...this.queueHistory]
        this.events.emit("flush", snapshot)
    }

    setState(state: T){
        const previousState = this.state
        const { changes, deletions } = getStateChanges(state, previousState)
        const snapshot: StateSnapshot<T> = {
            time: Date.now(),
            state,
            previousState,
            changes, deletions,
        }
        this.state = state
        this.history = [snapshot, ...this.history]
        this.events.emit("change", snapshot)
    }

    get<K extends keyof T>(key: K): T[K]{
        return this.state[key]
    }

    set<K extends keyof T>(key: K, valueOrFactory: TypeOrFactoryType<T[K]>){
        const newValue = valueOrFactory instanceof Function ? 
            valueOrFactory(this.state[key]) : valueOrFactory

        const newState = {
            ...this.state,
            [key]: newValue,
        }
        this.setState(newState)
    }

    setRecord<
        TRecords extends PickRecord<T>, 
        KeyOfRecords extends keyof TRecords, 
        PropOfRecords extends TRecords[KeyOfRecords],
        KeyOfProp extends keyof PropOfRecords,
        PropValue extends PropOfRecords[KeyOfProp],
    >(key: KeyOfRecords, prop: KeyOfProp, valueOrFactory: TypeOrFactoryType<PropValue>){
        type Key = keyof T
        type Value = T[Key]

        const currentValue = this.state[key as Key][prop]
        const newValue = valueOrFactory instanceof Function ? valueOrFactory(currentValue) : valueOrFactory

        const factory = ((obj: Value) => {
            return {
                ...obj,
                [prop]: newValue,
            }
        }) as TypeOrFactoryType<Value>
        this.set(key as Key, factory)
    }

    deleteRecord<
        TRecords extends PickRecord<T>, 
        KeyOfRecords extends keyof TRecords, 
        PropOfRecords extends TRecords[KeyOfRecords],
        KeyOfProp extends keyof PropOfRecords,
    >(key: KeyOfRecords, prop: KeyOfProp){
        type Key = keyof T

        if(key in this.state){
            if(prop in this.state[key as Key]){
                const modified = {...this.state[key as Key]}
                delete modified[prop]
        
                this.set(key as Key, modified)
            }
        }
    }
}
