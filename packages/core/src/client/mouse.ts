import { EventEmitter } from "../common/events"

export type MousePosition = { x: number, y: number }

export type MouseButtonState = {
    down: boolean,
    dragging: boolean,
    target: undefined | null | HTMLElement | EventTarget,
}

export type MouseState = {
    left: MouseButtonState,
    middle: MouseButtonState,
    right: MouseButtonState,
    position: MousePosition & {
        previous: MousePosition,
    },
    // Accumulated wheel delta since a consumer last drained it. wheelHandler adds
    // each WheelEvent's deltaX/deltaY here; a reader (e.g. processInputs) checks
    // the sign to detect a scroll this frame, then zeroes it via consumeWheel().
    // Kept additive so existing position/button readers are untouched.
    wheel: MousePosition,
}

export type MouseListenerEventMap = {
    down: MouseState,
    up: MouseState,
    move: MouseState,
    dragStart: MouseState,
    dragEnd: MouseState,

    leftDown: MouseState,
    leftUp: MouseState,
    leftDragStart: MouseState,
    leftDragEnd: MouseState,

    middleDown: MouseState,
    middleUp: MouseState,
    middleDragStart: MouseState,
    middleDragEnd: MouseState,

    rightDown: MouseState,
    rightUp: MouseState,
    rightDragStart: MouseState,
    rightDragEnd: MouseState,

    wheel: {
        state: MouseState,
        x: number,
        y: number,
    },

    blur: undefined,
    focus: undefined,
}

export class MouseListener extends EventEmitter<MouseListenerEventMap>{
    id: string
    element!: HTMLElement
    state: MouseState = {
        left: {
            down: false,
            dragging: false,
            target: null,
        },
        middle: {
            down: false,
            dragging: false,
            target: null,
        },
        right: {
            down: false,
            dragging: false,
            target: null,
        },
        position: {
            x: 0,
            y: 0,
            previous: {
                x: 0,
                y: 0,
            },
        },
        wheel: {
            x: 0,
            y: 0,
        },
    }

    // Bound once so addEventListener and removeEventListener share the identical
    // function reference — `.bind()` returns a new function each call, so binding
    // inline would make removeEventListener a no-op and leak the listener on
    // every setTarget/destroy cycle.
    private boundMouseHandler = this.mouseHandler.bind(this)
    private boundPreventHandler = this.preventHandler.bind(this)
    private boundWheelHandler = this.wheelHandler.bind(this)
    private boundBlurHandler = this.clearHeld.bind(this)
    private boundVisibilityHandler = this.visibilityHandler.bind(this)

    constructor(id = "Mouse"){
        super(id)
        this.id = id
    }

    preventHandler(e: Event){
        e.preventDefault()
    }

    wheelHandler(e: WheelEvent){
        // Accumulate the delta so a per-tick reader can see a scroll that landed
        // between ticks (the event may fire many times per frame). Drained by
        // consumeWheel() once read.
        this.state.wheel.x += e.deltaX
        this.state.wheel.y += e.deltaY
        this.emit("wheel", {
            state: this.state,
            x: e.deltaX,
            y: e.deltaY,
        })
        this.preventHandler(e)
    }

    // Read and clear the accumulated wheel delta. Returns the deltas built up
    // since the last call so a momentary "wheel up/down" trigger is seen exactly
    // once on the tick the scroll happened.
    consumeWheel(): MousePosition {
        const x = this.state.wheel.x
        const y = this.state.wheel.y
        this.state.wheel.x = 0
        this.state.wheel.y = 0
        return { x, y }
    }
    
    // Release every held button. A mouseup that happens while the window is
    // blurred (Alt+Tab / Cmd+Tab / OS focus theft) goes to the OTHER application,
    // so this listener never sees it and a held button would stay "down" forever -
    // firing in the authoritative sim while the player is away. Resetting on blur
    // (and when the tab is hidden) prevents that stuck input.
    clearHeld(){
        for(const button of [this.state.left, this.state.middle, this.state.right]){
            button.down = false
            button.dragging = false
        }
        this.emit("blur", undefined)
    }

    visibilityHandler(){
        if(typeof document !== "undefined" && document.hidden) this.clearHeld()
    }

    mouseHandler(e: MouseEvent){
        // Ignore inputs
        const t = e.target as HTMLElement
        if(t.tagName === "INPUT" || t.tagName === "TEXTAREA"){
            return
        }

        if(e.type === "mousedown"){
            if(e.button === 0){
                this.state.left.down = true
                this.state.left.dragging = false
                this.state.left.target = e.target
                this.emit("down", this.state)
                this.emit("leftDown", this.state)
            }
            if(e.button === 1){
                this.state.middle.down = true
                this.state.middle.dragging = false
                this.state.middle.target = e.target
                this.emit("down", this.state)
                this.emit("middleDown", this.state)
            }
            if(e.button === 2){
                this.state.right.down = true
                this.state.right.dragging = false
                this.state.right.target = e.target
                this.emit("down", this.state)
                this.emit("rightDown", this.state)
            }
        }
        
        if(e.type === "mousemove"){
            this.emit("move", this.state)
            if(this.state.left.down === true && this.state.left.dragging === false){
                this.state.left.dragging = true
                this.emit("dragStart", this.state)
                this.emit("leftDragStart", this.state)
            }
            if(this.state.middle.down === true && this.state.middle.dragging === false){
                this.state.middle.dragging = true
                this.emit("dragStart", this.state)
                this.emit("middleDragStart", this.state)
            }
            if(this.state.right.down === true && this.state.right.dragging === false){
                this.state.right.dragging = true
                this.emit("dragStart", this.state)
                this.emit("rightDragStart", this.state)
            }
        }

        if(e.type === "mouseup"){
            if(e.button === 0){
                this.state.left.down = false
                this.emit("up", this.state)
                this.emit("leftUp", this.state)
                if(this.state.left.dragging === true){
                    this.state.left.dragging = false
                    this.emit("dragEnd", this.state)
                    this.emit("leftDragEnd", this.state)
                }
            }
            if(e.button === 1){
                this.state.middle.down = false
                this.emit("up", this.state)
                this.emit("middleUp", this.state)
                if(this.state.middle.dragging === true){
                    this.state.middle.dragging = false
                    this.emit("dragEnd", this.state)
                    this.emit("middleDragEnd", this.state)
                }
            }
            if(e.button === 2){
                this.state.right.down = false
                this.emit("up", this.state)
                this.emit("rightUp", this.state)
                if(this.state.right.dragging === true){
                    this.state.right.dragging = false
                    this.emit("dragEnd", this.state)
                    this.emit("rightDragEnd", this.state)
                }
            }
        }

        const x = e.x
        const y = e.y

        this.state.position.previous.x = this.state.position.x
        this.state.position.previous.y = this.state.position.y

        this.state.position.x = x
        this.state.position.y = y

        this.preventHandler(e)
    }

    setTarget(element: HTMLElement){
        this.destroy()
        this.element = element
        this.element.addEventListener("mousedown", this.boundMouseHandler)
        this.element.addEventListener("mousemove", this.boundMouseHandler)
        this.element.addEventListener("contextmenu", this.boundPreventHandler)
        this.element.addEventListener("wheel", this.boundWheelHandler)
        window.addEventListener("mouseup", this.boundMouseHandler)
        window.addEventListener("blur", this.boundBlurHandler)
        if(typeof document !== "undefined"){
            document.addEventListener("visibilitychange", this.boundVisibilityHandler)
        }
    }

    destroy(){
        super.destroy()
        if(typeof this.element !== "undefined"){
            this.element.removeEventListener("mousedown", this.boundMouseHandler)
            this.element.removeEventListener("mousemove", this.boundMouseHandler)
            this.element.removeEventListener("contextmenu", this.boundPreventHandler)
            this.element.removeEventListener("wheel", this.boundWheelHandler)
            window.removeEventListener("mouseup", this.boundMouseHandler)
            window.removeEventListener("blur", this.boundBlurHandler)
            if(typeof document !== "undefined"){
                document.removeEventListener("visibilitychange", this.boundVisibilityHandler)
            }
        }
    }
}