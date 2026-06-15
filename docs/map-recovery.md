# Map storage, recovery, and never-lose-work guarantees

This documents how the in-app map editor stores maps, the data-loss bug that
motivated this system, the recovery tools on the Map Maker screen, and how to pull a
map off a device by hand if you ever need to.

## Where maps live (storage surfaces)

All map data is per-origin in the browser, under these keys. An installed iOS
home-screen PWA keeps its own persistent storage container and is exempt from
Safari's 7-day eviction, so a map that was saved there is normally still on the
device unless the app itself overwrote it.

| Key (localStorage) | What it is | Written when |
| --- | --- | --- |
| `pip-pip:map-library` | The named maps the author saved ("Save to library"). One JSON object: `{ name: { data, savedAt } }`, where `data` is a serialised `GridMapData` string. | On every save / rename / duplicate / delete. Reopening the editor does NOT touch it. |
| `pip-pip:map-editor:draft` | The single rolling autosave slot for the in-progress map. | Debounced while editing. Overwritten every time the editor is opened and edited. |
| `pip-pip:play-map` | The last map sent from the editor to "Play this map". | On "Play this map". |
| `pip-pip:map-archive` | Soft-deleted maps, kept 30 days. | On Delete (delete archives, then removes from the library). |

| Store (IndexedDB) | What it is |
| --- | --- |
| `pip-pip-backup` | A durable mirror of the whole library plus a rolling set of up to 20 timestamped snapshots. Survives a localStorage clear. |

`GridMapData` is defined in `packages/game/src/logic/grid-map.ts`. The same file's
`validateGridMapData` is the strict gate every map passes through on load.

## The bug this fixed

The library's SAVE path never validated what it wrote, but the LOAD path validates
strictly. So a map that was structurally fine but, say, larger than the play area
(`validateGridMapData` rejects any map whose world bounds exceed `WORLD_QUANT_RANGE`
= 8192; at the default cell size that is roughly 113 cells across) would:

1. save with `ok: true` and no visible confirmation, then
2. fail to load forever after, showing as a blank "Needs recovery" card,

with every tile still sitting in `pip-pip:map-library`. Two further hazards could
overwrite still-recoverable bytes: the editor's debounced autosave also rewrote the
bound library entry unvalidated, and the library's read-modify-write would silently
prune entries it could not parse.

## The fixes (redundancy)

- **Save is validated.** `saveMapToLibrary` now refuses to persist a map that could
  not load back (`reason: "invalid"`), so the library can never gain a new
  unreadable entry through the normal path, and a stray autosave can never overwrite
  a good entry with a blank one.
- **Save repairs instead of failing.** The editor's "Save to library" runs the map
  through `repairGridMapData` first, so an oversized map is re-centred / scaled to
  fit and saved in a loadable form (with an "adjusted to fit" note) rather than lost.
- **Delete is reversible.** Delete moves the map to `pip-pip:map-archive` (30-day
  retention, auto-purged), restorable from the Archive on the Map Maker screen.
- **Durable backup.** The library is mirrored into IndexedDB with rolling snapshots,
  a second copy that survives a localStorage clear and feeds recovery.

## The recovery tools (Map Maker screen)

Two buttons sit under the title on the Map Maker screen (`views/MapLibrary.tsx`),
each badged with a live count.

- **Recover lost maps** (`components/RecoveryModal.tsx`) sweeps every surface above,
  reading RAW bytes even from entries that no longer load, and classifies each find:
  - **Ready to restore** - already valid.
  - **Needs a quick fix** - invalid but repairable; shows what auto-fix will do.
  - **Backup copy** - raw bytes that can be exported but not auto-fixed.
  For each, one tap does a **non-destructive** Restore / Auto-fix and restore / Keep a
  copy, plus Export file (downloads the JSON so it can never be lost again). A
  repairable map that already lives in the library is fixed in place; everything else
  is written as a fresh, non-colliding entry, so nothing the author still has is ever
  clobbered. "Recover everything" restores all finds at once.
- **Archive** (`components/ArchiveModal.tsx`) lists soft-deleted maps with Restore and
  Delete forever, and shows how long each is kept.

The logic is in pure, unit-tested modules so it is robust and DOM-free:
`game/mapRecovery.ts` (scan + `repairGridMapData`), `game/mapArchive.ts`,
`game/mapBackupDb.ts`, plus additions to `game/mapLibrary.ts`. Tests live under
`tests/client/map*.test.ts` and the end-to-end flow under `e2e/map-recovery.spec.ts`
(runs on both a mobile-touch and a desktop project).

### What `repairGridMapData` can fix

Coerces an untrusted blob toward a valid `GridMapData` without discarding content,
recording a human-readable trail of what it changed:

- a missing name or non-positive cell size (defaulted);
- a `tiles` length that does not match `cols * rows` (derive a side from the tile
  count, or pad / trim);
- fractional or negative tile indices (floored / clamped);
- malformed spawns, segments, or palette entries (dropped or coerced, preserving
  palette indices);
- **world-extent overflow** (the common one): re-centre via the cell-space origin,
  then, if still too big, reduce the cell size to the largest value that fits. Every
  tile is preserved; only the world scale shrinks.

It re-validates at the end and reports failure only when nothing map-like survives.

## Recovering a map off a device by hand

If you ever need the raw bytes directly (for example to hand them back to someone),
and the in-app Recover tool is not enough:

### iPad / iPhone installed PWA

1. On the device: Settings > Safari > Advanced > **Web Inspector = ON**.
2. On a Mac: Safari > Settings > Advanced > **Show Develop menu**.
3. Connect the device by cable. Open the installed app, but go only to the home / map
   screen - do NOT open the broken map in the editor (that can overwrite the autosave
   slot).
4. Mac Safari > Develop > [device] > pick the app context (iPadOS 16.4+).
5. In the Console, copy all three map keys to the Mac clipboard:

   ```js
   copy(JSON.stringify({
     'pip-pip:map-editor:draft': localStorage.getItem('pip-pip:map-editor:draft'),
     'pip-pip:map-library':      localStorage.getItem('pip-pip:map-library'),
     'pip-pip:play-map':         localStorage.getItem('pip-pip:play-map'),
   }, null, 2))
   ```

The library value is a `{ name: { data } }` object; each `data` is a `GridMapData`
JSON string you can drop into the editor's Import, or run through `repairGridMapData`.

### Desktop browser

Open DevTools (F12) > Application > Local Storage > the site origin, and read the same
keys. Production origin is `pip-pip.mikedc.io` (with the hyphen).
