# Deploying to Railway

pip-pip deploys as a **single combined Railway service**. One service builds the whole
repo via the root `Dockerfile` and runs the Node server (`packages/server/dist/index.js`).
That single process serves:

- the game's HTTP REST API (under `/hrzn`),
- the WebSocket connection (same port), and
- the built React client as static files, with SPA fallback for client-side routes.

The client is served same-origin, so the browser connects back to wherever it loaded from.
There is **no server-URL configuration** on the client.

## How Railway builds it

Railway reads `railway.json` at the repo root and:

- selects the **`DOCKERFILE`** builder (builds from the root `Dockerfile`),
- runs a **healthcheck against `/hrzn`**, and
- **restarts on failure**.

The image runs `yarn build` (core -> game -> server -> client) and starts the server,
which serves the prebuilt client from `packages/client/dist`.

## Environment variables

| Name | Required | Purpose | Notes |
|---|---|---|---|
| `PORT` | Auto | Port the server listens on. | Injected by Railway; honored automatically. **Don't set manually.** |
| `NODE_ENV` | Auto | Marks runtime as production. | Set to `production` by the image; no action needed. |
| `HRZN_ALLOWED_ORIGINS` | Optional | Comma-separated allowed `Origin` values for CORS and WebSocket upgrades. | Unset = allow all. Set to your public app URL to harden. |
| `CLIENT_DIR` | Optional | Overrides where the server looks for the built client. | Defaults to `packages/client/dist`. Only for non-standard layouts. |
| `HRZN_FORCE_LATENCY` | No | Dev-only: artificial latency. | Keep **unset** in production. |
| `HRZN_FORCE_JITTER` | No | Dev-only: artificial jitter. | Keep **unset** in production. |
| `DEBUG_HRZN_EVENTS` | No | Dev-only: verbose event logging. | Keep **unset** in production. |
| `TELEGRAM_TOKEN` | Optional | Bot token for the optional Telegram analytics/control bot. | Unset/empty = feature fully off (no polling, no broadcasts). Get a token from @BotFather. |
| `TELEGRAM_USER_IDS` | Optional | Comma-separated numeric Telegram user ids that are admins. | Admins get broadcasts and may run privileged commands. Message the bot `/userinfo` to learn your id. Spaces/trailing commas tolerated. |

## Telegram bot (optional)

Set `TELEGRAM_TOKEN` to enable a small analytics/control bot; unset, the whole
feature is off. Create a bot via @BotFather, set the token, message your bot
`/userinfo` to learn your numeric id, then set `TELEGRAM_USER_IDS` to that id
(comma-separated for multiple admins) and redeploy.

Broadcasts to admins: server start, lobby created, player connects, a
player-count milestone, and match started. Commands: `/userinfo`, `/start`,
`/ping` are public; `/status`, `/stats`, `/players`, `/lobbies`, `/dice`,
`/reboot` are admin only. Every call is wrapped and runs off the game tick, so a
Telegram outage never crashes or blocks the server.

## Scaling: single replica only

> **Important:** run as a single replica (`numReplicas: 1`).

Connection and lobby state live **in memory**, and the HTTP -> WebSocket handshake token
is resolved **in the process that issued it**. Multiple replicas would split that state and
break connections (a client could hit a different replica than the one holding its token or
lobby). Horizontal scaling would need a shared session store (e.g. Redis), which is **out of
scope** here.

## Deploy steps

1. Create a Railway project from this GitHub repo.
2. Railway picks up `railway.json` and the root `Dockerfile` automatically, no extra config.
3. The first deploy builds the image and serves the app on the generated Railway domain.
4. WebSockets work over `wss` on port 443 through Railway's proxy automatically.

## Local production sanity check

Verify a production build locally before deploying:

```sh
yarn build
node packages/server/dist/index.js
```

Open the URL printed on startup. The client should load and connect back to the same origin.
