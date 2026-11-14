import { createBot } from './bot.ts';
import { loadConfig, type Config } from './config.ts';
import { log } from './log.ts';

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  log.error(`Configuration error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
const client = createBot(config);

process.on('unhandledRejection', (err) => log.error('Unhandled promise rejection', err));

// Docker sends SIGTERM on stop/restart; disconnect cleanly instead of being killed.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    log.info(`Received ${signal}, shutting down`);
    void client.destroy().finally(() => process.exit(0));
  });
}

log.info(`Starting; serving server(s): ${config.guildIds.join(', ')}`);
await client.login(config.token);
