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
    private boundBlurHandler = this.clearHeld.bind(this)
    private boundVisibilityHandler = this.visibilityHandler.bind(this)

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

    // Clear every held key. A keyup that happens while the window is blurred
    // (Alt+Tab / Cmd+Tab / OS focus theft) is delivered to the OTHER application,
    // so this listener never sees it and the key would stay "down" forever -
    // driving movement/fire in the authoritative sim while the player is away.
    // Resetting on blur (and when the tab is hidden) prevents that stuck input.
    clearHeld(){
        this.state = {}
        this.emit("blur", undefined)
    }

    visibilityHandler(){
        if(typeof document !== "undefined" && document.hidden) this.clearHeld()
    }

    setTarget(element: HTMLElement){
        this.destroy()
        this.element = element
        this.element.addEventListener("keydown", this.boundDownHandler)
        window.addEventListener("keyup", this.boundUpHandler)
        window.addEventListener("blur", this.boundBlurHandler)
        if(typeof document !== "undefined"){
            document.addEventListener("visibilitychange", this.boundVisibilityHandler)
        }
    }

    destroy(){
        super.destroy()
        if(typeof this.element !== "undefined"){
            this.element.removeEventListener("keydown", this.boundDownHandler)
            window.removeEventListener("keyup", this.boundUpHandler)
            window.removeEventListener("blur", this.boundBlurHandler)
            if(typeof document !== "undefined"){
                document.removeEventListener("visibilitychange", this.boundVisibilityHandler)
            }
        }
    }
}