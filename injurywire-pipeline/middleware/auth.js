/**
 * InjuryWire — API Key Auth Middleware
 * Accepts key via X-Api-Key header or ?api_key= query param.
 * Keys are SHA-256 hashed in the DB — raw key is never stored.
 */

const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Simple in-memory cache so we don't hit the DB on every request
const keyCache = new Map(); // hash → { valid, plan, expiresAt }
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

module.exports = async function authMiddleware(req, res, next) {
  const rawKey = req.headers['x-api-key'] || req.query.api_key;

  if (!rawKey) {
    return res.status(401).json({ error: 'API key required. Pass via X-Api-Key header or ?api_key=' });
  }

  const hash = crypto.createHash('sha256').update(rawKey).digest('hex');

  // Check cache first
  const cached = keyCache.get(hash);
  if (cached && cached.expiresAt > Date.now()) {
    if (!cached.valid) return res.status(403).json({ error: 'Invalid or inactive API key' });
    req.apiPlan = cached.plan;
    return next();
  }

  // Hit DB
  try {
    const result = await pool.query(
      `UPDATE api_keys SET last_used = NOW()
       WHERE key_hash = $1 AND is_active = true
       RETURNING plan`,
      [hash]
    );

    const valid = result.rows.length > 0;
    const plan  = result.rows[0]?.plan || 'free';

    keyCache.set(hash, { valid, plan, expiresAt: Date.now() + CACHE_TTL });

    if (!valid) return res.status(403).json({ error: 'Invalid or inactive API key' });
    req.apiPlan = plan;
    next();
  } catch (err) {
    console.error('Auth DB error:', err.message);
    res.status(500).json({ error: 'Auth service unavailable' });
  }
};
