/**
 * InjuryWire — /v1/reporters and /v1/status routes
 */

const express = require('express');
const { Pool } = require('pg');

const router  = express.Router();
const sRouter = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// GET /v1/reporters
router.get('/', async (req, res) => {
  const { team, tier, signal } = req.query;
  try {
    const conditions = [];
    const params = [];

    if (team)   { params.push(`%${team}%`);   conditions.push(`team ILIKE $${params.length}`); }
    if (tier)   { params.push(parseInt(tier)); conditions.push(`tier = $${params.length}`); }
    if (signal) { params.push(signal);         conditions.push(`injury_signal = $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT id, name, handle, user_id, outlet, team, tier, injury_signal, conf, notes
       FROM reporters ${where} ORDER BY tier, name`,
      params
    );
    res.json({ reporters: result.rows, count: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v1/status
sRouter.get('/', async (req, res) => {
  try {
    const [counts, pipeline, avgLead] = await Promise.all([
      pool.query(`
        SELECT game_status, COUNT(*) as count
        FROM injury_events WHERE is_latest = true
        GROUP BY game_status
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '10 minutes') AS tweets_last_10m,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')     AS tweets_last_hour,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')   AS tweets_last_24h
        FROM raw_tweets
      `),
      pool.query(`
        SELECT ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - event_time))/60)) AS avg_lead_minutes
        FROM injury_events
        WHERE created_at > NOW() - INTERVAL '7 days'
      `),
    ]);

    const statusMap = {};
    counts.rows.forEach(r => { statusMap[r.game_status] = parseInt(r.count); });

    res.json({
      status: 'ok',
      injuries: statusMap,
      pipeline: pipeline.rows[0],
      avg_lead_minutes: avgLead.rows[0]?.avg_lead_minutes || null,
      as_of: new Date(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { reportersRouter: router, statusRouter: sRouter };
