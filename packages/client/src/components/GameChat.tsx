import { useEffect, useMemo, useRef, useState } from "react"
import { useGameStore } from "../game/store"
import { ChatCommand, GAME_COMMANDS, MESSAGE_ERROR_COMMAND_404 } from "../game/chat"
import GameInput, { GameInputHandle } from "./GameInput"
import GameChatMessage from "./GameChatMessage"
import CommandSuggestions from "./CommandSuggestions"
import styles from "./GameChat.module.sass"

// The chat input shows command autocomplete while the user is still typing the
// command word: the value starts with "/" and has no whitespace yet.
function getCommandPrefix(value: string): string | null {
    if (!value.startsWith("/")) return null
    const rest = value.substring(1)
    if (/\s/.test(rest)) return null
    return rest
}

export default function GameChat() {
    const [chatMessage, setChatMessage] = useState("")
    const [activeIndex, setActiveIndex] = useState(0)
    const [dismissed, setDismissed] = useState(false)
    const inputRef = useRef<GameInputHandle>(null)

    const chatMessages = useGameStore((s) => s.chatMessages)
    const addChatMessage = useGameStore((s) => s.addChatMessage)
    const addOutgoingMessage = useGameStore((s) => s.addOutgoingMessage)

    const prefix = getCommandPrefix(chatMessage)
    const suggestions = useMemo(() => {
        if (prefix === null) return []
        const lower = prefix.toLowerCase()
        return GAME_COMMANDS.filter((c) => c.command.toLowerCase().startsWith(lower))
    }, [prefix])

    // Only suggest while typing a command word, when there are matches, and the
    // list has not been dismissed with Escape. An exact full-command match with
    // no inputs is hidden so it doesn't block sending (e.g. "/help").
    const showSuggestions = !dismissed
        && suggestions.length > 0
        && !(suggestions.length === 1
            && suggestions[0].command.toLowerCase() === (prefix ?? "").toLowerCase()
            && suggestions[0].inputs.length === 0)

    // Keep the highlighted suggestion in range as the list changes.
    useEffect(() => {
        setActiveIndex((i) => (i >= suggestions.length ? 0 : i))
    }, [suggestions.length])

    const completeCommand = (command: ChatCommand) => {
        const trailing = command.inputs.length > 0 ? " " : ""
        setChatMessage(`/${command.command}${trailing}`)
        setDismissed(true)
        inputRef.current?.focus()
    }

    const sendMessage = () => {
        // If a suggestion is highlighted while the user is still typing the
        // command word, Enter completes it instead of sending. Sending real
        // chat / full commands with args is never hijacked.
        if (showSuggestions) {
            const choice = suggestions[activeIndex]
            if (choice) {
                completeCommand(choice)
                return
            }
        }

        const message = chatMessage.trim()
        if (message.startsWith("/")) {
            const [command, ...inputs] = message.substring(1).split(/\s+/gmi)
            const chatCommand = GAME_COMMANDS.find((c) => c.command === command.toLowerCase())
            if (typeof chatCommand === "undefined") {
                addChatMessage(MESSAGE_ERROR_COMMAND_404)
            } else {
                const response = chatCommand.callback(message, inputs)
                if (typeof response !== "undefined") {
                    addChatMessage(response)
                }
            }
        } else if (message.length > 0) {
            addOutgoingMessage(message)
        }
        setChatMessage("")
        setDismissed(false)
    }

    const restoreLastMessage = () => {
        //
    }

    const handleChange = (value: string) => {
        setChatMessage(value)
        setDismissed(false)
    }

    // Navigation keys are handled on keydown so Tab focus changes and arrow-key
    // cursor movement can be prevented. GameInput keeps owning Enter/Esc/Up via
    // keyup; sendMessage decides whether Enter completes or sends.
    useEffect(() => {
        const input = inputRef.current?.input
        if (!input) return

        const handleKeyDown = (e: KeyboardEvent) => {
            if (!showSuggestions) {
                if (e.code === "Escape") setDismissed(true)
                return
            }
            if (e.code === "ArrowDown") {
                e.preventDefault()
                setActiveIndex((i) => (i + 1) % suggestions.length)
            } else if (e.code === "ArrowUp") {
                e.preventDefault()
                setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
            } else if (e.code === "Tab") {
                e.preventDefault()
                const choice = suggestions[activeIndex]
                if (choice) completeCommand(choice)
            } else if (e.code === "Escape") {
                e.preventDefault()
                setDismissed(true)
            }
        }

        input.addEventListener("keydown", handleKeyDown)
        return () => input.removeEventListener("keydown", handleKeyDown)
    }, [showSuggestions, suggestions, activeIndex])

    const visibleMessages = chatMessages.slice(-10)

    return (
        <div className={styles.gameChat}>
            <div className={styles.gameChatMessages}>
                {visibleMessages.map((message, i) => (
                    <GameChatMessage key={chatMessages.length - visibleMessages.length + i} message={message} />
                ))}
            </div>
            {showSuggestions && (
                <CommandSuggestions
                    commands={suggestions}
                    activeIndex={activeIndex}
                    onSelect={completeCommand}
                />
            )}
            <GameInput
                ref={inputRef}
                value={chatMessage}
                onChange={handleChange}
                onEnter={sendMessage}
                onUp={restoreLastMessage}
                placeholder="Chat or use /command"
                className={styles.gameChatInput}
            />
        </div>
    )
}
