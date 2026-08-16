const crypto = require('crypto');
const { query, one } = require('../db');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');

async function createPanelToken(userId, minutes = 120) {
  const guildId = process.env.GUILD_ID;
  const token = crypto.randomBytes(32).toString('base64url');
  await query(`
    INSERT INTO panel_tokens(token_hash,guild_id,user_id,expires_at)
    VALUES($1,$2,$3,NOW()+($4 || ' minutes')::INTERVAL)
  `, [hash(token), guildId, userId, String(minutes)]);
  return token;
}

async function validatePanelToken(token) {
  if (!token) return null;
  return one(`
    SELECT * FROM panel_tokens
    WHERE token_hash=$1 AND guild_id=$2 AND expires_at>NOW()
  `, [hash(token), process.env.GUILD_ID]);
}

async function cleanupTokens() {
  await query(`DELETE FROM panel_tokens WHERE expires_at<=NOW()`);
}

module.exports = { createPanelToken, validatePanelToken, cleanupTokens };
