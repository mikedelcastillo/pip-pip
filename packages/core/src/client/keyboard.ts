import { EventEmitter } from "../common/events"

export type KeyboardListenerEvent = {
    key: string,
}

export type KeyboardListenerEventMap = {
    down: KeyboardListenerEvent,
    up: KeyboardListenerEvent,
    blur: undefined,
    focus: undefined,
}

export class KeyboardListener extends EventEmitter<KeyboardListenerEventMap>{
    id: string
    element!: HTMLElement
    state: Record<string, boolean> = {}

    // Bound once in the constructor so addEventListener and removeEventListener
    // share the identical function reference — `.bind()` returns a new function
    // each call, so binding inline would make removeEventListener a no-op and
    // leak the listener on every setTarget/destroy cycle.
    private boundDownHandler = this.downHandler.bind(this)
    private boundUpHandler = this.upHandler.bind(this)

    constructor(id = "Keyboard"){
        super(id)
        this.id = id
    }

    downHandler(e: KeyboardEvent){
        if(e.target !== this.element) return
        this.setState(e.code, true)
        this.emit("down", {
            key: e.code,
        })
        e.preventDefault()
    }

    upHandler(e: KeyboardEvent){
        this.setState(e.code, false)
        this.emit("up", {
            key: e.code,
        })
        e.preventDefault()
    }

    setState(id: string, state: boolean){
        this.state[id] = state
    }

    setTarget(element: HTMLElement){
        this.destroy()
        this.element = element
        this.element.addEventListener("keydown", this.boundDownHandler)
        window.addEventListener("keyup", this.boundUpHandler)
    }

    destroy(){
        super.destroy()
        if(typeof this.element !== "undefined"){
            this.element.removeEventListener("keydown", this.boundDownHandler)
            window.removeEventListener("keyup", this.boundUpHandler)
        }
    }
}