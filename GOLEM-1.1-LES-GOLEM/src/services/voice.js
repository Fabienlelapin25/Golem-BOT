const { query, one, many } = require('../db');
const { audit } = require('./audit');
const { getSettings } = require('./members');

async function startVoice(guildId,userId,channelId) {
  await query(`
    INSERT INTO voice_sessions(guild_id,discord_id,channel_id,started_at,validated_at)
    VALUES($1,$2,$3,NOW(),NULL)
    ON CONFLICT(guild_id,discord_id) DO UPDATE SET channel_id=EXCLUDED.channel_id,updated_at=NOW()
  `,[guildId,userId,channelId]);
}

async function endVoice(guildId,userId) {
  const s=await one(`SELECT * FROM voice_sessions WHERE guild_id=$1 AND discord_id=$2`,[guildId,userId]);
  if (!s) return;
  const seconds=Math.max(0,Math.floor((Date.now()-new Date(s.started_at))/1000));
  await query(`DELETE FROM voice_sessions WHERE guild_id=$1 AND discord_id=$2`,[guildId,userId]);
  await audit({targetUserId:userId,source:'GOLEM',entityType:'voice_session',action:'VOICE_SESSION_ENDED',details:{durationSeconds:seconds,validated:Boolean(s.validated_at)}});
}

async function handleVoiceStateUpdate(oldState,newState) {
  const member=newState.member||oldState.member;
  if (!member||member.user.bot||member.guild.id!==process.env.GUILD_ID) return;
  if (!oldState.channelId&&newState.channelId) return startVoice(member.guild.id,member.id,newState.channelId);
  if (oldState.channelId&&!newState.channelId) return endVoice(member.guild.id,member.id);
  if (oldState.channelId&&newState.channelId&&oldState.channelId!==newState.channelId) {
    await query(`UPDATE voice_sessions SET channel_id=$3,updated_at=NOW() WHERE guild_id=$1 AND discord_id=$2`,[member.guild.id,member.id,newState.channelId]);
  }
}

async function recoverVoiceSessions(guild) {
  for (const state of guild.voiceStates.cache.values()) {
    const m=state.member;
    if (!m||m.user.bot||!state.channelId) continue;
    const exists=await one(`SELECT * FROM voice_sessions WHERE guild_id=$1 AND discord_id=$2`,[guild.id,m.id]);
    if (!exists) await startVoice(guild.id,m.id,state.channelId);
  }
}

async function validateOpenVoiceSessions(client) {
  const settings=await getSettings();
  if (!settings) return;
  const min=Math.max(1,Number(settings.voice_min_minutes||5));
  const sessions=await many(`SELECT * FROM voice_sessions WHERE guild_id=$1 AND validated_at IS NULL`,[process.env.GUILD_ID]);
  const guild=client.guilds.cache.get(process.env.GUILD_ID);
  for (const s of sessions) {
    if (Date.now()-new Date(s.started_at)<min*60000) continue;
    const vs=guild?.voiceStates.cache.get(s.discord_id);
    if (!vs?.channelId) { await endVoice(s.guild_id,s.discord_id); continue; }
    await query(`UPDATE voice_sessions SET validated_at=NOW(),updated_at=NOW() WHERE guild_id=$1 AND discord_id=$2`,[s.guild_id,s.discord_id]);
    await query(`UPDATE members SET last_valid_voice_at=NOW(),updated_at=NOW() WHERE guild_id=$1 AND discord_id=$2`,[s.guild_id,s.discord_id]);
    await audit({targetUserId:s.discord_id,source:'GOLEM',entityType:'voice_session',action:'VOICE_VALIDATED',details:{minimumMinutes:min,channelId:vs.channelId}});
  }
}

module.exports={handleVoiceStateUpdate,recoverVoiceSessions,validateOpenVoiceSessions};
