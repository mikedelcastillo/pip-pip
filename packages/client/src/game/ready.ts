// Lobby "ready up" tally. Pure (no store/DOM access) so it is trivially
// unit-testable with plain objects. The param type is defined structurally - it
// asks only for the fields the tally reads - so a test (or any caller) can pass
// plain { id, ready, spectator } objects without building a full GameStorePlayer.

// The minimal shape readyTally reads off each player. GameStorePlayer satisfies
// it structurally, so the store can pass its player list straight in.
export type ReadyTallyPlayer = {
    id: string,
    ready: boolean,
    spectator: boolean,
}

export type ReadyTally = {
    ready: number,
    total: number,
}

// Count how many ELIGIBLE players are ready. Eligible = NOT the host and NOT a
// spectator: the host never readies (they start the match), and a spectator is
// sitting out so they never count toward (or against) the tally. total is the
// number of eligible players; ready is how many of those have ready === true.
// An empty / all-host / all-spectator lobby yields { ready: 0, total: 0 }.
export function readyTally(players: ReadyTallyPlayer[], hostId: string): ReadyTally {
    let ready = 0
    let total = 0
    for (const player of players) {
        if (player.id === hostId) continue
        if (player.spectator === true) continue
        total += 1
        if (player.ready === true) ready += 1
    }
    return { ready, total }
}
