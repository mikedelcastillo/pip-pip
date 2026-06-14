import { PipGameMap } from "@pip-pip/game/src/logic/map"
import { JSONMapSource } from "@pip-pip/game/src/logic/map"
import { loadGridMap, GridMapData } from "@pip-pip/game/src/logic/grid-map"
import { convertJSONMapToGrid } from "@pip-pip/game/src/logic/grid-map-migrate"


export type PipMapType = {
    id: string,
    name: string,
    texture: string,
    // Background colour for this map (0xRRGGBB). The client tints the canvas to
    // it on setMap so each map has a distinct mood. Pure data: dark, on-theme
    // space hues.
    background: number,
    createMap: () => PipGameMap,
}

export const PIP_MAPS: PipMapType[] = []

// The reserved mapIndex for a CUSTOM (uploaded / editor) map. Built-in maps are
// index-keyed in [0, PIP_MAPS.length-1]; -1 can never collide with one, and the
// gameMap wire packet (a uint8 0..255) can never produce it either, so a -1
// mapIndex unambiguously means "the active map is custom, carried by the
// customMap packet, not PIP_MAPS". Shared so logic, server and client agree.
export const CUSTOM_MAP_INDEX = -1

// The id every synthetic custom PipMapType carries, so any consumer can detect a
// custom map by mapType.id without knowing the index.
export const CUSTOM_MAP_TYPE_ID = "custom"

// Build a synthetic PipMapType for a custom map. PIP_MAPS entries are the only
// source of valid texture/background values, so a custom map REUSES the first
// built-in map's texture + background (a sane, on-theme default) and takes its
// display name from the uploaded data. The createMap thunk loads the same grid
// engine the editor preview and built-in maps use. setCustomMap sets this on the
// game so the renderer + client store read a real texture/background.
export function makeCustomMapType(data: GridMapData): PipMapType{
    const base = PIP_MAPS[0]
    const name = typeof data.name === "string" && data.name.trim().length > 0
        ? data.name.trim()
        : "Custom Map"
    return {
        id: CUSTOM_MAP_TYPE_ID,
        name,
        texture: base.texture,
        background: base.background,
        createMap: () => loadGridMap(CUSTOM_MAP_TYPE_ID, data),
    }
}

// Every registered map now loads through the NEW grid engine. The legacy
// wall_tiles / wall_segments JSON is converted on the fly by convertJSONMapToGrid
// (a pure adapter) and built by loadGridMap, so the maps keep their exact
// playable geometry while moving off the old loader. Hand-editing the JSON is
// avoided entirely - the adapter does the work. New maps authored directly in
// GridMapData can be registered the same way without the converter.
function createLegacyMap(id: string, source: JSONMapSource){
    return () => loadGridMap(id, convertJSONMapToGrid(id, source))
}


import TEST_MAP from "./test.map.json"
PIP_MAPS.push({
    id: "test",
    name: "Test",
    texture: "default",
    background: 0x150E12,
    createMap: createLegacyMap("test", TEST_MAP),
})

import PORTAL_MAP from "./portal.map.json"
PIP_MAPS.push({
    id: "portal",
    name: "Portal",
    texture: "default",
    background: 0x0A1226,
    createMap: createLegacyMap("portal", PORTAL_MAP),
})

import VALIDATE_MAP from "./validate.map.json"
PIP_MAPS.push({
    id: "validate",
    name: "Validate",
    texture: "default",
    background: 0x0A1A14,
    createMap: createLegacyMap("validate", VALIDATE_MAP),
})

import MAZE_MAP from "./maze.map.json"
PIP_MAPS.push({
    id: "maze",
    name: "Maze",
    texture: "default",
    background: 0x1C0E22,
    createMap: createLegacyMap("maze", MAZE_MAP),
})


import GALAXY_MAP from "./galaxy.map.json"
PIP_MAPS.push({
    id: "galaxy",
    name: "Galaxy",
    texture: "default",
    background: 0x201510,
    createMap: createLegacyMap("galaxy", GALAXY_MAP),
})


import DRIFT_MAP from "./drift.map.json"
PIP_MAPS.push({
    id: "drift",
    name: "Drift",
    texture: "default",
    background: 0x0E1518,
    createMap: createLegacyMap("drift", DRIFT_MAP),
})

import CLASH_MAP from "./clash.map.json"
PIP_MAPS.push({
    id: "clash",
    name: "Clash",
    texture: "default",
    background: 0x1A0F0F,
    createMap: createLegacyMap("clash", CLASH_MAP),
})

import NEXUS_MAP from "./nexus.map.json"
PIP_MAPS.push({
    id: "nexus",
    name: "Nexus",
    texture: "default",
    background: 0x12081C,
    createMap: createLegacyMap("nexus", NEXUS_MAP),
})
