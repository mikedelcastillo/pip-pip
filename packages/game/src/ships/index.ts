import { PipShip, createShipStats, createRange } from "../logic/ship"

export type ShipType = {
    id: string,
    name: string,
    texture: string,
    description: string,
    Ship: typeof PipShip,
}

export const PIP_SHIPS: ShipType[] = []

PIP_SHIPS.push({
    id: "mono",
    name: "Mono",
    texture: "ship_1",
    description: "Twin-barrel machine gun but fragile",
    Ship: class extends PipShip{
        stats = createShipStats({
            weapon: {
                rate: 1,
                capacity: 120,
                // Two parallel barrels: a tight 2-shot so the stream is
                // slightly wider without losing its rapid-fire identity.
                spread: {
                    count: 2,
                    angle: 0.05,
                },
            },
            bullet: {
                velocity: 50,
                damage: createRange(2),
            },
            defense: createRange(0.5),
        })
    },
})

PIP_SHIPS.push({
    id: "hugo",
    name: "Hugo",
    texture: "ship_2",
    description: "Agile",
    Ship: class extends PipShip{
        stats = createShipStats({
            movement: {
                agility: 1,
                acceleration: createRange(3, 1/3),
            },
        })
    },
})

PIP_SHIPS.push({
    id: "gotchi",
    name: "Gotchi",
    texture: "ship_3",
    description: "Very fast",
    Ship: class extends PipShip{
        stats = createShipStats({
            movement: {
                agility: 0.2,
                acceleration: {
                    low: 7.5,
                    normal: 10,
                    high: 15,
                },
            },
            aim: {
                speed: 0.25,
            },
        })
    },
})

PIP_SHIPS.push({
    id: "blu",
    name: "Blu",
    texture: "ship_4",
    description: "Nothing special yet",
    Ship: class extends PipShip{
        stats = createShipStats()
    },
})

PIP_SHIPS.push({
    id: "flora",
    name: "Flora",
    texture: "ship_5",
    description: "Close-range scatter gun",
    Ship: class extends PipShip{
        stats = createShipStats({
            weapon: {
                // A 5-pellet scatter fanned across ~0.45 rad. Per-pellet damage
                // is auto-divided by the spread count in the firing logic, so a
                // point-blank full hit deals the same as a default shot while a
                // distant spray peppers for a fraction. Slightly slower fire and
                // a deeper magazine to suit the brawler role.
                rate: 5,
                capacity: 40,
                spread: {
                    count: 5,
                    angle: 0.45,
                },
            },
            bullet: {
                velocity: 70,
                // Total per-shot damage budget of 15 (3 per pellet) — strong up
                // close where all 5 land, weak at range.
                damage: createRange(15),
            },
        })
    },
})

PIP_SHIPS.push({
    id: "djibouti",
    name: "Djibouti",
    texture: "ship_6",
    description: "Lobs area-of-effect grenades",
    Ship: class extends PipShip{
        // Grenadier: the tactical weapon fires "grenade" bullets that detonate
        // with area-of-effect damage when they end their life (lifespan expiry,
        // wall, or contact). 60 base damage at the blast centre falls off
        // linearly to ~0 at the 220-unit edge. A slow-moving heavy round so the
        // lob arc reads, on the tactical's own ammo/reload.
        stats = createShipStats({
            tactical: {
                bulletKind: "grenade",
                explosionRadius: 220,
                damage: createRange(60),
                bullet: {
                    velocity: 45,
                    radius: 16,
                },
            },
        })
    },
})
