const { query, many } = require('../db');

async function audit({ actorId=null, targetUserId=null, source, entityType, entityId=null, action, oldValue=null, newValue=null, details=null }) {
  await query(`
    INSERT INTO audit_logs(guild_id,actor_id,target_user_id,source,entity_type,entity_id,action,old_value,new_value,details)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
  `, [process.env.GUILD_ID, actorId, targetUserId, source, entityType, entityId ? String(entityId) : null, action, oldValue, newValue, details]);
}

async function history(limit=400) {
  return many(`SELECT * FROM audit_logs WHERE guild_id=$1 ORDER BY created_at DESC LIMIT $2`, [process.env.GUILD_ID, Math.min(Number(limit)||400,1000)]);
}

module.exports = { audit, history };
