// Try the game lookup without Discord: `npm run lookup -- "Hades II"`
// Uses ITAD_API_KEY / ITAD_API_KEY_FILE from .env for deal info, if set.
import { readSecret } from '../config.ts';
import { gameInfoMessage, lookUpGame } from '../features/gameSuggestions/gameInfo.ts';
import { createItadClient } from '../features/gameSuggestions/itad.ts';

const query = process.argv.slice(2).join(' ').trim();
if (!query) {
  console.error('Usage: npm run lookup -- "<game name>"');
  process.exit(1);
}

const itadKey = readSecret(process.env, 'ITAD_API_KEY');
if (!itadKey) console.warn('(No ITAD_API_KEY set: skipping IsThereAnyDeal info)');
const itad = itadKey ? createItadClient(itadKey) : undefined;

const message = gameInfoMessage(await lookUpGame(query, { itad }));
if (message.content) console.log(message.content);
for (const embed of message.embeds ?? []) {
  const e = 'toJSON' in embed ? embed.toJSON() : embed;
  console.log(`\n${e.title}  ${e.url ?? ''}`);
  if (e.description) console.log(e.description);
  for (const f of e.fields ?? []) console.log(`  ${f.name}: ${f.value}`);
  if (e.image) console.log(`  [image] ${e.image.url}`);
  if (e.footer) console.log(`  -- ${e.footer.text}`);
}
