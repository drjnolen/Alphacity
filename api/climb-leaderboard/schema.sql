CREATE TABLE IF NOT EXISTS profiles (
  wallet TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY, wallet TEXT NOT NULL, origin TEXT NOT NULL,
  message TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS challenges_expiry ON challenges(expires_at);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, wallet TEXT NOT NULL, origin TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, wallet TEXT NOT NULL, season TEXT NOT NULL,
  client_id TEXT NOT NULL, hero_id TEXT NOT NULL,
  started_at INTEGER NOT NULL, checkpoint_at INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 0 CHECK(level BETWEEN 0 AND 9),
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  outcome TEXT, ended_at INTEGER,
  UNIQUE(wallet, season, client_id)
);
CREATE INDEX IF NOT EXISTS runs_expiry ON runs(started_at);
CREATE TABLE IF NOT EXISTS best_runs (
  season TEXT NOT NULL, wallet TEXT NOT NULL, run_id TEXT NOT NULL,
  hero_id TEXT NOT NULL, level INTEGER NOT NULL, elapsed_ms INTEGER NOT NULL,
  achieved_at INTEGER NOT NULL,
  PRIMARY KEY(season, wallet)
);
CREATE INDEX IF NOT EXISTS best_ranking ON best_runs(season, level DESC, elapsed_ms, achieved_at, wallet);
