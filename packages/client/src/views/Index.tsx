import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import GameButton from "../components/GameButton"
import GameInput from "../components/GameInput"
import SettingsModal from "../components/SettingsModal"
import CreditsModal from "../components/CreditsModal"
import HostSettingsModal from "../components/HostSettingsModal"
import PublicMatchBrowser from "../components/PublicMatchBrowser"
import AlphaNoticeModal from "../components/AlphaNoticeModal"
import AlphaBanner from "../components/AlphaBanner"
import HomeBackground from "../components/HomeBackground"
import { readAlphaSeen, writeAlphaSeen } from "../store/alphaNotice"
import { trackEvent, trackPageView } from "../analytics"
import logoUrl from "../assets/logo.png"
import styles from "./Index.module.sass"

type Panel = "settings" | "credits" | "host" | "browse" | "alpha" | null

export default function Index() {
    const [joinValue, setJoinValue] = useState("")
    const [panel, setPanel] = useState<Panel>(null)
    const navigate = useNavigate()

    // Auto-show the ALPHA notice once on a player's very first visit, then
    // persist a "seen" flag so it never auto-pops again. The banner below stays
    // available to re-open it on demand.
    useEffect(() => {
        if (readAlphaSeen()) return
        writeAlphaSeen(true)
        setPanel("alpha")
    }, [])

    // Record a homepage view once on mount. No-op when analytics is disabled.
    useEffect(() => {
        trackPageView("/")
    }, [])

    // Join a lobby directly by its code/id, same route the public-match
    // browser uses to join (the /:id view handles connect + join).
    const joinByCode = () => {
        const code = joinValue.trim()
        if (code.length !== 0) {
            trackEvent("join_game")
            navigate(`/${code}`)
        }
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
                    <GameButton onClick={() => { trackEvent("host_game"); setPanel("host") }}>Host Game</GameButton>
                    <GameButton onClick={() => { trackEvent("join_public_match"); setPanel("browse") }}>Join Public Match</GameButton>
                    <GameInput value={joinValue} onChange={setJoinValue} name="lobby-code" placeholder="Lobby code" onEnter={joinByCode} />
                    <GameButton onClick={joinByCode}>Join Game</GameButton>
                    <GameButton onClick={() => { trackEvent("open_map_maker"); navigate("/maps") }}>Map Maker</GameButton>
                    <GameButton accent onClick={() => setPanel("settings")}>Settings</GameButton>
                    <GameButton accent onClick={() => setPanel("credits")}>Credits</GameButton>
                    <AlphaBanner onClick={() => setPanel("alpha")} />
                </div>
            </div>

            {panel === "settings" && <SettingsModal onClose={closePanel} />}
            {panel === "credits" && <CreditsModal onClose={closePanel} />}
            {panel === "host" && <HostSettingsModal onClose={closePanel} />}
            {panel === "browse" && <PublicMatchBrowser onClose={closePanel} />}
            {panel === "alpha" && <AlphaNoticeModal onClose={closePanel} />}
        </div>
    )
}
