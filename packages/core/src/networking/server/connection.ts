import { Request } from "express"

import { PacketManagerSerializerMap } from "../packets/manager"
import { Connection } from "../connection"
import { Server } from "."

export function initializeConnectionMethods<
    T extends PacketManagerSerializerMap,
    R extends Record<string, any>,
    P extends Record<string, any>,
>(server: Server<T, R, P>){
    server.getConnectionFromRequest = (req: Request) => {
        if(typeof req.headers[server.options.authHeader] !== "undefined"){
            const connectionToken = req.headers[server.options.authHeader]
            if(typeof connectionToken === "string"){
                const connection = server.getConnectionByConnectionToken(connectionToken)
                return connection
            }
        }

        return undefined
    }

    server.getConnectionByConnectionToken = (connectionToken: string) => {
        for(const connectionId in server.connections){
            const connection = server.connections[connectionId]
            if(connection.token.connection === connectionToken) return connection
        }
        return undefined
    }

    server.getConnectionByWebSocketToken = (websocketToken: string) => {
        for(const connectionId in server.connections){
            const connection = server.connections[connectionId]
            if(connection.token.websocket === websocketToken) return connection
        }
        return undefined
    }

    server.addConnection = (connection: Connection<T, R, P>) => {
        if(connection.id in server.connections){
            throw new Error(`Connection "${connection.id}" already exists.`)
        }

        if(Object.keys(server.connections).length >= server.options.maxConnections){
            throw new Error("Server has reached max connections.")
        }

        server.connections[connection.id] = connection
        server.events.emit("addConnection", {
            connection,
        })
    }

    server.removeConnection = (connection: Connection<T, R, P>) => {
        if(connection.id in server.connections){
            delete server.connections[connection.id]
            server.events.emit("removeConnection", {
                connection,
            })
            connection.destroy()
        }
    }

    server.broadcast = (data: string | ArrayBuffer) => {
        for(const connectionId in server.connections){
            server.connections[connectionId].send(data)
        }
    }
}