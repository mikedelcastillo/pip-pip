// Central registry for authored pixel-art sprites.
//
// Masters live as .aseprite files under the repo-root `assets/` folder
// (e.g. assets/homepage-bg.aseprite, authored with the pixel-mcp / Aseprite
// workflow). Each master is exported into this package's `assets/art/` folder
// and re-exported here as a stable URL constant.
//
// This module is the single source of truth for art URLs: the React/CSS layer
// imports the URLs directly, and the Pixi asset loader (see ./../game/assets.ts)
// pulls from `artSprites` to build its "art" bundle. Add new art here and it
// flows to both consumers.

// Animated homepage space background (recreation of Meg's original bg.png).
// homepageBgStars is a horizontal 12-frame spritesheet (3072x256, 12x 256x256
// cells) of twinkling/sparkling stars on a transparent background; it is
// stepped through with a CSS steps(12) animation. homepageBgBase is the
// opaque, horizontally-tileable nebula gradient that sits behind the stars and
// scrolls as a slow marquee parallax. homepageBgStill is a single composited
// frame used as a static fallback (and as the loading/no-JS background).
import homepageBgStars from "./art/homepage-bg-stars.png"
import homepageBgBase from "./art/homepage-bg-base.png"
import homepageBgStill from "./art/homepage-bg-still.png"

export const HOMEPAGE_BG_FRAMES = 12
export const HOMEPAGE_BG_TILE = 256

export const artSprites = {
    homepageBgStars,
    homepageBgBase,
    homepageBgStill,
}

export {
    homepageBgStars,
    homepageBgBase,
    homepageBgStill,
}
