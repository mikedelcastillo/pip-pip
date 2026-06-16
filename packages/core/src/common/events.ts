import { Concrete } from "../lib/types"

export type EventMap = Record<string, any>
export type EventKey<T extends EventMap> = string & keyof T
export type EventCallback<T> = (params: T) => void
export type EventUndefinedParam<T> = undefined extends T ? [param?: T] : [param: T]

export type EventNameParameter<T extends EventMap> = {
    [K in keyof T]?: T[K] extends undefined ? EmptyEventParams : T[K]
}

export class EmptyEventParams{}

export type EventMapOf<T> = T extends EventEmitter<infer R> ? R : never

export type EventCallbackOf<T extends EventMap, K extends keyof T> = EventCallback<T[K]>

export type EventEmitterSubscriptionCallback<T extends EventMap> = (event: EventNameParameter<T>) => void

export class EventEmitter<T extends EventMap  = Record<string, never>>{
    name: string
    private listeners: {
        [K in keyof T]?: Array<(params: T[K]) => void>;
    } = {}
    private subscribers: EventEmitterSubscriptionCallback<T>[] = []


    constructor(name = "EVENT_EMITTER"){
        this.name = name
    }

    on<K extends keyof T>(eventName: K, callback: EventCallback<T[K]>): void{
        this.listeners[eventName] = (this.listeners[eventName] || []).concat(callback)
    }

    off<K extends keyof T>(eventName: K, callback: EventCallback<T[K]>): void{
        this.listeners[eventName] = (this.listeners[eventName] || []).filter(f => f !== callback)
    }

    once<K extends keyof T>(eventName: K, callback: EventCallback<T[K]>){
        const temporaryCallback: typeof callback = (params) => {
            callback(params)
            this.off(eventName, temporaryCallback)
        }
        this.on(eventName, temporaryCallback)
        return () => {
            this.off(eventName, temporaryCallback)
        }
    }

    emit<K extends keyof T>(eventName: K, ...params: EventUndefinedParam<T[K]>): void {
        if(typeof process !== "undefined" && typeof process.env !== "undefined"){
            if(typeof process.env.DEBUG_HRZN_EVENTS !== "undefined"){
                console.log(new Date().toISOString(), `[${this.name}] eventName: ${eventName.toString()}` + 
                    (params[0] ? `, params: ${params}` : ""))
            }
        }

        for(const callback of this.listeners[eventName] || []){
            callback(params[0] as T[K])
        }
        
        const event = {
            [eventName]: typeof params[0] === "undefined" ? new EmptyEventParams() : params[0],
        } as EventNameParameter<T>

        for(const subscriberCallback of this.subscribers){
            subscriberCallback(event)
        }
    }

    subscribe(callback: EventEmitterSubscriptionCallback<T>){
        this.subscribers.push(callback)
    }

    unsubscribe(callback: EventEmitterSubscriptionCallback<T>){
        this.subscribers = this.subscribers.filter(sub => sub !== callback)
    }

    destroy(){
        this.listeners = {}
    }
}

export type EventCollectorEventMap<T extends EventMap> = {
    collect: {
        event: EventNameParameter<T>,
    },
}

export class EventCollector<T extends EventMap> extends EventEmitter<EventCollectorEventMap<T>>{
    pool: EventNameParameter<T>[] = []
    emitter: EventEmitter<T>
    limit: Array<keyof T>

    constructor(emitter: EventEmitter<T>, limit: Array<keyof T> = [], id = "Collector"){
        super(id)
        this.emitter = emitter
        this.limit = limit
        buildEventCollector(this)
    }

    filter<K extends keyof T>(eventName: K){
        const pool = (this.limit.length === 1 && this.limit[0] === eventName) ? this.pool : 
            this.pool.filter(event => typeof event[eventName] !== "undefined")
        return pool as Concrete<EventNameParameter<{ [O in K]: T[O] }>>[]
    }

    flush(){
        this.pool = []
    }
}

export interface EventCollector<T extends EventMap> extends EventEmitter<EventCollectorEventMap<T>>{
    collect: (event: EventNameParameter<T>) => void
    destroy: () => void
}

function buildEventCollector<T extends EventMap>(collector: EventCollector<T>){
    collector.collect = (event: EventNameParameter<T>) => {
        const callback = () => {
            collector.pool.push(event)
            collector.emit("collect", { event })
        }
        if(collector.limit.length === 0){
            callback()
        } else{
            const eventName = Object.keys(event)[0]
            if(collector.limit.includes(eventName)){
                callback()
            }
        }
    }

    collector.emitter.subscribe(collector.collect)

    collector.destroy = () => {
        collector.emitter.unsubscribe(collector.collect)
    }
}