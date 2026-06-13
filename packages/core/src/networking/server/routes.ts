import express, { Router as createRouter, Request, Response, NextFunction } from "express"
import createHttpError from "http-errors"
import bodyParser from "body-parser"
import cors from "cors"
import path from "path"

import { asyncHandler, handle404Error, handleError } from "../../lib/express"
import { PacketManagerSerializerMap } from "../packets/manager"
import { ConnectionLobbyJSON } from "../api/types"
import { Connection } from "../connection"
import { Server } from "."

export function initializeRoutes<
    T extends PacketManagerSerializerMap,
    R extends Record<string, any>,
    P extends Record<string, any>,
>(server: Server<T, R, P>){
    if(Array.isArray(server.options.allowedOrigins) && server.options.allowedOrigins.length > 0){
        server.app.use(cors({ origin: server.options.allowedOrigins }))
    } else {
        server.app.use(cors())
    }
    server.app.use(bodyParser.json())

    const router = createRouter()

    server.routerAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
        const connection = server.getConnectionFromRequest(req)
        if(typeof connection === "undefined"){
            next(createHttpError(401, "Connection not authorized."))
        }
        next()
    }

    router.get("/", (req, res) => {
        res.json({
            message: "Welcome to Horizon Engine. ;)",
        })
    })

    // Create connection
    router.post("/connection", asyncHandler(async (req: Request, res: Response) => {
        const connection = new Connection(server)
        server.addConnection(connection)
        server.events.emit("createConnection", {connection})
        res.json(connection.toJson(true))
    }))

    // Get connection details
    router.get("/connection", server.routerAuthMiddleware, asyncHandler(async (req: Request, res: Response) => {
        const connection = server.getConnectionFromRequest(req) as Connection<T, R, P>
        
        res.json(connection.toJson())
    }))

    // Get connection lobby
    router.get("/connection/lobby", server.routerAuthMiddleware, asyncHandler(async (req: Request, res: Response) => {
        const connection = server.getConnectionFromRequest(req) as Connection<T, R, P>
        if(typeof connection.lobby === "undefined") throw createHttpError(400, "Connection not in lobby.")

        const lobby = connection.lobby
        if(typeof lobby === "undefined") throw createHttpError(400, "Connection is not connected to any lobby.")

        const output: ConnectionLobbyJSON = {
            connection: connection.toJson(),
            lobby: lobby.toJson()
        }

        res.json(output)
    }))


    // Create lobby details
    router.get("/lobbies", server.routerAuthMiddleware, asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
        if(typeof req.query.id !== "string") {
            next()
            return
        }

        const id = req.query.id

        if(!(id in server.lobbies)) throw createHttpError(400, "Lobby not found.")

        const lobby = server.lobbies[id]

        res.json(lobby.toJson())
    }))

    // Get available lobbies
    router.get("/lobbies", server.routerAuthMiddleware, asyncHandler(async (req: Request, res: Response) => {
        res.json(typeof server.getPublicLobbies === "function" ? server.getPublicLobbies() : [])
    }))

    // Create lobby
    router.post("/lobbies", server.routerAuthMiddleware, asyncHandler(async (req: Request, res: Response) => {
        if(typeof req.body.type !== "string") throw createHttpError(422, "Lobby type not specified.")

        const type = req.body.type

        if(!(type in server.lobbyType)) throw createHttpError(400, "Lobby type not found.")

        const lobbyType = server.lobbyType[type]
        if(lobbyType.options.userCreatable === false) throw createHttpError(401, "Lobby cannot be created.")

        const options = typeof req.body.options === "object" && req.body.options !== null
            ? req.body.options as Record<string, unknown>
            : undefined

        const lobby = server.createLobby(type, undefined, options)

        res.json(lobby.toJson())
    }))

    // Join a lobby
    router.post("/lobbies/join", server.routerAuthMiddleware, asyncHandler(async (req: Request, res: Response) => {
        if(typeof req.body.id !== "string") throw createHttpError(422, "ID required to specify lobby.")

        const id = req.body.id

        if(!(id in server.lobbies)) throw createHttpError(400, "Lobby not found.")

        const lobby = server.lobbies[id]
        const connection = server.getConnectionFromRequest(req) as Connection<T, R, P>

        lobby.addConnection(connection)

        const output: ConnectionLobbyJSON = {
            connection: connection.toJson(),
            lobby: lobby.toJson()
        }

        res.json(output)
    }))

    // Leave a lobby
    router.post("/lobbies/leave", server.routerAuthMiddleware, asyncHandler(async (req: Request, res: Response) => {
        const connection = server.getConnectionFromRequest(req) as Connection<T, R, P>
        if(typeof connection.lobby === "undefined") throw createHttpError(400, "Connection not in lobby.")

        const lobby = connection.lobby
        lobby.removeConnection(connection)

        const output: ConnectionLobbyJSON = {
            connection: connection.toJson(),
            lobby: lobby.toJson()
        }

        res.json(output)
    }))

    server.start = () => new Promise<void>((resolve) => {
        // TODO: Register debugging routes if enabled in options
        server.app.use(server.options.baseRoute, router)
        if(typeof server.options.clientDir === "string"){
            server.app.use(express.static(server.options.clientDir))
            server.app.use((req: Request, res: Response, next: NextFunction) => {
                if(req.method !== "GET") return next()
                if(req.path.startsWith(server.options.baseRoute)) return next()
                res.sendFile(path.join(server.options.clientDir as string, "index.html"))
            })
        }
        server.app.use(handle404Error)
        server.app.use(handleError)
        server.server.listen(server.options.port, () => {
            server.events.emit("start")
            resolve()
        })
    })
}