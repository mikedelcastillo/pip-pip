import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import styles from "./GameButton.module.sass";
export default function GameButton({ children, onClick, accent, className }) {
    const classes = [styles.button];
    if (accent)
        classes.push(styles.accent);
    if (className)
        classes.push(className);
    return (_jsxs("div", { className: classes.join(" "), onClick: onClick, children: [_jsx("div", { className: styles.top, children: _jsx("div", { className: styles.text, children: children }) }), _jsx("div", { className: styles.bottom })] }));
}
//# sourceMappingURL=GameButton.js.map