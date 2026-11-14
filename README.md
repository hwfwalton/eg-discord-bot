# eg-discord-bot

A small helper bot for our community Discord server, written in TypeScript with [discord.js](https://discord.js.org).

## How it works

- The bot opens an **outbound** WebSocket connection to Discord. No ports need to be opened on the NAS.
- Features are **slash commands** (`/ping`, …) registered per server on startup, so changes appear right away.
- Node 24 runs the `.ts` files directly, so there's no build step. `tsc` only type-checks.

## Features

### Game night reminder

Every Saturday at 10:30am Pacific (`GAME_NIGHT_SCHEDULE` / `GAME_NIGHT_TIMEZONE`), the bot reads the posts in
#announcements made since the previous session and posts `@everyone Game night is starting! This week we're playing **<game>**`
in the game-night channel.

- **The game is the first bolded text** in the announcement: `**Hades II**`.
- **No session:** phrases like "no game", "no session", "cancelled", "skipping this week" or "week off" mean
  the bot posts nothing. A cancellation wins over a bolded name.
- The newest post that names a game or cancels wins. Unrelated posts (other news) don't override it.
- If no post names a game or cancels, the bot **doesn't** post. A wrong @everyone ping is worse than a missed one.
- **Confirmation DM:** when you post or edit an announcement, the bot DMs you what it understood.
  `/gamenight` shows the same thing at any time (only you see the reply).
- If the bot was offline at start time, it still posts if it comes back within 30 minutes. It never posts twice.

### Game suggestions

When someone creates a post in the suggestions forum, the bot looks up the post's title on Steam and replies
with the store link, price, release date, multiplayer modes and a short description. If the name isn't an exact
match, it says it's a best guess and lists other matches. Try it without Discord:
`npm run lookup -- "deep rock"`.

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
| `GAME_NIGHT_ANNOUNCEMENTS_CHANNEL_ID`, `GAME_NIGHT_CHANNEL_ID` | Enable the game night reminder |
| `GAME_NIGHT_SCHEDULE`, `GAME_NIGHT_TIMEZONE` | When sessions start (default `30 10 * * 6`, `America/Los_Angeles`) |
| `GAME_SUGGESTIONS_CHANNEL_ID` | Enable game info replies in this forum channel |

To get a channel's ID, turn on Developer Mode in Discord (Settings → Advanced), then right-click the channel → **Copy Channel ID**.

The game night feature needs the **Message Content** intent, which is switched on in the
[Developer Portal](https://discord.com/developers/applications) → Bot → Privileged Gateway Intents.

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
