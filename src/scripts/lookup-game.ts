// Try the game lookup without Discord: `npm run lookup -- "Hades II"`
import { gameInfoMessage, lookUpGame } from '../features/gameSuggestions/gameInfo.ts';

const query = process.argv.slice(2).join(' ').trim();
if (!query) {
  console.error('Usage: npm run lookup -- "<game name>"');
  process.exit(1);
}

const message = gameInfoMessage(await lookUpGame(query));
if (message.content) console.log(message.content);
for (const embed of message.embeds ?? []) {
  const e = 'toJSON' in embed ? embed.toJSON() : embed;
  console.log(`\n${e.title}  ${e.url ?? ''}`);
  if (e.description) console.log(e.description);
  for (const f of e.fields ?? []) console.log(`  ${f.name}: ${f.value}`);
  if (e.image) console.log(`  [image] ${e.image.url}`);
  if (e.footer) console.log(`  -- ${e.footer.text}`);
}
