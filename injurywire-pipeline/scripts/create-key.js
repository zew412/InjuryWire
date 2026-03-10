/**
 * InjuryWire — Generate API Key
 *
 * Creates a new API key and saves its hash to the database.
 *
 * Usage:
 *   node scripts/create-key.js "Key Name" pro
 *
 * Plans: free | pro | enterprise
 */

require('dotenv').config();
const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function createKey(name, plan = 'pro') {
  if (!name) {
    console.error('Usage: node scripts/create-key.js "Key Name" pro');
    process.exit(1);
  }

  // Generate a secure random key
  const rawKey  = 'iw_' + crypto.randomBytes(24).toString('hex');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  await pool.query(
    `INSERT INTO api_keys (name, key_hash, plan, is_active, created_at)
     VALUES ($1, $2, $3, true, NOW())`,
    [name, keyHash, plan]
  );

  console.log('\n✅  API Key created successfully');
  console.log('─'.repeat(50));
  console.log(`Name:  ${name}`);
  console.log(`Plan:  ${plan}`);
  console.log(`\nKey (copy this — shown only once):\n\n  ${rawKey}\n`);
  console.log('─'.repeat(50));
  console.log('\nPaste this into index.html:');
  console.log(`  const API_KEY = '${rawKey}';`);

  await pool.end();
}

const [,, name, plan] = process.argv;
createKey(name, plan || 'pro').catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
