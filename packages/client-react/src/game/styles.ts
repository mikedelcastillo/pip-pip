import { SHIP_DAIMETER } from "@pip-pip/game/src/logic/constants"

export const COLORS = {
    MAIN: 0xE6AE10,
    MAIN_DARKER: 0xF48509,
    ACCENT: 0xB07FC7,
    ACCENT_DARKER: 0x8437A8,
    DARK_1: 0x0D090B,
    DARK_2: 0x150E12,
    DARK_3: 0x362631,
    
    GOOD: 0x00FF00,
    BAD: 0xFF0000,
}

export const DIMS = {
    HEALTH_BAR_BORDER: 2,
    HEALTH_BAR_WIDTH: SHIP_DAIMETER,
    HEALTH_BAR_HEIGHT: 2,
    HEALTH_BAR_OFFSET: - SHIP_DAIMETER / 2
}