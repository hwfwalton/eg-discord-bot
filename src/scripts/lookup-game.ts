// Try the game lookup without Discord: `npm run lookup -- "Hades II"`
// Uses ITAD_API_KEY(_FILE) for deal info, ANTHROPIC_API_KEY(_FILE) (and CLAUDE_MODEL) for player
// counts and mods, and TAVILY_API_KEY(_FILE) for web search in that research, if set.
import { createClaudeClient } from '../claude.ts';
import { parseClaude, readSecret } from '../config.ts';
import { gameInfoMessage, lookUpGame } from '../features/gameSuggestions/gameInfo.ts';
import { createItadClient } from '../features/gameSuggestions/itad.ts';
import { createResearcher } from '../features/gameSuggestions/research.ts';
import { createTavilySearch } from '../features/gameSuggestions/tavily.ts';
import { chooseTags } from '../features/gameSuggestions/tags.ts';

const query = process.argv.slice(2).join(' ').trim();
if (!query) {
  console.error('Usage: npm run lookup -- "<game name>"');
  process.exit(1);
}

const itadKey = readSecret(process.env, 'ITAD_API_KEY');
if (!itadKey) console.warn('(No ITAD_API_KEY set: skipping IsThereAnyDeal info)');
const itad = itadKey ? createItadClient(itadKey) : undefined;

const claude = parseClaude(process.env);
if (!claude) console.warn('(No ANTHROPIC_API_KEY set: skipping player counts and mods)');
const tavilyKey = readSecret(process.env, 'TAVILY_API_KEY');
if (!tavilyKey) console.warn('(No TAVILY_API_KEY set: no web search, Steam and PCGamingWiki only)');
const researcher = claude
  ? createResearcher({
      client: createClaudeClient(claude.apiKey),
      model: claude.model,
      ...(tavilyKey && { webSearch: createTavilySearch(tavilyKey) }),
    })
  : undefined;

const lookup = await lookUpGame(query, { itad, researcher });
const message = gameInfoMessage(lookup);
if (message.content) console.log(message.content);
for (const embed of message.embeds ?? []) {
  const e = 'toJSON' in embed ? embed.toJSON() : embed;
  console.log(`\n${e.title}  ${e.url ?? ''}`);
  if (e.description) console.log(e.description);
  for (const f of e.fields ?? []) console.log(`  ${f.name}: ${f.value.replace(/\n/g, '\n    ')}`);
  if (e.image) console.log(`  [image] ${e.image.url}`);
  if (e.footer) console.log(`  -- ${e.footer.text}`);
}
console.log(`\nTags: ${chooseTags(lookup).join(', ') || '(none)'}`);
