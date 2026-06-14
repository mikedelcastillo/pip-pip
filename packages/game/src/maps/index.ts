import { PipGameMap } from "@pip-pip/game/src/logic/map"
import { JSONMapSource } from "@pip-pip/game/src/logic/map"
import { loadGridMap } from "@pip-pip/game/src/logic/grid-map"
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
