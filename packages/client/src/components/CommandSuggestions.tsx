import { useEffect, useRef } from "react"
import type { ChatCommand } from "../game/chat"
import styles from "./CommandSuggestions.module.sass"

interface Props {
    commands: ChatCommand[]
    activeIndex: number
    onSelect: (command: ChatCommand) => void
}

function formatInputs(command: ChatCommand) {
    if (command.inputs.length === 0) return ""
    return " " + command.inputs.map((input) => `[${input}]`).join(" ")
}

export default function CommandSuggestions({ commands, activeIndex, onSelect }: Props) {
    const listRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const list = listRef.current
        if (!list) return
        const active = list.children[activeIndex] as HTMLElement | undefined
        active?.scrollIntoView({ block: "nearest" })
    }, [activeIndex])

    if (commands.length === 0) return null

    return (
        <div className={styles.commandSuggestions} ref={listRef}>
            {commands.map((command, i) => (
                <div
                    key={command.command}
                    className={`${styles.suggestion} ${i === activeIndex ? styles.active : ""}`}
                    // Use mousedown so the completion happens before the input blurs.
                    onMouseDown={(e) => {
                        e.preventDefault()
                        onSelect(command)
                    }}
                >
                    <span className={styles.usage}>
                        {`/${command.command}`}
                        <span className={styles.inputs}>{formatInputs(command)}</span>
                    </span>
                    <span className={styles.description}>{command.description}</span>
                </div>
            ))}
        </div>
    )
}
