// Prints the link for adding the bot to a server: `npm run invite`
import { OAuth2Scopes, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { applicationIdFromToken, loadConfig } from '../config.ts';

// Only what current features need. When a feature needs more, add it here and
// re-invite (re-inviting an existing bot just updates its permissions).
const permissions = new PermissionsBitField([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.MentionEveryone, // game night's @everyone start post
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.SendMessagesInThreads,
]);

const { token, guildIds } = loadConfig();
const url = new URL('https://discord.com/oauth2/authorize');
url.searchParams.set('client_id', applicationIdFromToken(token));
url.searchParams.set('scope', [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands].join(' '));
url.searchParams.set('permissions', permissions.bitfield.toString());

for (const guildId of guildIds) {
  url.searchParams.set('guild_id', guildId);
  console.log(`Server ${guildId}:\n  ${url}\n`);
}
