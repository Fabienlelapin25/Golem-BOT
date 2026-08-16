require('dotenv').config();

process.env.CLIENT_ID = process.env.CLIENT_ID || '1536780542589141003';
process.env.GUILD_ID = process.env.GUILD_ID || '1205745884046958622';

const { Client, GatewayIntentBits } = require('discord.js');
const { initDatabase } = require('./src/db');
const { registerGuildCommands } = require('./src/discord/commands');
const { registerDiscordEvents } = require('./src/discord/events');
const { startWebServer } = require('./src/web/server');
const { ensureSettings, syncGuildMembers } = require('./src/services/members');
const { recoverVoiceSessions } = require('./src/services/voice');
const { initializeRuntimeSafety, startHeartbeat } = require('./src/services/safety');
const { startSchedulers } = require('./src/services/scheduler');

async function main() {
  for (const name of ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID', 'DATABASE_URL']) {
    if (!process.env[name]) throw new Error(`Variable manquante : ${name}`);
  }

  await initDatabase();
  await registerGuildCommands();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates
    ]
  });

  registerDiscordEvents(client);
  startWebServer(client);

  client.once('ready', async () => {
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild) {
      console.error(`GOLEM // Le serveur autorisé ${process.env.GUILD_ID} est introuvable.`);
      return;
    }

    await ensureSettings(guild);
    await syncGuildMembers(guild);
    await recoverVoiceSessions(guild);
    await initializeRuntimeSafety(guild.id);
    startHeartbeat(guild.id);
    startSchedulers(client);

    console.log('================================');
    console.log(' GOLEM // LES GOLEM // ONLINE');
    console.log(` ${guild.name} (${guild.id})`);
    console.log(` ${client.user.tag}`);
    console.log('================================');
  });

  await client.login(process.env.DISCORD_TOKEN);
}

main().catch(error => {
  console.error('GOLEM // FATAL', error);
  process.exit(1);
});
