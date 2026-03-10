-- InjuryWire Database Schema
-- Run once against your Neon database:
--   psql $DATABASE_URL -f db/schema.sql

-- ─── REPORTERS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reporters (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  handle        TEXT NOT NULL UNIQUE,
  user_id       TEXT,                        -- Twitter numeric user ID (filled by lookup-ids.js)
  outlet        TEXT,
  team          TEXT,
  tier          INT DEFAULT 2,
  injury_signal TEXT DEFAULT 'Medium',
  conf          TEXT DEFAULT 'NAT',          -- E / W / NAT
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reporters_handle  ON reporters(handle);
CREATE INDEX IF NOT EXISTS idx_reporters_user_id ON reporters(user_id);
CREATE INDEX IF NOT EXISTS idx_reporters_team    ON reporters(team);

-- ─── RAW TWEETS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS raw_tweets (
  id                SERIAL PRIMARY KEY,
  tweet_id          TEXT NOT NULL UNIQUE,
  reporter_user_id  TEXT,
  reporter_handle   TEXT,
  reporter_name     TEXT,
  tweet_text        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_tweets_reporter ON raw_tweets(reporter_user_id);
CREATE INDEX IF NOT EXISTS idx_raw_tweets_created  ON raw_tweets(created_at DESC);

-- ─── INJURY EVENTS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS injury_events (
  id                  SERIAL PRIMARY KEY,
  player_name         TEXT NOT NULL,
  team                TEXT,
  injury_description  TEXT,
  body_part           TEXT,
  game_status         TEXT,                  -- Out / Questionable / Doubtful / Game-Time Decision / Probable
  confidence_score    INT DEFAULT 70,
  reporter_name       TEXT,
  reporter_handle     TEXT,
  outlet              TEXT,
  reporter_tier       INT DEFAULT 2,
  tweet_text          TEXT,
  tweet_id            TEXT UNIQUE,
  event_time          TIMESTAMPTZ DEFAULT NOW(),
  is_latest           BOOLEAN DEFAULT true,  -- false once superseded by newer report on same player
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_injury_player   ON injury_events(player_name);
CREATE INDEX IF NOT EXISTS idx_injury_team     ON injury_events(team);
CREATE INDEX IF NOT EXISTS idx_injury_status   ON injury_events(game_status);
CREATE INDEX IF NOT EXISTS idx_injury_time     ON injury_events(event_time DESC);
CREATE INDEX IF NOT EXISTS idx_injury_latest   ON injury_events(is_latest) WHERE is_latest = true;
CREATE INDEX IF NOT EXISTS idx_injury_reporter ON injury_events(reporter_handle);

-- ─── API KEYS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  key_hash   TEXT NOT NULL UNIQUE,           -- SHA-256 hash — raw key shown only at creation
  plan       TEXT DEFAULT 'free',            -- free / pro / enterprise
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used  TIMESTAMPTZ
);
