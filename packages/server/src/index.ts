import { $uint8, ExtractSerializerMap, Packet, PacketManager, Server } from "@pip-pip/core"
import { $varstring, Client } from "@pip-pip/core/src/common"
import { Connection } from "@pip-pip/core/src/networking/connection"
import { LobbyTypeOptions } from "@pip-pip/core/src/networking/lobby"
import { packetManager } from "@pip-pip/game/src/networking/packets"

type GamePacketManagerSerializerMap = ExtractSerializerMap<typeof packetManager>

type GameConnectionLocals = {
    name: string,
}

type GameLobbyLocals = {
    players: string[],
}

const server = new Server<GamePacketManagerSerializerMap, GameConnectionLocals, GameLobbyLocals>(packetManager, {
    connectionIdleLifespan: 5000,
    lobbyIdleLifespan: 5000,
    verifyTimeLimit: 5000,
})

const defaultLobbyOptions: LobbyTypeOptions = {
    maxConnections: 8,
    maxInstances: 20,
    userCreatable: true,
}

server.registerLobby("default", defaultLobbyOptions, ({lobby, server}) => {
    // new lobby created!
    // console.log(lobby)
    lobby.events.on("addConnection", ({ connection }) => {
        console.log("someone connected!")
    })
})

const wait = (n = 1000) => new Promise(resolve => setTimeout(resolve, n))

async function run(){
    console.clear()
    await server.start()
    console.log("server running")

    const client = new Client(packetManager)
    await client.connect()

    
    const input = {
        id: JSON.stringify({
            pi: Math.PI,
            n: Math.floor(Math.pow(10, Math.random() * 8))
        }),
        name: "this",
        n: Math.PI,
    }
    const code = client.packets.manager.packets.name.encode(input)
    console.log(code, code.length)
    // const buffer = new Uint8Array(code).buffer
    const peak = client.packets.manager.packets.name.peekLength(code)
    console.log(peak)
    const decode = client.packets.manager.packets.name.decode(code)
    console.log(decode)
    // console.log(client.packets.manager.packets.name.dataLength, peak, buffer, input, decode)
}

run()
