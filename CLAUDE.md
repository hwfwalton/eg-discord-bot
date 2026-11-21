# eg-discord-bot

Personal-project Discord bot for a small (<50 user) community server. Not moderation: small automations
(event reminders, game info lookups, auto-creating threads). Deployed via Docker Compose on a UGREEN
DXP2800 NAS (x86-64), developed on an Apple Silicon Mac. The owner is new to Discord bot development, so
explain Discord-specific concepts (intents, permissions, interactions) when they come up.

## Stack and conventions

- TypeScript run **directly by Node 24** (type stripping): no build step, no bundler. `tsc` is type-check only.
  - Relative imports must use the `.ts` extension.
  - No enums, namespaces, or constructor parameter properties (`erasableSyntaxOnly`).
  - Use `import type` for type-only imports (`verbatimModuleSyntax`).
- discord.js v14, slash commands only. Each command is a `Command` in `src/commands/`, listed in
  `src/commands/index.ts`. Commands are registered per server on `ClientReady` (instant updates).
- Features live in `src/features/<name>/`: pure logic (parsing, decisions, message text) in separate
  files with tests, and one `register…(client, config)` file holding the Discord event wiring. Features are
  optional and turn on when their env vars are set (`src/config.ts`).
- Game night (`src/features/gameNight/`) is stateless: everything is re-derived from the #announcements
  history and the cron schedule (no database). Prefer not posting over a wrong @everyone ping.
- Claude (`src/claude.ts`) uses Anthropic's official SDK (`@anthropic-ai/sdk`) with structured outputs
  (`askForJson`; every schema object needs `additionalProperties: false`) and server-side refusal
  fallbacks. Keep `baseURL` and `apiKey` explicit: Claude Code sets `ANTHROPIC_BASE_URL` in its shells,
  and the SDK would otherwise follow it. The key comes from the owner's Max-plan monthly API credits
  (requests just stop when they run out). Default model `claude-opus-5-5` (`CLAUDE_MODEL`). The local key
  lives at `~/.config/eg-discord-bot/anthropic-api-key`.
- Announcements are read by the template parser (`announcement.ts`) first. Only posts it can't classify go
  to Claude (`claudeReader.ts`). Claude's output is untrusted: the game, EG label and Steam link must all
  come from the post's text. A Claude failure or ungrounded answer is `unreadable`, never `unclear`:
  `decidePlan` must not let an older post decide over a post it couldn't read. Claude may cancel, but a
  Claude game that contradicts the week's template decision gives an `unsure` plan (no ping). Readings
  are cached in memory, so the bot pre-reads the window on startup and retries for a few minutes at game
  time (`planWithRetries`).
- Game suggestions (`src/features/gameSuggestions/`) use Steam's keyless store API plus IsThereAnyDeal's API
  (API key only, as the `key` query param; the OAuth client ID/secret aren't used). ITAD is skipped for
  free games and failures fall back to a Steam-only reply. The local key lives at
  `~/.config/eg-discord-bot/itad-api-key`.
- Player counts/mods (`research.ts`): the bot gathers the Steam page, PCGamingWiki (`pcgamingwiki.ts`,
  keyless MediaWiki API; CC BY-NC-SA, so link it) and two Tavily searches (`tavily.ts`, optional, 1 credit
  each) and Claude only extracts from that text; numbers and mod URLs must appear in it, and a cited web
  page must be one of the results. Don't swap Tavily for Claude's web search tool: its results come back
  encrypted (only short quotes are readable), so numbers couldn't be checked. Tags (`tags.ts`) follow
  the forum's conventions; adding tags to members' posts needs Manage Threads (never remove theirs).
- `/suggest` and "@EGBot <game>" (`suggest.ts`) create forum posts with the info card in the post's
  opening message. Don't route bot-created posts through the ThreadCreate handler: discord.js reports
  them with `newlyCreated: false` when the REST response wins the race with the gateway event. Posts
  are de-duplicated against open and archived posts by `gameKey`. "@EGBot" passes
  `requireExactMatch` so chat that starts with a mention never creates a post; `/suggest` doesn't.
- Anything triggered by a message (not an interaction) must check it's in this instance's own server:
  dev and prod share one bot account, so each instance sees the other server's messages.
- Shared name helpers live in `src/gameName.ts`: `cleanGameName` (strip Discord markup; quotes and
  brackets only in matching pairs, since game night uses it too), `displayGameName`, and the comparison
  keys `normalizeGameName` (word-level) and `gameKey` (also ignores spacing; "" for non-Latin names).
- Keep gateway intents and invite permissions minimal. Add intents in `src/bot.ts` and permissions in
  `src/scripts/invite-url.ts` only when a feature needs them. Message Content (privileged) is enabled in
  the Developer Portal and used by game night and "@EGBot"; avoid adding other privileged intents.
- Vitest for tests, colocated as `*.test.ts`. Run `npm run check` before calling work done.
- Config comes only from env (`src/config.ts`). Never commit tokens; the local token lives at
  `~/.config/eg-discord-bot/discord-bot-token`, referenced from the gitignored `.env`.

## Servers

- Dev/test server: `234567890123456789` (the local `.env` default)
- Prod server: `123456789012345678` (set in `docker-compose.yml`)
- Dev and prod share one bot application (ID `345678901234567890`). Each instance ignores interactions
  from servers outside its `GUILD_IDS`.
