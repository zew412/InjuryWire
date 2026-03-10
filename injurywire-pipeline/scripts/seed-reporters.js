/**
 * InjuryWire — Seed Reporters Table
 *
 * Inserts all 212 reporters from reporters.js into the DB.
 * Safe to run multiple times (uses ON CONFLICT DO UPDATE).
 *
 * Run after deploying schema:
 *   node scripts/seed-reporters.js
 */

require('dotenv').config();
const { Pool }  = require('pg');
const REPORTERS = require('../ingestion/reporters');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function seed() {
  console.log(`Seeding ${REPORTERS.length} reporters into database...`);
  let inserted = 0;
  let updated  = 0;

  for (const r of REPORTERS) {
    const res = await pool.query(
      `INSERT INTO reporters
         (name, handle, user_id, outlet, team, tier, injury_signal, conf, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (handle) DO UPDATE SET
         name          = EXCLUDED.name,
         user_id       = COALESCE(EXCLUDED.user_id, reporters.user_id),
         outlet        = EXCLUDED.outlet,
         team          = EXCLUDED.team,
         tier          = EXCLUDED.tier,
         injury_signal = EXCLUDED.injury_signal,
         conf          = EXCLUDED.conf,
         notes         = EXCLUDED.notes,
         updated_at    = NOW()
       RETURNING (xmax = 0) AS is_insert`,
      [r.name, r.handle, r.userId || null, r.outlet, r.team, r.tier, r.signal, r.conf, r.notes]
    );

    if (res.rows[0]?.is_insert) inserted++;
    else updated++;
  }

  console.log(`✅  Done: ${inserted} inserted, ${updated} updated`);
  await pool.end();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
