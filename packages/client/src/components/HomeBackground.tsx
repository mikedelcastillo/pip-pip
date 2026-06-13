import { homepageBgBase, homepageBgStars, homepageBgStill } from "../assets/sprites"
import styles from "./HomeBackground.module.sass"

// Decorative animated pixel-art space background for the homepage.
//
// Sits behind the page content (z-index 0) and is purely cosmetic, so it is
// marked aria-hidden. Layering (back to front):
//   root   solid dark fill + still frame, so something is always painted
//   base   tiling nebula gradient with a slow marquee parallax drift
//   stars  transparent 12-frame twinkle spritesheet stepped via CSS
export default function HomeBackground() {
    return (
        <div
            className={styles.root}
            aria-hidden="true"
            style={{ backgroundImage: `url(${homepageBgStill})` }}
        >
            <div
                className={`${styles.layer} ${styles.base}`}
                style={{ backgroundImage: `url(${homepageBgBase})` }}
            />
            <div
                className={`${styles.layer} ${styles.stars}`}
                style={{ backgroundImage: `url(${homepageBgStars})` }}
            />
        </div>
    )
}
