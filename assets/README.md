# assets/

Pixel-art masters for Pip-Pip: the authoritative `.aseprite` source files. The game ships
the PNGs exported from them under `packages/client/src/assets/art/`.

## Workflow

Masters are authored in Aseprite (via the `pixel-mcp` tooling). After editing a master:

1. Re-export its frames/spritesheet into `packages/client/src/assets/art/`.
2. Register the URLs in `packages/client/src/assets/sprites.ts` (feeds the Pixi `art`
   bundle in `packages/client/src/game/assets.ts`).

## Contents

### `homepage-bg.aseprite`

Animated space background for the homepage, a pixel-art recreation of Meg's original
`packages/client/public/bg.png`: deep plum-to-void gradient, soft purple nebula bands,
and several star layers with 4-point sparkles that twinkle across the loop.

- 256x256, RGB, tileable horizontally.
- Layers: `Layer 1` (base gradient), `nebula`, `stars_far`, `stars_near`.
- 12 frames at 120ms, tagged `twinkle` (forward), ~1.44s loop. Base and nebula cels
  are linked across all frames; only the star layers animate.
- Palette matches the theme tokens in `packages/client/src/styles/_variables.sass`
  (`#0D090B`/`#150E12` voids, `#362631` plum, `#B07FC7` accent purple, `#E6AE10` main
  yellow for the rare warm sparkle).

Exports (in `packages/client/src/assets/art/`):

- `homepage-bg.png` + `homepage-bg.json`: full 12-frame horizontal spritesheet
  (3072x256), all layers composited.
- `homepage-bg-base.png`: opaque base+nebula tile (256x256), for the tiling
  marquee-parallax layer on the web homepage.
- `homepage-bg-stars.png`: transparent 12-frame star spritesheet (3072x256), stepped
  with a CSS `steps(12)` animation for the twinkle.
- `homepage-bg-still.png`: single composited frame, static fallback.

Preview GIF: `homepage-bg-preview.gif` (in this folder).
