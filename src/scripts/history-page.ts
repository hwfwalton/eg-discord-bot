// Serve the session history page from the record alone, without connecting to Discord:
// `npm run history`, then open the address it prints. Handy for checking edits to sessions.csv and
// games.csv. Uses HISTORY_DIR, HISTORY_TITLE and HISTORY_PORT (default 8480) from the environment.
import { parseHistory } from '../config.ts';
import { startHistoryServer } from '../features/history/history.ts';
import { createHistoryStore } from '../features/history/store.ts';

const config = parseHistory({ ...process.env, HISTORY_PORT: process.env.HISTORY_PORT?.trim() || '8480' });
if (!config) throw new Error('unreachable: HISTORY_PORT has a default here');

const store = createHistoryStore({ dir: config.dir, title: config.title, timezone: config.timezone });
startHistoryServer(config, store);
