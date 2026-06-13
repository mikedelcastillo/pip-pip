import { useState } from "react"
import GameButton from "../components/GameButton"
import GameInput from "../components/GameInput"
import AudioVolumeToggle from "../components/AudioVolumeToggle"
import SettingsModal from "../components/SettingsModal"
import CreditsModal from "../components/CreditsModal"
import HostSettingsModal from "../components/HostSettingsModal"
import PublicMatchBrowser from "../components/PublicMatchBrowser"
import HomeBackground from "../components/HomeBackground"
import logoUrl from "../assets/logo.png"
import styles from "./Index.module.sass"

type Panel = "settings" | "credits" | "host" | "browse" | null

export default function Index() {
    const [joinValue, setJoinValue] = useState("")
    const [panel, setPanel] = useState<Panel>(null)

    const notYetImplemented = () => {
        alert("That doesn't do anything yet.")
    }

    const closePanel = () => setPanel(null)

    return (
        <div className="center-container">
            <HomeBackground />
            <div className={`content-container ${styles.content}`}>
                <div className={styles.header}>
                    <img className={styles.logo} src={logoUrl} />
                    <div className={styles.caption}>ALPHA by Meg&amp;Mike</div>
                </div>

                <div className={styles.buttons}>
                    <GameButton onClick={() => setPanel("host")}>Host Game</GameButton>
                    <GameButton onClick={() => setPanel("browse")}>Join Public Match</GameButton>
                    <GameInput value={joinValue} onChange={setJoinValue} />
                    <GameButton onClick={notYetImplemented}>Join Game</GameButton>
                    <GameButton accent onClick={() => setPanel("settings")}>Settings</GameButton>
                    <GameButton accent onClick={() => setPanel("credits")}>Credits</GameButton>
                    <AudioVolumeToggle />
                </div>
            </div>

            {panel === "settings" && <SettingsModal onClose={closePanel} />}
            {panel === "credits" && <CreditsModal onClose={closePanel} />}
            {panel === "host" && <HostSettingsModal onClose={closePanel} />}
            {panel === "browse" && <PublicMatchBrowser onClose={closePanel} />}
        </div>
    )
}
