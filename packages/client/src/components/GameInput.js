import { jsx as _jsx } from "react/jsx-runtime";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import styles from "./GameInput.module.sass";
const GameInput = forwardRef(function GameInput({ value, onChange, placeholder = "", type = "text", onEnter, onUp, onFocus, onBlur, className, }, ref) {
    const inputRef = useRef(null);
    useImperativeHandle(ref, () => ({
        focus: () => inputRef.current?.focus(),
        get input() { return inputRef.current; },
    }), []);
    useEffect(() => {
        const input = inputRef.current;
        if (!input)
            return;
        const handleFocus = () => onFocus?.();
        const handleBlur = () => onBlur?.();
        const handleKeyUp = (e) => {
            if (e.code === "Escape") {
                input.blur();
                e.preventDefault();
            }
            if (e.code === "Enter") {
                onEnter?.();
                e.preventDefault();
            }
            if (e.code === "Up") {
                onUp?.();
                e.preventDefault();
            }
        };
        const handleBodyClick = (e) => {
            if (e.target !== input) {
                input.blur();
            }
        };
        input.addEventListener("focus", handleFocus);
        input.addEventListener("blur", handleBlur);
        input.addEventListener("keyup", handleKeyUp);
        document.body.addEventListener("click", handleBodyClick);
        return () => {
            input.removeEventListener("focus", handleFocus);
            input.removeEventListener("blur", handleBlur);
            input.removeEventListener("keyup", handleKeyUp);
            document.body.removeEventListener("click", handleBodyClick);
        };
    }, [onFocus, onBlur, onEnter, onUp]);
    const rootClass = [styles.input];
    if (className)
        rootClass.push(className);
    return (_jsx("div", { className: rootClass.join(" "), children: _jsx("input", { ref: inputRef, type: type, value: value, placeholder: placeholder, onChange: (e) => onChange(e.target.value), onClick: () => inputRef.current?.focus() }) }));
});
export default GameInput;
//# sourceMappingURL=GameInput.js.map