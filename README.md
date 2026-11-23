# eg-discord-bot

A small helper bot for a community Discord server, written in TypeScript with [discord.js](https://discord.js.org).
It was built for one gaming group's weekly game night and game ideas forum, so some behaviour follows that
group's conventions (described below), but every feature is optional and configured through environment variables.

## How it works

- The bot opens an **outbound** WebSocket connection to Discord. No ports need to be opened on the host.
- Features are **slash commands** (`/ping`, …) registered per server on startup, so changes appear right away.
- Node 24 runs the `.ts` files directly, so there's no build step. `tsc` only type-checks.

## Features

### Game night reminder

Every Saturday at 10:30am Pacific (`GAME_NIGHT_SCHEDULE` / `GAME_NIGHT_TIMEZONE`), the bot reads the posts in
#announcements made since the previous session and posts
`@everyone 🎮 **EG289** is starting now! We're playing **<game>**.` (plus the Steam link) in the game-night channel.

- **The weekly template:** `For EG289 (…) we'll be playing...` followed by the game in bold, `**Sky Noon**!`.
  The EG number and the post's Steam link are picked up too.
- **No session:** posts without the template that say "no official EG", "cancel", "no game", "skipping this
  week", "week off", etc. mean the bot posts nothing.
- **Anything else** (reworded announcements, "rain check this week, sick kiddo") is read by Claude, if
  `ANTHROPIC_API_KEY` is set (see [Claude API key](#claude-api-key)). Claude only gets posts the template
  can't read, and its answer must match the post: the game, EG number and Steam link must all appear in it.
- The newest post that names a game or cancels wins. Unrelated posts (surveys, recaps, other news) are skipped.
- Posts only Claude could read are handled cautiously, because **a wrong @everyone ping is worse than a missed one**:
  - Claude may cancel a session the announcement scheduled.
  - A post that confirms the announcement's game (e.g. a Saturday reminder) defers to the announcement.
  - A post that names a *different* game, or a game for a week that was cancelled, means **no post**: the DM
    explains, and you can fix it by posting or editing an announcement in the template.
  - If Claude can't read a post, nothing older is trusted over it, so **no post** either. At game time the bot
    retries for a few minutes first, then DMs the post's author that it held off.
- If no post names a game or cancels, the bot **doesn't** post.
- **Confirmation DM:** when you post or edit an announcement, the bot DMs you what it understood, quoting
  the exact start post (and saying when Claude read it). `/gamenight` shows the same thing at any time (only
  you see the reply).
- If the bot was offline at start time, it still posts if it comes back within 30 minutes. It never posts twice.

### Game suggestions

When someone creates a post in the suggestions forum, the bot looks up the post's title on Steam and replies
with the store link, price, release date, multiplayer modes and a short description. For paid games it adds
the best current price across stores and the historical low from [IsThereAnyDeal](https://isthereanydeal.com),
with a link to the game's page there (needs `ITAD_API_KEY`). If the name isn't an exact match, it says it's a
best guess and lists other matches. Try it without Discord: `npm run lookup -- "deep rock"`.

**Players and mods** (needs `ANTHROPIC_API_KEY`): the card's Players line gives the max players online and in
local play, any mod that raises the limit (e.g. ROUNDS: "Max 2 online · 2 local / Up to 16 with the Rounds
With Friends mod"), and whether only the host needs to buy the game. The bot gathers the sources itself: the
Steam page, the game's [PCGamingWiki](https://www.pcgamingwiki.com) entry and, with `TAVILY_API_KEY`, two
[Tavily](https://tavily.com) web searches (2 of the free plan's 1,000 monthly credits per game). Claude only
reads those, so every number and mod link must appear in them, and the card cites the web page it used.
PCGamingWiki is credited with a link, as its CC BY-NC-SA license requires. It doesn't use Claude's own web
search, which returns pages encrypted, so the bot couldn't check the numbers against them.
Games nothing covers say "Max players not listed".

**Tags:** the bot tags posts it creates, and adds (never removes) tags on members' posts:
Free (free on Steam), MacOS (Mac support on Steam), Only One Copy Needed (a free Friend Pass app, or only the
host needs to buy it), Max 4 Players (4 or fewer, no mod), Modding Needed (4 or fewer, but a mod raises it).
Sale tags and Banked Keys are left to people. The forum needs tags with these names (matched ignoring case);
the bot skips any it can't find. Tagging members' posts needs the **Manage Threads** permission in the forum
(included in `npm run invite`; a forum's own permission settings call it **Manage Posts**).

Members can also have the bot create the post for them, from any channel:

- **`/suggest game:<name> [note]`**: the game option suggests Steam titles as you type (the one matching
  what you typed comes first). You can also type any name, e.g. for non-Steam games. The reply is only
  visible to you.
- **`@EGBot <name>`** (or a Steam store link): mention the bot (the user or its role) at the start of a
  message. Any further lines become the note. Because chat like "@EGBot thanks!" starts the same way, this
  only creates a post when the name exactly matches a Steam game; otherwise the bot asks "Did you mean …?"
  and points to `/suggest` for adding it as written. `@EGBot help` explains the options.

The bot creates a post titled with the game's name (Steam's spelling when it's an exact match, e.g.
"hades 2" → "Hades II"). Its opening message carries the info card, and the bot's first reply credits the
suggester and quotes the note: Discord's channel list only shows posts as recently active once they have a
reply. If a post for the game already exists, open or archived, the bot links to it instead. That
includes posts whose names differ only in capitalization, punctuation, spacing or "II" vs "2", and
Steam's best guess for an inexact name ("deep rock" → "Did you mean Deep Rock Galactic?").

## Setting up the Discord application

1. In the [Discord Developer Portal](https://discord.com/developers/applications), create an application,
   then open **Bot** and reset the token to get one. Keep it secret: anyone with it can act as the bot.
2. On the same page, under **Privileged Gateway Intents**, turn on **Message Content**. Game night needs it
   to read #announcements, and game suggestions need it for "@EGBot" messages.
3. Turn off **Public Bot**, so only you can add the bot to servers. (The bot ignores servers that aren't in
   `GUILD_IDS` anyway.) If the portal refuses, first set **Installation → Install Link** to **None**.
4. Once your `.env` is set up (below), `npm run invite` prints the link that adds the bot to each server in
   `GUILD_IDS` with the permissions its features need.

Running a test copy next to the real one? Give it its own application ("MyBot Dev") and a test server. The
code copes with two copies sharing one application (each only answers in its own `GUILD_IDS`, and
message-triggered features check the server), but both then act as the same bot account.

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
| `ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY_FILE` | Claude API key: reads announcements that don't follow the template, and researches players and mods for game suggestions (optional) |
| `CLAUDE_MODEL` | Claude model for those (default `claude-opus-5-5`; must support the effort setting, e.g. any 5.x model) |
| `TAVILY_API_KEY` / `TAVILY_API_KEY_FILE` | Tavily key (free plan) for web search in the players/mods research (optional) |
| `GAME_SUGGESTIONS_CHANNEL_ID` | Enable game info replies in this forum channel |
| `ITAD_API_KEY` / `ITAD_API_KEY_FILE` | IsThereAnyDeal API key for deal info (optional). The OAuth client ID/secret aren't needed. |

To get a server's or channel's ID, turn on Developer Mode in Discord (Settings → Advanced), then right-click
it → **Copy Server ID** / **Copy Channel ID**.

### Claude API key

Create an API key in the [Claude Console](https://platform.claude.com). Some Claude subscriptions include
monthly API credits you can use instead; see
[API credits for subscribers](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers).
If the key's credits run out, requests just fail: the bot skips player research and leaves unusual
announcements unread until there are credits again. For a small server it uses well under $1 a month.

## Adding a command

1. Create `src/commands/<name>.ts` exporting a `Command` (see `ping.ts`).
2. Add it to the list in `src/commands/index.ts`.
3. Restart the bot. Commands are re-registered on startup.

## Deploying with Docker Compose

GitHub Actions ([`ci.yml`](.github/workflows/ci.yml)) runs the type-check and tests on every push and pull
request. When they pass on `master`, it builds the image and publishes it as
`ghcr.io/hwfwalton/eg-discord-bot`, tagged `latest` and `sha-<commit>` (x86-64 only). So the machine
running the bot needs only `docker-compose.yml` and a `.env`, not the source:

1. Put [`docker-compose.yml`](docker-compose.yml) in a folder on that machine.
2. Next to it, create a `.env` with the same settings as for local development (see `.env.example`), but
   with the token and keys themselves rather than `*_FILE` paths, since the container can't see files on
   the host. `chmod 600` it.
3. Run `docker compose up -d`, then check `docker compose logs -f` for `Registered … command(s)`.

To update, push to `master`, wait for the CI run to finish, and run `docker compose up -d` again: the
compose file's `pull_policy: always` fetches the newest image. To roll back, change `latest` to an older
commit's `sha-…` tag (listed on the package's GitHub page).

In a fork, Actions publishes `ghcr.io/<you>/<repo>` instead: point `image:` at it, and make the package
public in its settings (GitHub makes new packages private), or log the host in to ghcr.io. To build
on the host from source instead, replace `image:` and `pull_policy:` with `build: .`.

### On a UGREEN NAS (UGOS)

- Make a folder in the NAS's `docker` shared folder (e.g. `/volume1/docker/eg-discord-bot`) and create the
  `.env` there. `chmod 600` matters here: shared-folder files are readable by every NAS account by default.
- In UGOS: **Docker → Project → Create**, set the storage path to that folder, paste `docker-compose.yml`
  into **Compose configuration**, and deploy. UGOS saves it as `docker-compose.yaml` in the folder.
- To update: once the CI run has finished, open the project's **Compose configuration** tab and click
  **Redeploy**. It pulls the newest image either way, so the "Pull the latest image" box doesn't matter.

If you build from source on the NAS instead, note that files from a shared folder reach the image as mode
0770; the Dockerfile makes them readable for the unprivileged `node` user (without that, the bot fails with
"Cannot read package config … permission denied").

## License

MIT (see [LICENSE](LICENSE)), except the PCGamingWiki excerpt in `src/features/gameSuggestions/pcgamingwiki.test.ts`,
which stays under PCGamingWiki's [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) license.
