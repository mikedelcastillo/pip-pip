# Map recovery and data-loss redundancy - design

Date: 2026-06-15
Status: approved (scope: recovery tools + archive + save confirmation + IndexedDB mirror)

## Why

A map author (a child, on an installed iPad PWA) spent hours on a large map,
clicked "Save to library", saw no confirmation, clicked Leave, and the map then
showed as blank / "Unreadable" and opened empty. Reopening the editor several
times and duplicating it did not help.

This design recovers that map where any bytes survive, and hardens the editor so
hours of work can never silently vanish again.

## Root cause (from a forensic read of the persistence code)

Three independent gaps combine into silent loss:

1. **Save never validates; load validates strictly.** `saveMapToLibrary`
   (`game/mapLibrary.ts`) writes `serializeGridMapData(data)` and returns
   `ok:true` without ever running `validateGridMapData`. `loadMapFromLibrary`
   runs the strict validator and returns `null` on any structural problem, which
   the library grid renders as "Unreadable" and the editor opens as blank. So a
   degenerate or out-of-range map saves "successfully" yet can never load.

2. **The world-extent guard rejects large maps.** `validateGridMapData`
   (`packages/game/src/logic/grid-map.ts`) rejects any map whose worst-case world
   coordinate exceeds `WORLD_QUANT_RANGE` (8192). At the default `cellSize`
   (`TILE_SIZE` = 72) a map wider or taller than about 113 cells already exceeds
   it. A large, ambitious map therefore saves fine but fails to load, with every
   tile still present in storage. This is the most likely trigger here.

3. **No save confirmation.** The editor showed no success / failure toast that
   the author noticed, so an invalid save looked identical to a good one.

Two further hazards can destroy data that is still recoverable:

- **Read-modify-write can poison the slot.** Every save / duplicate / delete
  first calls `readLibrary`, which silently drops malformed entries; a later
  successful write then persists that pruned record. Recovery must read the
  **raw** string and must never trigger a write that prunes siblings.
- **The debounced autosave also rewrites the bound library entry**
  (`views/MapEditor.tsx`), unvalidated, so reopening a blank map can re-stamp the
  entry with the blank export.

## Storage surfaces (the recovery inventory)

All under `window.localStorage`, per origin. An installed iOS home-screen PWA
keeps its own persistent container and is exempt from Safari's 7-day eviction, so
unless the app overwrote it the bytes are still on the device.

| Key | Holds | Notes |
| --- | --- | --- |
| `pip-pip:map-library` | Record of named maps `{ name: { data, savedAt } }` | The author's "Save to library" lives here. Not touched by reopening the editor (autosave uses a different key), so the original bytes usually survive. |
| `pip-pip:map-editor:draft` | Single rolling autosave slot | Overwritten every time the editor is opened and edited, so reopening the blank map can clobber it. |
| `pip-pip:play-map` | Last "Play this map" snapshot | Bonus copy if the author ever hit Play. |
| `pip-pip:map-archive` | NEW: soft-deleted maps, 30-day retention | Added by this work; a recovery surface and an undo for Delete. |
| IndexedDB `pip-pip-backup` | NEW: durable mirror + rolling snapshots | Added by this work; survives a localStorage clear. |

## What we build

### 1. `game/mapRecovery.ts` (pure, sync, unit-tested)

- `repairGridMapData(value: unknown): RepairResult` - coerce an untrusted blob
  toward a valid `GridMapData` **without discarding content**, then re-validate.
  Repairs, each recorded in a `repairs: string[]` trail:
  - default a missing / non-string `name`, non-positive `cellSize`;
  - reconcile `tiles.length` with `cols*rows` (pad with 0 or derive `cols`/`rows`
    from the tile count when one side is sane);
  - floor / clamp fractional or negative tile indices; drop palette-out-of-range
    references to 0;
  - drop malformed spawns / segments; coerce invalid palette shapes to `deco`;
  - **world-extent overflow**: re-center the grid via `originCol` / `originRow`,
    and if still over range, reduce `cellSize` to the largest value that fits.
    This preserves every tile and the whole design, only the world scale shrinks.
  - Returns `{ ok:false }` only when no map-like content can be salvaged.
- `collectLocalRecoveryBlobs(storage): RawBlob[]` - read RAW from every local
  surface (library entries pulled even when individually invalid, draft, play-map,
  archive, and any orphan `pip-pip:*` value that parses to a map-ish object).
- `scanRecoveryBlobs(blobs): RecoveryCandidate[]` - classify each blob as
  `healthy` (validates as-is), `repairable` (repairs to valid), or `raw`
  (map-ish but unrepairable, still exportable), score real content by non-empty
  tile count, and dedupe. Sort most-content-first.

### 2. `game/mapArchive.ts` (pure, sync, unit-tested)

Soft delete: `archiveMap` moves an entry into `pip-pip:map-archive` with a
`deletedAt` stamp; `listArchivedMaps`, `restoreArchivedMap` (back into the
library under a non-colliding name), `purgeExpiredArchive(now)` drops entries
older than 30 days, capped like the library. Delete in the UI archives first.

### 3. `game/mapBackupDb.ts` (injectable async store, unit-tested with an in-memory fake)

A minimal `BackupStore` interface (`get/set/delete/keys`, all async). The real
`indexedDbBackupStore()` wraps IndexedDB and is fully best-effort (returns `null`
when IDB is unavailable, e.g. Safari private mode, so it can never break the app).
Pure helpers mirror each library write and keep a small rolling set of timestamped
snapshots. `collectBackupRecoveryBlobs(store)` feeds the same recovery scanner.

### 4. Recovery UI on the Map Maker screen (`views/MapLibrary.tsx`, mobile-first)

A "Recover lost maps" button (badged when candidates exist) opens a panel listing
every candidate with its content summary and one-tap, **non-destructive** actions:
Restore, Auto-fix and restore (saved under a fresh name), Export raw JSON, and a
"Recover everything" action. An Archive section lists soft-deleted maps with
Restore. Every control is a >= 44px touch target.

### 5. Editor hardening (`views/MapEditor.tsx` + `game/mapLibrary.ts`)

- A real, visible save confirmation (success and failure).
- `saveMapToLibrary` gains an opt-in guard so an explicit Save validates the data
  and refuses to overwrite an existing **good** entry with an invalid one; the
  background autosave-to-library uses the same guard so reopening a blank map can
  never re-stamp a good entry with blank.

## Non-goals (this push)

Persisted undo history, server-side map backup, and account sync. The IndexedDB
mirror is the durable local backstop; cloud backup is a later step.

## Verification

`yarn test` (new pure-module suites), the client's own `yarn client build` (TS
4.8.4 gate), `yarn lint`, and a Playwright pass of the recovery panel on a mobile
(393px touch) and a desktop viewport. No em-dashes in any copy, comment, or commit.
