import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import GameButton from "../components/GameButton";
import GameInput from "../components/GameInput";
import { hostGame } from "../game";
import logoUrl from "../assets/logo.png";
import styles from "./Index.module.sass";
export default function Index() {
    const navigate = useNavigate();
    const [joinValue, setJoinValue] = useState("");
    const notYetImplemented = () => {
        alert("That doesn't do anything yet.");
    };
    return (_jsx("div", { className: "center-container", children: _jsxs("div", { className: "content-container", children: [_jsxs("div", { className: styles.header, children: [_jsx("img", { className: styles.logo, src: logoUrl }), _jsx("div", { className: styles.caption, children: "ALPHA by Meg&Mike" })] }), _jsxs("div", { className: styles.buttons, children: [_jsx(GameButton, { onClick: () => hostGame(navigate), children: "Host Game" }), _jsx(GameInput, { value: joinValue, onChange: setJoinValue }), _jsx(GameButton, { onClick: notYetImplemented, children: "Join Game" }), _jsx(GameButton, { accent: true, onClick: notYetImplemented, children: "Settings" }), _jsx(GameButton, { accent: true, onClick: notYetImplemented, children: "Credits" })] })] }) }));
}
//# sourceMappingURL=Index.js.map