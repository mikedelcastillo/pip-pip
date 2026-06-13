import { jsx as _jsx } from "react/jsx-runtime";
import { useUiStore } from "../store/ui";
import styles from "./GameLoading.module.sass";
export default function GameLoading() {
    const loading = useUiStore((s) => s.loading);
    const body = useUiStore((s) => s.body);
    if (!loading)
        return null;
    return (_jsx("div", { className: `${styles.gameLoading} center-container`, children: _jsx("div", { className: `${styles.contentContainer} content-container`, children: _jsx("div", { className: styles.text, children: body }) }) }));
}
//# sourceMappingURL=GameLoading.js.map