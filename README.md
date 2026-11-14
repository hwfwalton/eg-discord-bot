# eg-discord-bot

A small helper bot for our community Discord server, written in TypeScript with [discord.js](https://discord.js.org).

## How it works

- The bot opens an **outbound** WebSocket connection to Discord. No ports need to be opened on the NAS.
- Features are **slash commands** (`/ping`, …) registered per server on startup, so changes appear right away.
- Node 24 runs the `.ts` files directly, so there's no build step. `tsc` only type-checks.

## Local development

Requires Node 24+.

```bash
npm install
cp .env.example .env     # then set DISCORD_TOKEN_FILE (or DISCORD_TOKEN) and GUILD_IDS
npm run dev              # runs the bot, restarts on file changes
npm run check            # type-check + tests
npm run invite           # prints the link for adding the bot to each server in GUILD_IDS
```

| Variable             | Meaning                                                  |
| -------------------- | -------------------------------------------------------- |
| `DISCORD_TOKEN`      | Bot token                                                |
| `DISCORD_TOKEN_FILE` | Path to a file containing the token (used if the above is unset) |
| `GUILD_IDS`          | Comma-separated server IDs this instance serves          |

Servers:

- **Dev (test server):** `234567890123456789`
- **Prod:** `123456789012345678`

> ⚠️ Dev and prod currently share **one** bot application. Each instance only *answers* commands
> in its own `GUILD_IDS`, but while both are running they share one bot account and identity.
> If that gets confusing, create a second application ("EGBot Dev") in the
> [Developer Portal](https://discord.com/developers/applications) and use its token locally.

## Adding a command

1. Create `src/commands/<name>.ts` exporting a `Command` (see `ping.ts`).
2. Add it to the list in `src/commands/index.ts`.
3. Restart the bot. Commands are re-registered on startup.

## Deploying to the NAS (UGREEN DXP2800)

The NAS is x86-64 (`linux/amd64`). The simplest setup is to build the image on the NAS itself:

1. Copy this project to a folder on the NAS, e.g. `/volume1/docker/eg-discord-bot`. `node_modules`, `.env`
   and `.git` aren't needed there.
2. In that folder, create a `.env` file containing `DISCORD_TOKEN=<the bot token>`.
3. Either:
   - **UGOS:** Docker → Project → Create, point it at that folder (it picks up `docker-compose.yml`), and deploy; or
   - **SSH:** `cd /volume1/docker/eg-discord-bot && docker compose up -d --build`
4. Check the logs (UGOS container logs, or `docker logs -f eg-discord-bot`) for `Registered … command(s)`.

To update, copy the new source over and rebuild (`docker compose up -d --build`).
