/**
 * InjuryWire — Twitter User ID Lookup
 *
 * Converts reporter handles → numeric Twitter user IDs via TweetAPI,
 * then writes the updated reporters.js with IDs filled in.
 *
 * Run once before starting the ingestion pipeline:
 *   node scripts/lookup-ids.js
 */

require('dotenv').config();
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const REPORTERS   = require('../ingestion/reporters');
const TWEETAPI_KEY = process.env.TWEETAPI_KEY;
const BATCH_SIZE  = 10;   // look up 10 at a time
const DELAY_MS    = 500;  // between batches

async function lookupBatch(handles) {
  // TweetAPI user lookup — adjust endpoint if their docs differ
  const res = await axios.get('https://api.tweetapi.io/twitter/user/lookup', {
    headers: { 'X-API-Key': TWEETAPI_KEY },
    params:  { usernames: handles.join(',') },
    timeout: 15000,
  });

  // Response is typically { data: [ { id, username, name, ... } ] }
  const users = res.data?.data || res.data?.users || [];
  const map = {};
  for (const u of users) {
    map[(u.username || u.screen_name || '').toLowerCase()] = u.id || u.id_str;
  }
  return map;
}

async function main() {
  if (!TWEETAPI_KEY) {
    console.error('❌  TWEETAPI_KEY not set in .env');
    process.exit(1);
  }

  console.log(`Looking up user IDs for ${REPORTERS.length} reporters...`);

  const idMap   = {};
  const missing = [];

  // Work in batches
  for (let i = 0; i < REPORTERS.length; i += BATCH_SIZE) {
    const batch   = REPORTERS.slice(i, i + BATCH_SIZE);
    const handles = batch.map(r => r.handle).filter(Boolean);

    try {
      const result = await lookupBatch(handles);
      Object.assign(idMap, result);
      const found = batch.filter(r => idMap[r.handle.toLowerCase()]);
      console.log(`  Batch ${Math.floor(i/BATCH_SIZE)+1}: ${found.length}/${batch.length} found`);
    } catch (err) {
      console.error(`  ❌ Batch ${Math.floor(i/BATCH_SIZE)+1} failed: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // Merge IDs back in
  let filled = 0;
  for (const r of REPORTERS) {
    const id = idMap[r.handle.toLowerCase()];
    if (id) {
      r.userId = id;
      filled++;
    } else {
      missing.push(r.handle);
    }
  }

  // Rewrite reporters.js with IDs filled
  const outPath = path.join(__dirname, '../ingestion/reporters.js');
  const lines = [
    `// Auto-generated — ${filled}/${REPORTERS.length} reporters have user IDs`,
    `// Last updated: ${new Date().toISOString()}`,
    '',
    'const REPORTERS = [',
    ...REPORTERS.map(r =>
      `  { name: ${JSON.stringify(r.name)}, handle: ${JSON.stringify(r.handle)}, ` +
      `userId: ${r.userId ? JSON.stringify(r.userId) : 'null'}, ` +
      `outlet: ${JSON.stringify(r.outlet)}, team: ${JSON.stringify(r.team)}, ` +
      `tier: ${r.tier}, signal: ${JSON.stringify(r.signal)}, conf: ${JSON.stringify(r.conf)}, ` +
      `notes: ${JSON.stringify(r.notes)} },`
    ),
    '];',
    '',
    'module.exports = REPORTERS;',
    '',
  ];

  fs.writeFileSync(outPath, lines.join('\n'));

  console.log(`\n✅  Done: ${filled} IDs filled in reporters.js`);
  if (missing.length) {
    console.log(`\n⚠  Missing IDs for ${missing.length} handles:`);
    missing.forEach(h => console.log(`   @${h}`));
    console.log('\nFor these, look up manually at: https://tweeterid.com');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
