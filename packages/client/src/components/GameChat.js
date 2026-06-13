import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { useGameStore } from "../game/store";
import { GAME_COMMANDS, MESSAGE_ERROR_COMMAND_404 } from "../game/chat";
import GameInput from "./GameInput";
import GameChatMessage from "./GameChatMessage";
import styles from "./GameChat.module.sass";
export default function GameChat() {
    const [chatMessage, setChatMessage] = useState("");
    const inputRef = useRef(null);
    const chatMessages = useGameStore((s) => s.chatMessages);
    const addChatMessage = useGameStore((s) => s.addChatMessage);
    const addOutgoingMessage = useGameStore((s) => s.addOutgoingMessage);
    const sendMessage = () => {
        const message = chatMessage.trim();
        if (message.startsWith("/")) {
            const [command, ...inputs] = message.substring(1).split(/\s+/gmi);
            const chatCommand = GAME_COMMANDS.find((c) => c.command === command.toLowerCase());
            if (typeof chatCommand === "undefined") {
                addChatMessage(MESSAGE_ERROR_COMMAND_404);
            }
            else {
                const response = chatCommand.callback(message, inputs);
                if (typeof response !== "undefined") {
                    addChatMessage(response);
                }
            }
        }
        else if (message.length > 0) {
            addOutgoingMessage(message);
        }
        setChatMessage("");
    };
    const restoreLastMessage = () => {
        //
    };
    useEffect(() => {
        const keyboardListener = (e) => {
            const input = inputRef.current?.input;
            if (!input)
                return;
            if (e.target !== input) {
                if (e.code === "KeyT" || e.code === "Enter") {
                    inputRef.current?.focus();
                }
                if (e.code === "Slash") {
                    setChatMessage((current) => current.trim() === "" ? "/" : current);
                    inputRef.current?.focus();
                }
            }
        };
        window.addEventListener("keyup", keyboardListener);
        return () => window.removeEventListener("keyup", keyboardListener);
    }, []);
    const visibleMessages = chatMessages.slice(-10);
    return (_jsxs("div", { className: styles.gameChat, children: [_jsx("div", { className: styles.gameChatMessages, children: visibleMessages.map((message, i) => (_jsx(GameChatMessage, { message: message }, chatMessages.length - visibleMessages.length + i))) }), _jsx(GameInput, { ref: inputRef, value: chatMessage, onChange: setChatMessage, onEnter: sendMessage, onUp: restoreLastMessage, placeholder: "Chat or use /command", className: styles.gameChatInput })] }));
}
//# sourceMappingURL=GameChat.js.map