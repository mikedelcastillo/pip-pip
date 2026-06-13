import { useState } from "react"
import { useNavigate } from "react-router-dom"
import GameButton from "../components/GameButton"
import GameInput from "../components/GameInput"
import AudioVolumeToggle from "../components/AudioVolumeToggle"
import { hostGame } from "../game"
import logoUrl from "../assets/logo.png"
import styles from "./Index.module.sass"

export default function Index() {
    const navigate = useNavigate()
    const [joinValue, setJoinValue] = useState("")

    const notYetImplemented = () => {
        alert("That doesn't do anything yet.")
    }

    return (
        <div className="center-container">
            <div className="content-container">
                <div className={styles.header}>
                    <img className={styles.logo} src={logoUrl} />
                    <div className={styles.caption}>ALPHA by Meg&amp;Mike</div>
                </div>

                <div className={styles.buttons}>
                    <GameButton onClick={() => hostGame(navigate)}>Host Game</GameButton>
                    <GameInput value={joinValue} onChange={setJoinValue} />
                    <GameButton onClick={notYetImplemented}>Join Game</GameButton>
                    <GameButton accent onClick={notYetImplemented}>Settings</GameButton>
                    <GameButton accent onClick={notYetImplemented}>Credits</GameButton>
                    <AudioVolumeToggle />
                </div>
            </div>
        </div>
    )
}
