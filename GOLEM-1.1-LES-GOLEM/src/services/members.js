const { AuditLogEvent } = require('discord.js');
const { query, one, many } = require('../db');
const { audit } = require('./audit');

async function ensureSettings(guild) {
  await query(`
    INSERT INTO guild_settings(guild_id,guild_name)
    VALUES($1,$2)
    ON CONFLICT(guild_id) DO UPDATE SET guild_name=EXCLUDED.guild_name,updated_at=NOW()
  `,[guild.id,guild.name]);
  return getSettings();
}

async function getSettings() {
  return one(`SELECT * FROM guild_settings WHERE guild_id=$1`,[process.env.GUILD_ID]);
}

async function saveSettings(values) {
  const allowed = [
    'enabled','paused','role_clan_id','role_guardian_id','role_admin_id','role_modo_id',
    'channel_actions_id','channel_activities_id','channel_absences_id','channel_logs_id',
    'clan_inactivity_days','guardian_voice_days','notice_hours','voice_min_minutes','absence_grace_days',
    'timezone','reward_enabled','reward_base_name','reward_weekday','reward_hour'
  ];
  const sets=[]; const params=[process.env.GUILD_ID];
  for (const key of allowed) {
    if (!(key in values)) continue;
    params.push(values[key] === '' ? null : values[key]);
    sets.push(`${key}=$${params.length}`);
  }
  if (!sets.length) return getSettings();
  sets.push('updated_at=NOW()');
  await query(`UPDATE guild_settings SET ${sets.join(',')} WHERE guild_id=$1`,params);
  return getSettings();
}

async function upsertMember(member, settings=null) {
  if (!member || member.user.bot) return;
  settings = settings || await getSettings();
  const old = await one(`SELECT * FROM members WHERE guild_id=$1 AND discord_id=$2`,[member.guild.id,member.id]);
  const isClan = Boolean(settings?.role_clan_id && member.roles.cache.has(settings.role_clan_id));
  const isGuardian = Boolean(settings?.role_guardian_id && member.roles.cache.has(settings.role_guardian_id));
  let clanSince = old?.clan_since || null;
  let guardianSince = old?.guardian_since || null;
  if (isClan && !clanSince) clanSince = new Date();
  if (!isClan) clanSince = null;
  if (isGuardian && !isClan && !guardianSince) guardianSince = new Date();
  if (!isGuardian || isClan) guardianSince = null;
  await query(`
    INSERT INTO members(guild_id,discord_id,username,display_name,clan_since,guardian_since)
    VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(guild_id,discord_id) DO UPDATE SET username=EXCLUDED.username,display_name=EXCLUDED.display_name,clan_since=EXCLUDED.clan_since,guardian_since=EXCLUDED.guardian_since,updated_at=NOW()
  `,[member.guild.id,member.id,member.user.username,member.displayName,clanSince,guardianSince]);
}

async function syncGuildMembers(guild) {
  await guild.members.fetch();
  const settings = await getSettings();
  for (const member of guild.members.cache.values()) await upsertMember(member,settings);
  console.log(`✅ GOLEM // ${guild.name} : ${guild.members.cache.filter(m=>!m.user.bot).size} membres synchronisés`);
}

async function getMembers() {
  return many(`
    SELECT m.*,mr.global_rating,
      (SELECT MAX(s.clan_credit_at) FROM activity_signups s JOIN activities a ON a.id=s.activity_id
       WHERE s.guild_id=m.guild_id AND s.discord_id=m.discord_id AND a.counts_for_clan=TRUE
         AND s.status IN('registered','bench') AND s.clan_credit_at IS NOT NULL) AS last_clan_activity
    FROM members m
    LEFT JOIN member_ratings mr ON mr.guild_id=m.guild_id AND mr.discord_id=m.discord_id
    WHERE m.guild_id=$1
    ORDER BY LOWER(COALESCE(m.display_name,m.username))
  `,[process.env.GUILD_ID]);
}

async function setGlobalRating(discordId,rating) {
  await query(`
    INSERT INTO member_ratings(guild_id,discord_id,global_rating) VALUES($1,$2,$3)
    ON CONFLICT(guild_id,discord_id) DO UPDATE SET global_rating=EXCLUDED.global_rating
  `,[process.env.GUILD_ID,discordId,rating]);
}

async function findRoleActor(guild,targetId) {
  try {
    const logs = await guild.fetchAuditLogs({type:AuditLogEvent.MemberRoleUpdate,limit:6});
    const now=Date.now();
    const e=logs.entries.find(x=>x.target?.id===targetId && now-x.createdTimestamp<12000);
    return e?.executor?.id || null;
  } catch { return null; }
}

async function handleGuildMemberUpdate(oldMember,newMember,botUserId) {
  if (newMember.guild.id!==process.env.GUILD_ID || newMember.user.bot) return;
  const settings=await getSettings();
  await upsertMember(newMember,settings);
  const oldRoles=new Set(oldMember.roles.cache.keys()),newRoles=new Set(newMember.roles.cache.keys());
  const added=[...newRoles].filter(id=>!oldRoles.has(id)&&id!==newMember.guild.id);
  const removed=[...oldRoles].filter(id=>!newRoles.has(id)&&id!==newMember.guild.id);
  if (!added.length&&!removed.length) return;
  const actorId=await findRoleActor(newMember.guild,newMember.id);
  if (actorId===botUserId) return;
  for (const id of added) {
    const role=newMember.guild.roles.cache.get(id);
    await audit({actorId,targetUserId:newMember.id,source:'DISCORD',entityType:'member_role',entityId:id,action:'ROLE_ADDED',newValue:{roleId:id,roleName:role?.name||id}});
  }
  for (const id of removed) {
    const role=oldMember.guild.roles.cache.get(id);
    await audit({actorId,targetUserId:newMember.id,source:'DISCORD',entityType:'member_role',entityId:id,action:'ROLE_REMOVED',oldValue:{roleId:id,roleName:role?.name||id}});
  }
}

module.exports={ensureSettings,getSettings,saveSettings,upsertMember,syncGuildMembers,getMembers,setGlobalRating,handleGuildMemberUpdate};
