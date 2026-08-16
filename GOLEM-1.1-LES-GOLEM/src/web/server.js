const express = require('express');
const path = require('path');
const { validatePanelToken } = require('../services/access');
const { one, query, many } = require('../db');
const { getSettings, saveSettings, syncGuildMembers, getMembers, setGlobalRating } = require('../services/members');
const { history, audit } = require('../services/audit');
const { listActivities, createActivity, updateActivity, deleteActivity, publishActivity, listSignups, upsertSignup, balanceTeams, saveBalancedTeams, importWeekCode } = require('../services/activities');
const { listAbsences, createAbsence, closeAbsence } = require('../services/absences');
const { listPending, executePendingAction, refreshPendingMessage } = require('../services/moderation');

function startWebServer(client) {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const publicDir = path.join(__dirname, '../../public');
  app.use(express.json({limit:'1mb'}));
  app.use(express.static(publicDir));

  app.get('/health', async (req,res) => {
    const runtime=await one(`SELECT * FROM runtime_state WHERE guild_id=$1`,[process.env.GUILD_ID]).catch(()=>null);
    res.json({ok:true,botReady:client.isReady(),guildId:process.env.GUILD_ID,lastHeartbeat:runtime?.last_heartbeat_at||null,time:new Date().toISOString()});
  });
  app.get(['/panel','/'], (req,res) => res.sendFile(path.join(publicDir,'index.html')));

  async function auth(req,res,next) {
    const token=req.headers['x-golem-token'];
    const access=await validatePanelToken(token);
    if(!access)return res.status(401).json({error:'Lien expiré ou non autorisé. Relance /golem panel dans Discord.'});
    req.golem={actorId:access.user_id};next();
  }
  app.use('/api/admin',auth);

  function guild(){return client.guilds.cache.get(process.env.GUILD_ID)}

  app.get('/api/admin/context',async(req,res)=>{
    const g=guild();if(!g)return res.status(503).json({error:'GOLEM n’est pas connecté au serveur Les Golem.'});
    await g.roles.fetch();await g.channels.fetch();const s=await getSettings();
    const roles=g.roles.cache.filter(r=>r.id!==g.id&&!r.managed).map(r=>({id:r.id,name:r.name,position:r.position,manageable:r.editable})).sort((a,b)=>b.position-a.position);
    const channels=g.channels.cache.filter(c=>c?.isTextBased()).map(c=>({id:c.id,name:c.name})).sort((a,b)=>a.name.localeCompare(b.name,'fr'));
    const warnings=[];if(s?.role_clan_id&&!g.roles.cache.get(s.role_clan_id)?.editable)warnings.push('Le rôle Clan n’est pas gérable par GOLEM : place le rôle du bot au-dessus.');if(s?.role_guardian_id&&!g.roles.cache.get(s.role_guardian_id)?.editable)warnings.push('Le rôle Gardien n’est pas gérable par GOLEM : place le rôle du bot au-dessus.');if(!s?.channel_actions_id)warnings.push('Salon des préavis non configuré : aucune sanction automatique ne sera lancée.');
    res.json({guild:{id:g.id,name:g.name,memberCount:g.memberCount},bot:{ready:client.isReady(),username:client.user?.username||'GOLEM',ping:client.ws.ping},roles,channels,settings:s,warnings});
  });

  app.post('/api/admin/settings',async(req,res)=>{
    const old=await getSettings();const body={...req.body};
    for(const k of ['clan_inactivity_days','guardian_voice_days','notice_hours','absence_grace_days']){if(k in body){body[k]=Math.max(0,Number(body[k]||0));}}
    if('voice_min_minutes'in body)body.voice_min_minutes=Math.max(1,Number(body.voice_min_minutes||5));
    if('reward_weekday'in body)body.reward_weekday=Math.min(7,Math.max(1,Number(body.reward_weekday||1)));
    if('reward_hour'in body)body.reward_hour=Math.min(23,Math.max(0,Number(body.reward_hour||20)));
    const next=await saveSettings(body);const g=guild();if(g)await syncGuildMembers(g);
    await audit({actorId:req.golem.actorId,source:'STAFF',entityType:'guild_settings',entityId:process.env.GUILD_ID,action:'SETTINGS_UPDATED',oldValue:old,newValue:next});res.json({ok:true,settings:next});
  });

  app.post('/api/admin/pause',async(req,res)=>{const next=await saveSettings({paused:Boolean(req.body.paused)});await audit({actorId:req.golem.actorId,source:'STAFF',entityType:'guild_settings',entityId:process.env.GUILD_ID,action:next.paused?'GOLEM_PAUSED':'GOLEM_RESUMED'});res.json({ok:true,paused:next.paused});});
  app.post('/api/admin/sync',async(req,res)=>{const g=guild();if(!g)return res.status(503).json({error:'Discord indisponible.'});await syncGuildMembers(g);await audit({actorId:req.golem.actorId,source:'STAFF',entityType:'members',action:'MEMBERS_SYNCED'});res.json({ok:true});});

  app.get('/api/admin/dashboard',async(req,res)=>{
    const s=await getSettings();const stats=await one(`SELECT (SELECT COUNT(*) FROM members WHERE guild_id=$1)::INTEGER members,(SELECT COUNT(*) FROM activities WHERE guild_id=$1 AND scheduled_at>NOW())::INTEGER activities,(SELECT COUNT(*) FROM absences WHERE guild_id=$1 AND status='active')::INTEGER absences,(SELECT COUNT(*) FROM pending_actions WHERE guild_id=$1 AND status IN('pending','wait','extended'))::INTEGER pending,(SELECT COUNT(*) FROM audit_logs WHERE guild_id=$1 AND created_at>=NOW()-INTERVAL '24 hours')::INTEGER logs24h`,[process.env.GUILD_ID]);res.json({...stats,settings:s});
  });

  app.get('/api/admin/calendar',async(req,res)=>{
    const from=req.query.from||new Date(Date.now()-31*86400000).toISOString(),to=req.query.to||new Date(Date.now()+62*86400000).toISOString();
    const activities=await many(`SELECT id,name,scheduled_at,counts_for_clan,status FROM activities WHERE guild_id=$1 AND scheduled_at BETWEEN $2 AND $3 ORDER BY scheduled_at`,[process.env.GUILD_ID,from,to]);
    const voices=await many(`SELECT created_at,target_user_id,details FROM audit_logs WHERE guild_id=$1 AND action='VOICE_VALIDATED' AND created_at BETWEEN $2 AND $3 ORDER BY created_at`,[process.env.GUILD_ID,from,to]);
    const absences=await many(`SELECT a.*,m.display_name,m.username FROM absences a LEFT JOIN members m ON m.guild_id=a.guild_id AND m.discord_id=a.discord_id WHERE a.guild_id=$1 AND a.status='active'`,[process.env.GUILD_ID]);
    res.json({activities,voices,absences});
  });

  app.get('/api/admin/members',async(req,res)=>{const g=guild();if(!g)return res.status(503).json({error:'Discord indisponible.'});await g.members.fetch();const rows=await getMembers();res.json(rows.map(r=>{const m=g.members.cache.get(r.discord_id);return{...r,roles:m?m.roles.cache.filter(x=>x.id!==g.id).map(x=>({id:x.id,name:x.name})):[]}}));});
  app.post('/api/admin/members/:id/rating',async(req,res)=>{const rating=req.body.rating===''||req.body.rating===null?null:Number(req.body.rating);if(rating!==null&&(Number.isNaN(rating)||rating<0||rating>10))return res.status(400).json({error:'Note entre 0 et 10.'});await setGlobalRating(req.params.id,rating);await audit({actorId:req.golem.actorId,targetUserId:req.params.id,source:'STAFF',entityType:'member_rating',entityId:req.params.id,action:'GLOBAL_RATING_CHANGED',newValue:{rating}});res.json({ok:true});});
  app.post('/api/admin/members/:id/activity-rating',async(req,res)=>{const rating=Number(req.body.rating);const activityName=String(req.body.activity_name||'').trim();if(!activityName)return res.status(400).json({error:'Nom d’activité obligatoire.'});if(Number.isNaN(rating)||rating<0||rating>10)return res.status(400).json({error:'Note entre 0 et 10.'});await query(`INSERT INTO activity_ratings(guild_id,discord_id,activity_name,rating) VALUES($1,$2,$3,$4) ON CONFLICT(guild_id,discord_id,activity_name) DO UPDATE SET rating=EXCLUDED.rating`,[process.env.GUILD_ID,req.params.id,activityName,rating]);await audit({actorId:req.golem.actorId,targetUserId:req.params.id,source:'STAFF',entityType:'activity_rating',entityId:`${req.params.id}:${activityName}`,action:'ACTIVITY_RATING_CHANGED',newValue:{activityName,rating}});res.json({ok:true});});
  app.post('/api/admin/members/:id/roles',async(req,res)=>{const g=guild();const m=await g?.members.fetch(req.params.id).catch(()=>null);const role=g?.roles.cache.get(String(req.body.roleId));if(!m)return res.status(404).json({error:'Membre introuvable.'});if(!role||!role.editable)return res.status(400).json({error:'Rôle non gérable par GOLEM. Vérifie la hiérarchie des rôles.'});if(req.body.action==='add'){await m.roles.add(role.id,`GOLEM Panel • ${req.golem.actorId}`);await audit({actorId:req.golem.actorId,targetUserId:m.id,source:'STAFF',entityType:'member_role',entityId:role.id,action:'ROLE_ADDED',newValue:{roleId:role.id,roleName:role.name}})}else if(req.body.action==='remove'){await m.roles.remove(role.id,`GOLEM Panel • ${req.golem.actorId}`);await audit({actorId:req.golem.actorId,targetUserId:m.id,source:'STAFF',entityType:'member_role',entityId:role.id,action:'ROLE_REMOVED',oldValue:{roleId:role.id,roleName:role.name}})}else return res.status(400).json({error:'Action invalide.'});res.json({ok:true});});

  app.get('/api/admin/activities',async(req,res)=>res.json(await listActivities()));
  app.post('/api/admin/activities',async(req,res)=>{if(!req.body.name||!req.body.scheduled_at||!req.body.publish_at)return res.status(400).json({error:'Nom, date de l’activité et date de publication obligatoires.'});res.json({ok:true,activity:await createActivity(req.golem.actorId,req.body)});});
  app.patch('/api/admin/activities/:id',async(req,res)=>res.json({ok:true,activity:await updateActivity(client,Number(req.params.id),req.golem.actorId,req.body)}));
  app.delete('/api/admin/activities/:id',async(req,res)=>{await deleteActivity(Number(req.params.id),req.golem.actorId);res.json({ok:true});});
  app.post('/api/admin/activities/:id/publish-now',async(req,res)=>{const a=await one(`SELECT * FROM activities WHERE id=$1 AND guild_id=$2`,[Number(req.params.id),process.env.GUILD_ID]);if(!a)return res.status(404).json({error:'Activité introuvable.'});if(a.published_at)return res.status(400).json({error:'Activité déjà publiée.'});const msg=await publishActivity(client,a);res.json({ok:true,messageId:msg.id});});
  app.get('/api/admin/activities/:id/signups',async(req,res)=>res.json(await listSignups(Number(req.params.id))));
  app.put('/api/admin/activities/:id/signups/:userId',async(req,res)=>res.json({ok:true,signup:await upsertSignup({activityId:Number(req.params.id),discordId:req.params.userId,actorId:req.golem.actorId,source:'STAFF',className:req.body.class_name,status:req.body.status,teamLabel:req.body.team_label,presence:req.body.presence})}));
  app.post('/api/admin/activities/:id/balance',async(req,res)=>res.json({teams:await balanceTeams(Number(req.params.id),Number(req.body.teamCount||2))}));
  app.post('/api/admin/activities/:id/balance/save',async(req,res)=>{await saveBalancedTeams(Number(req.params.id),req.golem.actorId,req.body.teams||[]);res.json({ok:true});});
  app.post('/api/admin/planning/import',async(req,res)=>res.json({ok:true,count:await importWeekCode(req.golem.actorId,req.body.code)}));

  app.get('/api/admin/absences',async(req,res)=>res.json(await listAbsences()));
  app.post('/api/admin/absences',async(req,res)=>res.json({ok:true,absence:await createAbsence(client,req.golem.actorId,req.body)}));
  app.post('/api/admin/absences/:id/close',async(req,res)=>res.json({ok:true,absence:await closeAbsence(req.golem.actorId,Number(req.params.id))}));

  app.get('/api/admin/pending',async(req,res)=>res.json(await listPending()));
  app.post('/api/admin/pending/:id/apply',async(req,res)=>{const r=await executePendingAction(client,Number(req.params.id),req.golem.actorId,'STAFF');await refreshPendingMessage(client,Number(req.params.id)).catch(()=>{});res.json(r);});
  app.post('/api/admin/pending/:id/extend',async(req,res)=>{const h=Number(req.body.hours);if(!Number.isInteger(h)||h<1||h>720)return res.status(400).json({error:'Entre 1 et 720 heures.'});const p=await one(`SELECT * FROM pending_actions WHERE id=$1 AND guild_id=$2`,[Number(req.params.id),process.env.GUILD_ID]);if(!p)return res.status(404).json({error:'Action introuvable.'});const next=new Date(new Date(p.execute_at).getTime()+h*3600000);await query(`UPDATE pending_actions SET execute_at=$2,status='extended',staff_decision=$3,staff_user_id=$4,extension_count=extension_count+1,updated_at=NOW() WHERE id=$1`,[p.id,next,`PROLONGÉ +${h}h`,req.golem.actorId]);await audit({actorId:req.golem.actorId,targetUserId:p.discord_id,source:'STAFF',entityType:'pending_action',entityId:p.id,action:'PENDING_ACTION_EXTENDED',oldValue:{executeAt:p.execute_at},newValue:{executeAt:next},details:{addedHours:h}});await refreshPendingMessage(client,p.id).catch(()=>{});res.json({ok:true,executeAt:next});});

  app.get('/api/admin/history',async(req,res)=>res.json(await history(req.query.limit||400)));

  app.use((err,req,res,next)=>{console.error('GOLEM WEB ERROR',err);res.status(500).json({error:err.message||'Erreur interne GOLEM'});});
  app.listen(PORT,'0.0.0.0',()=>console.log(`✅ GOLEM CONTROL PANEL // PORT ${PORT}`));
}
module.exports={startWebServer};
