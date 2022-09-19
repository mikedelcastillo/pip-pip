import { Client } from "@pip-pip/core/src/client"
import { PipPipPacketMap } from "./packets"

export type PublicConnectionData = {
    name: string,
}

export type ClientTypes = {
    PublicConnectionData: PublicConnectionData,
    PacketMap: PipPipPacketMap
}

export class PipPipClient extends Client<ClientTypes>{
    constructor(port = 3000){
        super({ port })
    }
}