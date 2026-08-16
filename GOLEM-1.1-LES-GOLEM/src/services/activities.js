const { EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle } = require('discord.js');
const { query, one, many, pool } = require('../db');
const { audit } = require('./audit');
const { getSettings } = require('./members');
const VALID=new Set(['registered','bench']);

function safeUrl(v){try{const u=new URL(v);return ['http:','https:'].includes(u.protocol)?u.toString():null}catch{return null}}

function activityMessage(a){
  const ts=Math.floor(new Date(a.scheduled_at).getTime()/1000);
  const e=new EmbedBuilder().setTitle(`◈ GOLEM // ${String(a.name).toUpperCase()}`).setDescription(a.description||'Activité GOLEM').addFields(
    {name:'Date',value:`<t:${ts}:F> • <t:${ts}:R>`},{name:'Type',value:a.activity_type||'—',inline:true},{name:'Places',value:String(a.max_players||6),inline:true},{name:'Tag',value:a.tag||'—',inline:true}
  ).setColor(a.color||'#62df8a').setFooter({text:a.counts_for_clan?'L’inscription valide rafraîchit le timer Clan.':'Cette activité ne compte pas pour le rôle Clan.'});
  const img=safeUrl(a.image_url),logo=safeUrl(a.logo_url); if(img)e.setImage(img);if(logo)e.setThumbnail(logo);
  const row=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`golem_signup:${a.id}:hunter`).setLabel('Chasseur').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`golem_signup:${a.id}:titan`).setLabel('Titan').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`golem_signup:${a.id}:warlock`).setLabel('Arcaniste').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`golem_signup:${a.id}:maybe`).setLabel('Peut-être').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`golem_signup:${a.id}:absent`).setLabel('Absent').setStyle(ButtonStyle.Danger)
  );
  return {embeds:[e],components:[row]};
}

async function listActivities(){return many(`SELECT a.*,(SELECT COUNT(*) FROM activity_signups s WHERE s.activity_id=a.id AND s.status IN('registered','bench'))::INTEGER signup_count FROM activities a WHERE a.guild_id=$1 ORDER BY a.scheduled_at DESC`,[process.env.GUILD_ID]);}

async function createActivity(actorId,d){
  const a=await one(`INSERT INTO activities(guild_id,name,activity_type,scheduled_at,publish_at,channel_id,tag,color,image_url,logo_url,description,max_players,counts_for_clan,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[process.env.GUILD_ID,d.name,d.activity_type||'Raid',d.scheduled_at,d.publish_at,d.channel_id||null,d.tag||null,d.color||'#62df8a',d.image_url||null,d.logo_url||null,d.description||null,Number(d.max_players||6),d.counts_for_clan!==false,actorId]);
  await audit({actorId,source:'STAFF',entityType:'activity',entityId:a.id,action:'ACTIVITY_CREATED',newValue:a});return a;
}

async function updateActivity(client,id,actorId,d){
  const old=await one(`SELECT * FROM activities WHERE id=$1 AND guild_id=$2`,[id,process.env.GUILD_ID]);if(!old)throw new Error('Activité introuvable.');
  const allowed=['name','activity_type','scheduled_at','publish_at','channel_id','tag','color','image_url','logo_url','description','max_players','counts_for_clan'];const sets=[],p=[id,process.env.GUILD_ID];
  for(const k of allowed){if(!(k in d))continue;p.push(d[k]===''?null:d[k]);sets.push(`${k}=$${p.length}`)}
  if(sets.length){sets.push('updated_at=NOW()');await query(`UPDATE activities SET ${sets.join(',')} WHERE id=$1 AND guild_id=$2`,p)}
  const next=await one(`SELECT * FROM activities WHERE id=$1 AND guild_id=$2`,[id,process.env.GUILD_ID]);
  if(next.published_at&&next.discord_message_id) await editPublished(client,next).catch(()=>{});
  await audit({actorId,source:'STAFF',entityType:'activity',entityId:id,action:'ACTIVITY_UPDATED',oldValue:old,newValue:next});return next;
}

async function deleteActivity(id,actorId){const old=await one(`DELETE FROM activities WHERE id=$1 AND guild_id=$2 RETURNING *`,[id,process.env.GUILD_ID]);if(!old)throw new Error('Activité introuvable.');await audit({actorId,source:'STAFF',entityType:'activity',entityId:id,action:'ACTIVITY_DELETED',oldValue:old});}

async function publishActivity(client,a){const settings=await getSettings();const guild=client.guilds.cache.get(process.env.GUILD_ID);const channel=guild?.channels.cache.get(a.channel_id||settings?.channel_activities_id);if(!channel?.isTextBased())throw new Error('Salon de publication inaccessible.');const msg=await channel.send(activityMessage(a));await query(`UPDATE activities SET discord_message_id=$2,published_at=NOW(),status='published',updated_at=NOW() WHERE id=$1`,[a.id,msg.id]);await audit({source:'GOLEM',entityType:'activity',entityId:a.id,action:'ACTIVITY_PUBLISHED',details:{channelId:channel.id,messageId:msg.id}});return msg;}
async function editPublished(client,a){const settings=await getSettings();const guild=client.guilds.cache.get(process.env.GUILD_ID);const channel=guild?.channels.cache.get(a.channel_id||settings?.channel_activities_id);if(!channel?.isTextBased())return;const msg=await channel.messages.fetch(a.discord_message_id).catch(()=>null);if(msg)await msg.edit(activityMessage(a));}

async function publishDueActivities(client){const settings=await getSettings();if(!settings?.enabled||settings.paused)return;const rows=await many(`SELECT * FROM activities WHERE guild_id=$1 AND published_at IS NULL AND status='scheduled' AND publish_at<=NOW() ORDER BY publish_at LIMIT 25`,[process.env.GUILD_ID]);for(const a of rows){if(new Date(a.scheduled_at)<=new Date()){await query(`UPDATE activities SET status='expired',updated_at=NOW() WHERE id=$1`,[a.id]);continue}try{await publishActivity(client,a)}catch(e){await audit({source:'GOLEM',entityType:'activity',entityId:a.id,action:'ACTIVITY_PUBLICATION_FAILED',details:{error:e.message}})}}}

async function listSignups(id){return many(`SELECT s.*,m.username,m.display_name,mr.global_rating,ar.rating specific_rating FROM activity_signups s LEFT JOIN members m ON m.guild_id=s.guild_id AND m.discord_id=s.discord_id LEFT JOIN member_ratings mr ON mr.guild_id=s.guild_id AND mr.discord_id=s.discord_id LEFT JOIN activities a ON a.id=s.activity_id LEFT JOIN activity_ratings ar ON ar.guild_id=s.guild_id AND ar.discord_id=s.discord_id AND ar.activity_name=a.name WHERE s.activity_id=$1 AND s.guild_id=$2 ORDER BY LOWER(COALESCE(m.display_name,m.username))`,[id,process.env.GUILD_ID]);}

async function upsertSignup({activityId,discordId,actorId,source,className,status,teamLabel,presence}){
  const a=await one(`SELECT * FROM activities WHERE id=$1 AND guild_id=$2`,[activityId,process.env.GUILD_ID]);if(!a)throw new Error('Activité introuvable.');
  const old=await one(`SELECT * FROM activity_signups WHERE activity_id=$1 AND discord_id=$2`,[activityId,discordId]);
  const nextStatus=status??old?.status??'registered';const oldValid=old?VALID.has(old.status):false,nextValid=VALID.has(nextStatus);let credit=old?.clan_credit_at||null;
  if(a.counts_for_clan&&nextValid&&!oldValid)credit=new Date();if(!a.counts_for_clan||!nextValid)credit=null;
  const r=await one(`INSERT INTO activity_signups(activity_id,guild_id,discord_id,class_name,status,team_label,presence,clan_credit_at,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(activity_id,discord_id) DO UPDATE SET class_name=EXCLUDED.class_name,status=EXCLUDED.status,team_label=EXCLUDED.team_label,presence=EXCLUDED.presence,clan_credit_at=EXCLUDED.clan_credit_at,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING *`,[activityId,process.env.GUILD_ID,discordId,className??old?.class_name??null,nextStatus,teamLabel??old?.team_label??null,presence??old?.presence??'pending',credit,actorId]);
  await audit({actorId,targetUserId:discordId,source,entityType:'activity_signup',entityId:`${activityId}:${discordId}`,action:old?'SIGNUP_UPDATED':'SIGNUP_CREATED',oldValue:old,newValue:r,details:{activityId,activityName:a.name}});
  if(old){
    const fields=[['class_name','SIGNUP_CLASS_CHANGED'],['status','SIGNUP_STATUS_CHANGED'],['team_label','SIGNUP_TEAM_CHANGED'],['presence','SIGNUP_PRESENCE_CHANGED']];
    for(const [field,action] of fields){
      const before=old[field]??null,after=r[field]??null;
      if(before!==after)await audit({actorId,targetUserId:discordId,source,entityType:'activity_signup',entityId:`${activityId}:${discordId}`,action,oldValue:{[field]:before},newValue:{[field]:after},details:{activityId,activityName:a.name}});
    }
  }
  return r;
}

async function handleSignupButton(interaction){const [p,id,act]=interaction.customId.split(':');if(p!=='golem_signup')return false;const map={hunter:{className:'Chasseur',status:'registered'},titan:{className:'Titan',status:'registered'},warlock:{className:'Arcaniste',status:'registered'},maybe:{className:null,status:'maybe'},absent:{className:null,status:'absent'}};const choice=map[act];if(!choice)return false;const r=await upsertSignup({activityId:Number(id),discordId:interaction.user.id,actorId:interaction.user.id,source:'PLAYER',...choice});await interaction.reply({content:r.status==='registered'?`✅ Inscription enregistrée en **${r.class_name}**.`:r.status==='maybe'?'❔ Statut **Peut-être** enregistré.':'❌ Statut **Absent** enregistré.',ephemeral:true});return true;}

async function balanceTeams(id,count=2){const a=await one(`SELECT * FROM activities WHERE id=$1 AND guild_id=$2`,[id,process.env.GUILD_ID]);if(!a)throw new Error('Activité introuvable.');const players=await many(`SELECT s.discord_id,m.display_name,m.username,COALESCE(ar.rating,mr.global_rating,5)::FLOAT rating FROM activity_signups s LEFT JOIN members m ON m.guild_id=s.guild_id AND m.discord_id=s.discord_id LEFT JOIN member_ratings mr ON mr.guild_id=s.guild_id AND mr.discord_id=s.discord_id LEFT JOIN activity_ratings ar ON ar.guild_id=s.guild_id AND ar.discord_id=s.discord_id AND ar.activity_name=$3 WHERE s.activity_id=$1 AND s.guild_id=$2 AND s.status='registered' ORDER BY rating DESC`,[id,process.env.GUILD_ID,a.name]);const n=Math.max(2,Math.min(8,Number(count)||2)),teams=Array.from({length:n},(_,i)=>({number:i+1,score:0,players:[]}));for(const p of players){teams.sort((x,y)=>x.score-y.score||x.players.length-y.players.length);teams[0].players.push(p);teams[0].score+=Number(p.rating||5)}return teams.sort((x,y)=>x.number-y.number);}
async function saveBalancedTeams(id,actorId,teams){const c=await pool.connect(),changes=[];try{await c.query('BEGIN');for(const t of teams)for(const p of t.players||[]){const old=(await c.query(`SELECT team_label FROM activity_signups WHERE activity_id=$1 AND discord_id=$2`,[id,p.discord_id])).rows[0];const next=`Équipe ${t.number}`;await c.query(`UPDATE activity_signups SET team_label=$4,updated_by=$3,updated_at=NOW() WHERE activity_id=$1 AND discord_id=$2`,[id,p.discord_id,actorId,next]);if((old?.team_label||null)!==next)changes.push({discordId:p.discord_id,before:old?.team_label||null,after:next})}await c.query('COMMIT')}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}for(const ch of changes)await audit({actorId,targetUserId:ch.discordId,source:'STAFF',entityType:'activity_signup',entityId:`${id}:${ch.discordId}`,action:'SIGNUP_TEAM_CHANGED',oldValue:{team_label:ch.before},newValue:{team_label:ch.after},details:{activityId:id}});await audit({actorId,source:'STAFF',entityType:'activity_teams',entityId:id,action:'TEAMS_BALANCED',newValue:teams});}

async function importWeekCode(actorId,code){if(!String(code||'').startsWith('GOLEM-WEEK:'))throw new Error('Code GOLEM-WEEK invalide.');const raw=String(code).slice(11).replace(/-/g,'+').replace(/_/g,'/');let data;try{data=JSON.parse(Buffer.from(raw,'base64').toString('utf8'))}catch{throw new Error('Impossible de lire le code GOLEM-WEEK.')}const items=Array.isArray(data)?data:(data.activities||data.items||[]);let count=0;for(const item of items){if(!item||item.off||!item.name)continue;const scheduled=item.scheduled_at||item.date||item.datetime;const publish=item.publish_at||item.publishAt||scheduled;if(!scheduled)continue;await createActivity(actorId,{name:item.name,activity_type:item.type||item.activity_type||'Raid',scheduled_at:scheduled,publish_at:publish,channel_id:item.channel_id||null,tag:item.tag||null,color:item.color||'#62df8a',image_url:item.image_url||null,logo_url:item.logo_url||null,description:item.description||null,max_players:item.max_players||6,counts_for_clan:item.counts_for_clan!==false});count++}await audit({actorId,source:'STAFF',entityType:'planning_import',action:'GOLEM_WEEK_IMPORTED',details:{count}});return count;}

module.exports={listActivities,createActivity,updateActivity,deleteActivity,publishActivity,publishDueActivities,listSignups,upsertSignup,handleSignupButton,balanceTeams,saveBalancedTeams,importWeekCode};
