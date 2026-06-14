// Central registry for authored pixel-art sprites.
//
// Masters live as .aseprite files under the repo-root `assets/` folder,
// exported into this package's `assets/art/` folder and re-exported here as
// stable URL constants.
//
// This module is the single source of truth for art URLs: the React/CSS layer
// imports the URLs directly, and the Pixi asset loader (see ./../game/assets.ts)
// pulls from `artSprites` to build its "art" bundle. Add new art here and it
// flows to both consumers.
//
// The homepage background no longer uses authored art — it is now a procedural
// parallax star field drawn to a <canvas> (see ../components/HomeBackground.tsx)
// — so this registry is currently empty. The bundle is kept (and exported) so
// the asset loader and any future art slot in without wiring changes.

export const artSprites = {}
