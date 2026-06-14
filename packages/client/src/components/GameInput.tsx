import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"
import styles from "./GameInput.module.sass"

export interface GameInputHandle {
    focus: () => void
    input: HTMLInputElement | null
}

interface Props {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    type?: string
    // A form-field name/id so the input is not flagged by accessibility checks
    // for missing id/name. Defaults to a generic value; callers can pass a more
    // specific one (e.g. "lobby-code", "chat").
    name?: string
    onEnter?: () => void
    onUp?: () => void
    onFocus?: () => void
    onBlur?: () => void
    className?: string
    // Hard cap on input length (e.g. a player name); forwarded to the <input>.
    maxLength?: number
}

const GameInput = forwardRef<GameInputHandle, Props>(function GameInput({
    value, onChange, placeholder = "", type = "text", name = "text-field",
    onEnter, onUp, onFocus, onBlur, className, maxLength,
}, ref) {
    const inputRef = useRef<HTMLInputElement>(null)

    useImperativeHandle(ref, () => ({
        focus: () => inputRef.current?.focus(),
        get input() { return inputRef.current },
    }), [])

    useEffect(() => {
        const input = inputRef.current
        if (!input) return

        const handleFocus = () => onFocus?.()
        const handleBlur = () => onBlur?.()
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.code === "Escape") {
                input.blur()
                e.preventDefault()
            }
            if (e.code === "Enter") {
                onEnter?.()
                e.preventDefault()
            }
            if (e.code === "Up") {
                onUp?.()
                e.preventDefault()
            }
        }
        const handleBodyClick = (e: MouseEvent) => {
            if (e.target !== input) {
                input.blur()
            }
        }

        input.addEventListener("focus", handleFocus)
        input.addEventListener("blur", handleBlur)
        input.addEventListener("keyup", handleKeyUp)
        document.body.addEventListener("click", handleBodyClick)

        return () => {
            input.removeEventListener("focus", handleFocus)
            input.removeEventListener("blur", handleBlur)
            input.removeEventListener("keyup", handleKeyUp)
            document.body.removeEventListener("click", handleBodyClick)
        }
    }, [onFocus, onBlur, onEnter, onUp])

    const rootClass = [styles.input]
    if (className) rootClass.push(className)

    return (
        <div className={rootClass.join(" ")}>
            <input
                ref={inputRef}
                type={type}
                name={name}
                id={name}
                autoComplete="off"
                value={value}
                placeholder={placeholder}
                maxLength={maxLength}
                onChange={(e) => onChange(e.target.value)}
                onClick={() => inputRef.current?.focus()}
            />
        </div>
    )
})

export default GameInput
