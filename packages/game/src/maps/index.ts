import { PipGameMap, JSONPipGameMap } from "../logic/map"


export type PipMapType = {
    id: string,
    name: string,
    texture: string,
    // Background colour for this map (0xRRGGBB). The client tints the canvas to
    // it on setMap so each map has a distinct mood. Pure data — dark, on-theme
    // space hues.
    background: number,
    createMap: () => PipGameMap,
}

export const PIP_MAPS: PipMapType[] = []


import TEST_MAP from "./test.map.json"
PIP_MAPS.push({
    id: "test",
    name: "Test",
    texture: "default",
    background: 0x150E12,
    createMap: () => new JSONPipGameMap("test", TEST_MAP),
})

import PORTAL_MAP from "./portal.map.json"
PIP_MAPS.push({
    id: "portal",
    name: "Portal",
    texture: "default",
    background: 0x0A1226,
    createMap: () => new JSONPipGameMap("portal", PORTAL_MAP),
})

import VALIDATE_MAP from "./validate.map.json"
PIP_MAPS.push({
    id: "validate",
    name: "Validate",
    texture: "default",
    background: 0x0A1A14,
    createMap: () => new JSONPipGameMap("validate", VALIDATE_MAP),
})

import MAZE_MAP from "./maze.map.json"
PIP_MAPS.push({
    id: "maze",
    name: "Maze",
    texture: "default",
    background: 0x1C0E22,
    createMap: () => new JSONPipGameMap("maze", MAZE_MAP),
})


import GALAXY_MAP from "./galaxy.map.json"
PIP_MAPS.push({
    id: "galaxy",
    name: "Galaxy",
    texture: "default",
    background: 0x201510,
    createMap: () => new JSONPipGameMap("galaxy", GALAXY_MAP),
})
