const { Pool } = require('pg');

const sslEnabled = String(process.env.DATABASE_SSL || 'true').toLowerCase() !== 'false';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslEnabled ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000
});

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      guild_name TEXT,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      paused BOOLEAN NOT NULL DEFAULT TRUE,
      role_clan_id TEXT,
      role_guardian_id TEXT,
      role_admin_id TEXT,
      role_modo_id TEXT,
      channel_actions_id TEXT,
      channel_activities_id TEXT,
      channel_absences_id TEXT,
      channel_logs_id TEXT,
      clan_inactivity_days INTEGER NOT NULL DEFAULT 14,
      guardian_voice_days INTEGER NOT NULL DEFAULT 7,
      notice_hours INTEGER NOT NULL DEFAULT 24,
      voice_min_minutes INTEGER NOT NULL DEFAULT 5,
      absence_grace_days INTEGER NOT NULL DEFAULT 7,
      timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
      reward_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      reward_base_name TEXT NOT NULL DEFAULT '🏆 GOLEM Hebdo',
      reward_weekday INTEGER NOT NULL DEFAULT 1,
      reward_hour INTEGER NOT NULL DEFAULT 20,
      tracking_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      safety_hold_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS channel_absences_id TEXT;
    ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS absence_grace_days INTEGER NOT NULL DEFAULT 7;
    ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS safety_hold_until TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS members (
      guild_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      username TEXT NOT NULL,
      display_name TEXT,
      clan_since TIMESTAMPTZ,
      guardian_since TIMESTAMPTZ,
      last_valid_voice_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, discord_id)
    );

    CREATE TABLE IF NOT EXISTS voice_sessions (
      guild_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      channel_id TEXT,
      started_at TIMESTAMPTZ NOT NULL,
      validated_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, discord_id)
    );

    CREATE TABLE IF NOT EXISTS activities (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      activity_type TEXT NOT NULL DEFAULT 'Raid',
      scheduled_at TIMESTAMPTZ NOT NULL,
      publish_at TIMESTAMPTZ NOT NULL,
      channel_id TEXT,
      tag TEXT,
      color TEXT NOT NULL DEFAULT '#62df8a',
      image_url TEXT,
      logo_url TEXT,
      description TEXT,
      max_players INTEGER NOT NULL DEFAULT 6,
      counts_for_clan BOOLEAN NOT NULL DEFAULT TRUE,
      status TEXT NOT NULL DEFAULT 'scheduled',
      discord_message_id TEXT,
      published_at TIMESTAMPTZ,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_activities_publish ON activities(guild_id, publish_at);

    CREATE TABLE IF NOT EXISTS activity_signups (
      activity_id BIGINT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      class_name TEXT,
      status TEXT NOT NULL DEFAULT 'registered',
      team_label TEXT,
      presence TEXT NOT NULL DEFAULT 'pending',
      clan_credit_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT,
      PRIMARY KEY (activity_id, discord_id)
    );
    CREATE INDEX IF NOT EXISTS idx_signups_user ON activity_signups(guild_id, discord_id);

    CREATE TABLE IF NOT EXISTS member_ratings (
      guild_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      global_rating NUMERIC(4,2),
      PRIMARY KEY (guild_id, discord_id)
    );

    CREATE TABLE IF NOT EXISTS activity_ratings (
      guild_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      activity_name TEXT NOT NULL,
      rating NUMERIC(4,2) NOT NULL,
      PRIMARY KEY (guild_id, discord_id, activity_name)
    );

    CREATE TABLE IF NOT EXISTS absences (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      start_date DATE NOT NULL,
      return_date DATE NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT,
      closed_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_absences_member ON absences(guild_id, discord_id, status);

    CREATE TABLE IF NOT EXISTS pending_actions (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      execute_at TIMESTAMPTZ NOT NULL,
      warning_message_id TEXT,
      warning_channel_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      staff_decision TEXT,
      staff_user_id TEXT,
      extension_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_action
      ON pending_actions(guild_id, discord_id, action_type)
      WHERE status IN ('pending','wait','extended');

    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      actor_id TEXT,
      target_user_id TEXT,
      source TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      action TEXT NOT NULL,
      old_value JSONB,
      new_value JSONB,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(guild_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS panel_tokens (
      token_hash TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS runtime_state (
      guild_id TEXT PRIMARY KEY,
      last_heartbeat_at TIMESTAMPTZ,
      last_started_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reward_streaks (
      guild_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      streak INTEGER NOT NULL DEFAULT 0,
      last_win_key TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, discord_id)
    );

    CREATE TABLE IF NOT EXISTS reward_roles (
      guild_id TEXT NOT NULL,
      streak_level INTEGER NOT NULL,
      role_id TEXT NOT NULL,
      role_name TEXT NOT NULL,
      PRIMARY KEY (guild_id, streak_level)
    );

    CREATE TABLE IF NOT EXISTS weekly_runs (
      guild_id TEXT NOT NULL,
      run_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, run_key)
    );
  `);

  console.log('✅ GOLEM DATABASE // POSTGRES READY');
}

async function query(text, params = []) { return pool.query(text, params); }
async function one(text, params = []) { const r = await pool.query(text, params); return r.rows[0] || null; }
async function many(text, params = []) { const r = await pool.query(text, params); return r.rows; }

module.exports = { pool, initDatabase, query, one, many };
