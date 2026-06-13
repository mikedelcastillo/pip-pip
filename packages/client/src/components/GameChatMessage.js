import { jsx as _jsx } from "react/jsx-runtime";
import styles from "./GameChatMessage.module.sass";
export default function GameChatMessage({ message }) {
    return (_jsx("div", { className: styles.gameChatMessage, children: message.text.map((part, i) => (_jsx("span", { className: `${styles.text} ${part.style ? styles[part.style] ?? "" : ""}`, children: part.text }, i))) }));
}
//# sourceMappingURL=GameChatMessage.js.map