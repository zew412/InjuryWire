/**
 * InjuryWire — /v1/injuries routes
 */

const express = require('express');
const { Pool } = require('pg');

const router = express.Router();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// GET /v1/injuries/live — Out/Q/GTD/Doubtful from last 6 hours
router.get('/live', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM injury_events
      WHERE is_latest = true
        AND game_status IN ('Out','Questionable','Game-Time Decision','Doubtful','Probable')
        AND event_time > NOW() - INTERVAL '6 hours'
      ORDER BY
        CASE game_status
          WHEN 'Out'               THEN 1
          WHEN 'Doubtful'          THEN 2
          WHEN 'Questionable'      THEN 3
          WHEN 'Game-Time Decision'THEN 4
          WHEN 'Probable'          THEN 5
        END,
        confidence_score DESC,
        event_time DESC
    `);
    res.json({ injuries: result.rows, count: result.rows.length, as_of: new Date() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v1/injuries — all with filters
router.get('/', async (req, res) => {
  const { status, min_confidence = 0, since, limit = 50, offset = 0 } = req.query;
  try {
    const conditions = ['is_latest = true'];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`game_status = $${params.length}`);
    }
    if (min_confidence) {
      params.push(parseInt(min_confidence));
      conditions.push(`confidence_score >= $${params.length}`);
    }
    if (since) {
      params.push(new Date(since));
      conditions.push(`event_time > $${params.length}`);
    }

    params.push(parseInt(limit), parseInt(offset));
    const where = conditions.join(' AND ');

    const result = await pool.query(
      `SELECT * FROM injury_events WHERE ${where}
       ORDER BY event_time DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ injuries: result.rows, count: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v1/injuries/team/:team
router.get('/team/:team', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM injury_events
       WHERE team ILIKE $1 AND is_latest = true
       ORDER BY event_time DESC LIMIT 20`,
      [`%${req.params.team}%`]
    );
    res.json({ injuries: result.rows, team: req.params.team });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v1/injuries/:player — fuzzy player search
router.get('/:player', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM injury_events
       WHERE player_name ILIKE $1
       ORDER BY event_time DESC LIMIT 10`,
      [`%${req.params.player}%`]
    );
    res.json({ injuries: result.rows, player: req.params.player });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
