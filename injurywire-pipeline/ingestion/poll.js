/**
 * InjuryWire — Main Polling Script
 * Runs on a schedule (every 10 min via Railway Cron).
 * For each reporter: fetches new tweets → keyword pre-filter → Claude Haiku classifies → saves to DB.
 */

require('dotenv').config();
const axios   = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const { Pool }  = require('pg');
const REPORTERS = require('./reporters');

// ─── CLIENTS ──────────────────────────────────────────────────────────────────
const pool   = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const TWEETAPI_BASE   = 'https://api.tweetapi.io';
const TWEETAPI_KEY    = process.env.TWEETAPI_KEY;
const MAX_TWEETS_PER_REPORTER = 10;
const DELAY_BETWEEN_REPORTERS = 300; // ms — avoid hammering TweetAPI

// ─── KEYWORD PRE-FILTER ───────────────────────────────────────────────────────
// Cheap local filter before spending Claude tokens.
// A tweet must match at least one keyword to be sent to Claude.
const INJURY_KEYWORDS = [
  'out tonight', 'ruled out', 'will not play', "won't play", 'wont play',
  'not playing', 'did not practice', 'dnp', 'scratched',
  'questionable', 'doubtful', 'probable', 'gtd', 'game-time decision',
  'game time decision', 'listed as', 'on the injury report',
  'load management', 'rest', 'sitting out',
  'knee', 'ankle', 'hamstring', 'achilles', 'back', 'shoulder',
  'hip', 'groin', 'calf', 'foot', 'wrist', 'elbow', 'hand',
  'concussion', 'illness', 'personal reasons', 'sore', 'soreness',
  'sprain', 'strain', 'fracture', 'surgery', 'rehab',
  'day-to-day', 'week-to-week', 'out indefinitely',
];

function isLikelyInjuryTweet(text) {
  const lower = text.toLowerCase();
  return INJURY_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── TWEETAPI CALLS ───────────────────────────────────────────────────────────
async function fetchUserTweets(reporter, sinceId) {
  const params = {
    userId: reporter.userId,
    maxResults: MAX_TWEETS_PER_REPORTER,
  };
  if (sinceId) params.sinceId = sinceId;

  const res = await axios.get(`${TWEETAPI_BASE}/twitter/user/tweets`, {
    headers: { 'X-API-Key': TWEETAPI_KEY },
    params,
    timeout: 10000,
  });
  return res.data?.tweets || res.data?.data || [];
}

// ─── DATABASE HELPERS ─────────────────────────────────────────────────────────
async function getLastSeenTweetId(userId) {
  const res = await pool.query(
    `SELECT tweet_id FROM raw_tweets
     WHERE reporter_user_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return res.rows[0]?.tweet_id || null;
}

async function saveTweet(tweet, reporter) {
  await pool.query(
    `INSERT INTO raw_tweets
       (tweet_id, reporter_user_id, reporter_handle, reporter_name, tweet_text, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tweet_id) DO NOTHING`,
    [
      tweet.id || tweet.tweet_id,
      reporter.userId,
      reporter.handle,
      reporter.name,
      tweet.text || tweet.full_text,
      tweet.created_at ? new Date(tweet.created_at) : new Date(),
    ]
  );
}

async function saveInjuryEvent(tweet, reporter, c) {
  // Boost confidence for tier-1 reporters
  const tierBoost = reporter.tier === 1 ? 10 : reporter.tier === 2 ? 5 : 0;
  const finalScore = Math.min(100, (c.confidence_score || 70) + tierBoost);

  await pool.query(
    `INSERT INTO injury_events
       (player_name, team, injury_description, body_part, game_status,
        confidence_score, reporter_name, reporter_handle, outlet, reporter_tier,
        tweet_text, tweet_id, event_time, is_latest)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)
     ON CONFLICT (tweet_id) DO NOTHING`,
    [
      c.player_name,
      c.team || reporter.team,
      c.injury_description,
      c.body_part,
      c.game_status,
      finalScore,
      reporter.name,
      reporter.handle,
      reporter.outlet,
      reporter.tier,
      tweet.text || tweet.full_text,
      tweet.id || tweet.tweet_id,
      tweet.created_at ? new Date(tweet.created_at) : new Date(),
    ]
  );

  // Mark any older events for same player as not-latest
  if (c.player_name) {
    await pool.query(
      `UPDATE injury_events
       SET is_latest = false
       WHERE player_name ILIKE $1
         AND tweet_id != $2
         AND is_latest = true`,
      [c.player_name, tweet.id || tweet.tweet_id]
    );
  }
}

// ─── CLAUDE CLASSIFICATION ────────────────────────────────────────────────────
async function classifyTweet(tweet, reporter) {
  const text = tweet.text || tweet.full_text || '';

  const prompt = `You are an NBA injury intelligence classifier. A beat reporter just posted this tweet.

Reporter: ${reporter.name} (covers ${reporter.team})
Tweet: "${text}"

Does this tweet contain a concrete NBA injury report about a specific player's availability for a game?

Respond ONLY with a single JSON object — no markdown, no explanation, just the JSON:
{
  "is_injury_report": true or false,
  "player_name": "First Last" or null,
  "team": "Full Team Name" or null,
  "injury_description": "brief description e.g. left ankle sprain" or null,
  "body_part": "ankle" | "knee" | "hamstring" | "back" | "shoulder" | "hip" | "groin" | "calf" | "foot" | "wrist" | "elbow" | "hand" | "illness" | "other" | null,
  "game_status": "Out" | "Doubtful" | "Questionable" | "Game-Time Decision" | "Probable" | null,
  "confidence_score": integer 0-90
}

Rules:
- Only set is_injury_report=true if a SPECIFIC player's game status is mentioned
- confidence_score: 80-90 = explicit ruled out/will not play, 60-79 = questionable/doubtful stated, 40-59 = injury mentioned but status unclear, below 40 = very vague
- If unsure about any field, use null`;

  const response = await claude.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0]?.text?.trim() || '';
  try {
    // Strip any accidental markdown fences
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    console.warn(`  ⚠ Could not parse Claude response: ${raw.slice(0, 80)}`);
    return { is_injury_report: false };
  }
}

// ─── MAIN POLL LOOP ───────────────────────────────────────────────────────────
async function pollReporter(reporter) {
  if (!reporter.userId) return; // skip reporters without IDs yet

  const sinceId = await getLastSeenTweetId(reporter.userId);
  const tweets  = await fetchUserTweets(reporter, sinceId);

  if (!tweets.length) return;

  let injuryCount = 0;

  for (const tweet of tweets) {
    const text = tweet.text || tweet.full_text || '';
    await saveTweet(tweet, reporter);

    if (!isLikelyInjuryTweet(text)) continue;

    const classification = await classifyTweet(tweet, reporter);

    if (classification.is_injury_report && classification.player_name) {
      await saveInjuryEvent(tweet, reporter, classification);
      injuryCount++;
      console.log(
        `  ✅ ${reporter.name} → ${classification.player_name}` +
        ` (${classification.game_status}) [${classification.confidence_score}]`
      );
    }
  }

  return injuryCount;
}

async function runPoll() {
  const start = Date.now();
  console.log(`\n[${new Date().toISOString()}] ─── InjuryWire Poll Starting ───`);
  console.log(`  Reporters with user IDs: ${REPORTERS.filter(r => r.userId).length} / ${REPORTERS.length}`);

  let totalTweetsChecked = 0;
  let totalInjuries = 0;
  let errors = 0;

  for (const reporter of REPORTERS) {
    if (!reporter.userId) continue;
    try {
      const found = await pollReporter(reporter);
      if (found) totalInjuries += found;
      totalTweetsChecked++;
    } catch (err) {
      errors++;
      console.error(`  ❌ ${reporter.name}: ${err.message}`);
    }
    // Polite delay between reporters
    await new Promise(r => setTimeout(r, DELAY_BETWEEN_REPORTERS));
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n[Done] ${totalInjuries} injury events saved | ${errors} errors | ${elapsed}s`);
  await pool.end();
}

runPoll().catch(err => {
  console.error('Fatal poll error:', err);
  process.exit(1);
});
