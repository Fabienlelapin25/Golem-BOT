const { one, query } = require('../db');
const { audit } = require('./audit');

let heartbeatTimer = null;

async function initializeRuntimeSafety(guildId) {
  const previous = await one(`SELECT * FROM runtime_state WHERE guild_id=$1`, [guildId]);
  const now = new Date();
  const last = previous?.last_heartbeat_at ? new Date(previous.last_heartbeat_at) : null;
  const gapMinutes = last ? Math.max(0, (now-last)/60000) : 0;

  await query(`
    INSERT INTO runtime_state(guild_id,last_heartbeat_at,last_started_at)
    VALUES($1,NOW(),NOW())
    ON CONFLICT(guild_id) DO UPDATE SET last_heartbeat_at=NOW(),last_started_at=NOW(),updated_at=NOW()
  `,[guildId]);

  if (last && gapMinutes > 10) {
    const settings = await one(`SELECT * FROM guild_settings WHERE guild_id=$1`, [guildId]);
    const holdHours = Math.max(1, Number(settings?.notice_hours || 24));
    const holdUntil = new Date(Date.now() + holdHours*3600000);
    await query(`UPDATE guild_settings SET safety_hold_until=$2,updated_at=NOW() WHERE guild_id=$1`, [guildId, holdUntil]);
    await query(`
      UPDATE pending_actions
      SET execute_at=GREATEST(execute_at,$2),staff_decision='SÉCURITÉ APRÈS REDÉMARRAGE',updated_at=NOW()
      WHERE guild_id=$1 AND status IN('pending','wait','extended')
    `,[guildId,holdUntil]);
    await audit({source:'GOLEM',entityType:'runtime',entityId:guildId,action:'DOWNTIME_SAFETY_HOLD',details:{gapMinutes:Math.round(gapMinutes),holdUntil}});
  }
}

function startHeartbeat(guildId) {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    query(`UPDATE runtime_state SET last_heartbeat_at=NOW(),updated_at=NOW() WHERE guild_id=$1`, [guildId]).catch(console.error);
  }, 30000);
}

module.exports = { initializeRuntimeSafety, startHeartbeat };
