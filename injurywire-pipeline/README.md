# InjuryWire Pipeline

NBA injury ingestion pipeline + REST API.

**What it does:** Every 10 minutes, polls 212 NBA beat reporters on X/Twitter, runs each tweet through a keyword filter, classifies injury-relevant tweets with Claude Haiku, and stores structured injury events in PostgreSQL. The REST API serves that data to your dashboard and future customers.

---

## Architecture

```
TweetAPI (212 reporters)
    ↓ new tweets every 10min
Keyword Pre-filter (local, free)
    ↓ injury-likely tweets only
Claude Haiku (classify + extract)
    ↓ structured injury events
PostgreSQL / Neon
    ↓
REST API → Dashboard + Customers
```

---

## Deploy in 5 Steps

### Step 1 — Push to GitHub

1. Create a new repo at github.com (e.g. `injurywire-pipeline`)
2. Upload this entire folder to it (drag-and-drop on GitHub works)

### Step 2 — Create a Neon database

1. Go to [neon.tech](https://neon.tech) → New Project → name it `injurywire`
2. Copy the **Connection String** (looks like `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`)
3. Run the schema: in Neon's SQL Editor, paste and run the contents of `db/schema.sql`

### Step 3 — Deploy to Railway

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub → select your repo
2. Add these environment variables in Railway's Variables tab:

```
DATABASE_URL       = (your Neon connection string)
TWEETAPI_KEY       = (from tweetapi.io dashboard)
ANTHROPIC_API_KEY  = (from console.anthropic.com)
```

3. Railway will auto-deploy. Your API URL will be something like:
   `https://injurywire-pipeline-production.up.railway.app`

### Step 4 — Seed reporters + get an API key

Open the Railway shell (your project → Shell tab) and run:

```bash
# Load all 212 reporters into the database
node scripts/seed-reporters.js

# Look up their Twitter user IDs (needed before polling starts)
node scripts/lookup-ids.js

# Create an API key for your dashboard
node scripts/create-key.js "InjuryWire Dashboard" pro
```

Copy the key it prints — it's shown only once.

### Step 5 — Connect the dashboard

In your `index.html`, find these two lines near the top of the script and fill them in:

```js
const API_URL = 'https://injurywire-pipeline-production.up.railway.app';
const API_KEY = 'iw_xxxxxxxxxxxxxxxxxxxx';  // the key from Step 4
```

Push `index.html` to GitHub → your live dashboard at injurywire.io will start showing real data.

---

## Set Up Automatic Polling (Cron)

In Railway, add a **second service** as a Cron Job:

- Command: `node ingestion/poll.js`  
- Schedule: `*/10 * * * *` (every 10 minutes)
- Or game-hours only: `*/10 19-23 * * *` (7pm–midnight ET)

Add the same environment variables to this service too.

---

## API Endpoints

All endpoints require `X-Api-Key` header or `?api_key=` query param.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Public health check |
| GET | `/v1/injuries/live` | Out/Q/GTD from last 6 hours |
| GET | `/v1/injuries` | All injuries (filters: status, min_confidence, since, limit) |
| GET | `/v1/injuries/team/:team` | Injuries by team name |
| GET | `/v1/injuries/:player` | Injuries by player name |
| GET | `/v1/reporters` | All 212 reporters (filters: team, tier, signal) |
| GET | `/v1/status` | Pipeline health + injury counts |

---

## File Structure

```
injurywire-pipeline/
├── server.js                  ← API server (Express)
├── package.json
├── railway.json
├── Procfile
├── .env.example               ← copy to .env and fill in
├── db/
│   └── schema.sql             ← run once against Neon
├── middleware/
│   └── auth.js                ← API key validation
├── routes/
│   ├── injuries.js            ← /v1/injuries endpoints
│   └── misc.js                ← /v1/reporters + /v1/status
├── ingestion/
│   ├── poll.js                ← main polling script (runs on cron)
│   └── reporters.js           ← all 212 reporters (auto-generated)
└── scripts/
    ├── lookup-ids.js          ← convert handles → Twitter user IDs
    ├── seed-reporters.js      ← seed reporters table in DB
    └── create-key.js          ← generate API keys
```

---

## Cost Estimate

| Service | Cost |
|---------|------|
| TweetAPI | ~$15/mo (212 reporters × 10min polls) |
| Claude Haiku | ~$3/mo (keyword pre-filter keeps this very low) |
| Neon PostgreSQL | Free tier |
| Railway | ~$5/mo |
| **Total** | **~$23/mo** |
