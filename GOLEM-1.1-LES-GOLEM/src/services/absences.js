const { EmbedBuilder } = require('discord.js');
const { query, one, many } = require('../db');
const { audit } = require('./audit');
const { getSettings } = require('./members');

async function listAbsences() {
  return many(`
    SELECT a.*,m.username,m.display_name
    FROM absences a LEFT JOIN members m ON m.guild_id=a.guild_id AND m.discord_id=a.discord_id
    WHERE a.guild_id=$1 ORDER BY a.created_at DESC
  `,[process.env.GUILD_ID]);
}

async function createAbsence(client,actorId,data) {
  if (!data.discord_id||!data.start_date||!data.return_date) throw new Error('Membre, début et retour obligatoires.');
  if (new Date(data.return_date)<new Date(data.start_date)) throw new Error('La date de retour doit être après le début.');
  const row=await one(`
    INSERT INTO absences(guild_id,discord_id,start_date,return_date,reason,created_by)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *
  `,[process.env.GUILD_ID,data.discord_id,data.start_date,data.return_date,data.reason||null,actorId]);
  await audit({actorId,targetUserId:data.discord_id,source:'STAFF',entityType:'absence',entityId:row.id,action:'ABSENCE_CREATED',newValue:row});
  const settings=await getSettings();
  const guild=client.guilds.cache.get(process.env.GUILD_ID);
  const channel=guild?.channels.cache.get(settings?.channel_absences_id);
  if (channel?.isTextBased()) {
    const embed=new EmbedBuilder().setTitle('◇ GOLEM // ABSENCE PROGRAMMÉE').addFields(
      {name:'Membre',value:`<@${data.discord_id}>`},{name:'Début',value:String(data.start_date),inline:true},{name:'Retour',value:String(data.return_date),inline:true},{name:'Motif',value:data.reason||'Non précisé'}
    ).setColor('#e0b35e');
    await channel.send({embeds:[embed]}).catch(async e=>audit({actorId,targetUserId:data.discord_id,source:'GOLEM',entityType:'absence',entityId:row.id,action:'ABSENCE_DISCORD_POST_FAILED',details:{error:e.message}}));
  }
  return row;
}

async function closeAbsence(actorId,id) {
  const old=await one(`SELECT * FROM absences WHERE id=$1 AND guild_id=$2`,[id,process.env.GUILD_ID]);
  if (!old) throw new Error('Absence introuvable.');
  const row=await one(`UPDATE absences SET status='closed',closed_by=$3,closed_at=NOW(),updated_at=NOW() WHERE id=$1 AND guild_id=$2 RETURNING *`,[id,process.env.GUILD_ID,actorId]);
  await audit({actorId,targetUserId:old.discord_id,source:'STAFF',entityType:'absence',entityId:id,action:'ABSENCE_CLOSED',oldValue:old,newValue:row});
  return row;
}

async function isProtected(userId,settings) {
  const a=await one(`
    SELECT * FROM absences
    WHERE guild_id=$1 AND discord_id=$2 AND status='active'
      AND CURRENT_DATE >= start_date
      AND NOW() <= (return_date::timestamp + ($3 || ' days')::INTERVAL + INTERVAL '23 hours 59 minutes 59 seconds')
    ORDER BY return_date DESC LIMIT 1
  `,[process.env.GUILD_ID,userId,String(Math.max(0,Number(settings.absence_grace_days||0)))]);
  return a||null;
}

module.exports={listAbsences,createAbsence,closeAbsence,isProtected};
