import type { ChatMessage } from "../game/chat"
import styles from "./GameChatMessage.module.sass"

interface Props {
    message: ChatMessage
}

export default function GameChatMessage({ message }: Props) {
    return (
        <div className={styles.gameChatMessage}>
            {message.text.map((part, i) => (
                <span key={i} className={`${styles.text} ${part.style ? styles[part.style] ?? "" : ""}`}>
                    {part.text}
                </span>
            ))}
        </div>
    )
}
