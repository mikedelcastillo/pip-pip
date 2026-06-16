# GLOSSARY

One canonical name per domain concept. Read this before writing code so terminology stays stable across sessions. When you see a banned alias, replace it.

| Canonical | Means | Do not use |
|---|---|---|
| **tile** | One atomic grid square. `TILE_SIZE` is its edge length in world units. | cell, block (for a square), gridSquare, square |
| **material** | The colour / face style painted on a tile. | block (for colour/style), face, blockStyle, texture (for the colour) |
| **shape** | The geometry kind of a tile: full, diagonal, half, deco. | (no alias; just keep using shape) |
| **buff** | A collectible on the map AND the timed effect it grants. A buff can be positive or negative; a negative buff is a **debuff** (a label, not a separate system). | powerup, pickup, powerdown, item, drop, boon, bane |
| **bot** | An AI-controlled opponent. | ai (as the system or instance), npc, mob |
| **enemy** | The current target of a ship (human or bot). Distinct from bot; keep it. | (allowed; not a bot synonym) |
| **lobby** | The connection-group container (core `Lobby`). | room, session (for this) |
| **match** | The active gameplay phase of a lobby (`PipPipGamePhase.MATCH`). | round (for this) |
| **game** | The `PipPipGame` simulation object/world. | (allowed; distinct from lobby/match) |
| **bounds** | The cell bounding box of a map. | extremes |
| **worldExtent** | World-space saturation magnitude / total extent. | extent (bare), extremes |
| **angle** | A direction in radians (identifiers). | heading |
| **snapshot** | A persistence copy (library/backup). NOT editor undo state. | (for undo state use captureEditorState) |
| **mirror** | A geometric flip of tiles/shapes only. | (for backup sync use syncToBackup) |
| **restore** | The verb for bringing back a saved map. | recover (as a verb for the same action) |
| **archive** / **backup** / **recovery** | Three distinct persistence subsystems, not synonyms: archive = user-deleted maps kept temporarily; backup = durable IndexedDB mirror; recovery = scanning storage for salvageable maps. | (do not blur them) |

Notes:
- `cloak`: the code key is `invis`; user-facing copy says "Cloak". Keep the mapping; do not rename the key.
- Persisted map JSON still carries the legacy `cellSize` field for wire/storage compatibility. New code uses tile vocabulary; the field rename is tracked as a migration, not a free rename.
