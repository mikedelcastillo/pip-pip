import * as PIXI_Assets from "@pixi/assets"

export const assetLoader = PIXI_Assets.Assets

import logo from "../assets/logo.png"
assetLoader.addBundle("ui", {
    logo,
})

import ship_1_1 from "../assets/ships/ship-1-1.png"
import ship_1_2 from "../assets/ships/ship-1-2.png"
import ship_1_3 from "../assets/ships/ship-1-3.png"
import ship_1_4 from "../assets/ships/ship-1-4.png"
import ship_1 from "../assets/ships/ship-1.png"
import ship_2_1 from "../assets/ships/ship-2-1.png"
import ship_2_2 from "../assets/ships/ship-2-2.png"
import ship_2_3 from "../assets/ships/ship-2-3.png"
import ship_2 from "../assets/ships/ship-2.png"
import ship_3_1 from "../assets/ships/ship-3-1.png"
import ship_3_2 from "../assets/ships/ship-3-2.png"
import ship_3_3 from "../assets/ships/ship-3-3.png"
import ship_3_4 from "../assets/ships/ship-3-4.png"
import ship_3 from "../assets/ships/ship-3.png"
import ship_4_1 from "../assets/ships/ship-4-1.png"
import ship_4_2 from "../assets/ships/ship-4-2.png"
import ship_4_3 from "../assets/ships/ship-4-3.png"
import ship_4_4 from "../assets/ships/ship-4-4.png"
import ship_4 from "../assets/ships/ship-4.png"
import ship_5_1 from "../assets/ships/ship-5-1.png"
import ship_5_2 from "../assets/ships/ship-5-2.png"
import ship_5_3 from "../assets/ships/ship-5-3.png"
import ship_5 from "../assets/ships/ship-5.png"
import ship_6_1 from "../assets/ships/ship-6-1.png"
import ship_6_2 from "../assets/ships/ship-6-2.png"
import ship_6_3 from "../assets/ships/ship-6-3.png"
import ship_6 from "../assets/ships/ship-6.png"

export const shipAssets = {
    ship_1_1,
    ship_1_2,
    ship_1_3,
    ship_1_4,
    ship_1,
    ship_2_1,
    ship_2_2,
    ship_2_3,
    ship_2,
    ship_3_1,
    ship_3_2,
    ship_3_3,
    ship_3_4,
    ship_3,
    ship_4_1,
    ship_4_2,
    ship_4_3,
    ship_4_4,
    ship_4,
    ship_5_1,
    ship_5_2,
    ship_5_3,
    ship_5,
    ship_6_1,
    ship_6_2,
    ship_6_3,
    ship_6,
}

assetLoader.addBundle("ships", shipAssets)

import star_1 from "../assets/stars/star-1.png"
import displacement_map from "../assets/displacement-map.png"
import tile_default from "../assets/tiles/default.png"
import tile_hidden from "../assets/tiles/hidden.png"

assetLoader.addBundle("misc", {
    star_1,
    displacement_map,

    tile_default,
    tile_hidden,
})