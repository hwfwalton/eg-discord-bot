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
- Keep gateway intents and invite permissions minimal. Add intents in `src/bot.ts` and permissions in
  `src/scripts/invite-url.ts` only when a feature needs them, and avoid privileged intents (Message Content).
- Vitest for tests, colocated as `*.test.ts`. Run `npm run check` before calling work done.
- Config comes only from env (`src/config.ts`). Never commit tokens; the local token lives at
  `~/.config/eg-discord-bot/discord-bot-token`, referenced from the gitignored `.env`.

## Servers

- Dev/test server: `234567890123456789` (the local `.env` default)
- Prod server: `123456789012345678` (set in `docker-compose.yml`)
- Dev and prod share one bot application (ID `345678901234567890`). Each instance ignores interactions
  from servers outside its `GUILD_IDS`.
