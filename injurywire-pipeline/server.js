/**
 * InjuryWire — API Server
 * Express REST API serving injury data to the dashboard and external customers.
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const auth    = require('./middleware/auth');
const injuries = require('./routes/injuries');
const { reportersRouter, statusRouter } = require('./routes/misc');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ─── PUBLIC ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'InjuryWire API', ts: new Date() });
});

// ─── AUTHENTICATED ────────────────────────────────────────────────────────────
app.use('/v1', auth);
app.use('/v1/injuries',  injuries);
app.use('/v1/reporters', reportersRouter);
app.use('/v1/status',    statusRouter);

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`InjuryWire API running on port ${PORT}`);
});
