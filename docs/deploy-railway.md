# Deploying to Railway

pip-pip deploys as a **single combined Railway service**. One service builds the
whole repo via the root `Dockerfile` and runs the Node server
(`packages/server/dist/index.js`). That single process serves everything:

- the game's HTTP REST API (under `/hrzn`),
- the WebSocket connection (on the same port), and
- the built React client as static files, with SPA fallback for client-side routes.

Because the client is served from the same origin as the game server, the browser
connects back to wherever it was loaded from. There is **no server-URL configuration**
to set on the client.

## How Railway builds it

Railway reads `railway.json` at the repo root and:

- selects the **`DOCKERFILE`** builder (it builds the image from the root `Dockerfile`),
- runs a **healthcheck against `/hrzn`** to confirm the service is live, and
- **restarts on failure**.

The Docker image runs `yarn build` (core → game → server → client) and starts the
server, which then serves the prebuilt client from `packages/client/dist`.

## Environment variables

| Name | Required | Purpose | Notes |
|---|---|---|---|
| `PORT` | Auto | The port the server listens on. | Injected automatically by Railway; the server honors it. **Do not set it manually.** |
| `NODE_ENV` | Auto | Marks the runtime as production. | Set to `production` by the Docker image; no action needed. |
| `HRZN_ALLOWED_ORIGINS` | Optional | Comma-separated list of allowed `Origin` values for CORS and WebSocket upgrades. | Leave unset to allow all origins. Set it to your public app URL to harden the deployment. |
| `CLIENT_DIR` | Optional | Overrides where the server looks for the built client. | Defaults to `packages/client/dist`. Only needed for non-standard layouts. |
| `HRZN_FORCE_LATENCY` | No | Dev-only: injects artificial latency. | Must stay **unset** in production. |
| `HRZN_FORCE_JITTER` | No | Dev-only: injects artificial jitter. | Must stay **unset** in production. |
| `DEBUG_HRZN_EVENTS` | No | Dev-only: verbose event logging. | Must stay **unset** in production. |

## Scaling: single replica only

> **Important:** this service **must run as a single replica** (`numReplicas: 1`).

Connection and lobby state live **in memory**, and the HTTP → WebSocket handshake
token is resolved **in the same process** that issued it. Running multiple replicas
would split that state across processes and break connections (a client could hit a
different replica than the one holding its handshake token or lobby).

Horizontal scaling would require a shared session store (for example, Redis) to hold
connection/lobby state and handshake tokens across processes. That is **out of scope**
for this deployment.

## Deploy steps

1. Create a new Railway project from this GitHub repo.
2. Railway picks up `railway.json` and the root `Dockerfile` automatically — no extra
   configuration required.
3. The first deploy builds the image and serves the app on the generated Railway domain.
4. WebSockets work over `wss` on the standard port 443 through Railway's proxy
   automatically — no extra setup.

## Local production sanity check

To verify a production build locally before deploying:

```sh
yarn build
node packages/server/dist/index.js
```

Then open the URL printed on startup in your browser. The client should load and connect
back to the same origin.
