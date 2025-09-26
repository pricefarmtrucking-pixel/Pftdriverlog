import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';

// NOTE: db.js must export getOrCreateTruckId for truck unit -> truck_id
import {
  initDb,
  insertLog,
  getLogs,
  getLogById,
  updateLog,
  markPaid,
  getPayroll,
  getOrCreateTruckId
} from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

/* -------------------------------------------------
   CORS + Body parsing
-------------------------------------------------- */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* -------------------------------------------------
   Static (admin page, etc)
-------------------------------------------------- */
app.use(express.static(path.join(__dirname, 'public')));

/* -------------------------------------------------
   Helpers
-------------------------------------------------- */
function driverIdFromToken(token) {
  if (!token) return null;
  try {
    // Expect env like: {"1":"41571","2":"82785"}
    const map = JSON.parse(process.env.DRIVER_TOKENS_JSON || '{}');
    for (const [driverId, t] of Object.entries(map)) {
      if (String(token).trim() === String(t).trim()) return Number(driverId);
    }
  } catch (e) {
    console.error('[driverIdFromToken] bad DRIVER_TOKENS_JSON:', e?.message);
  }
  return null;
}

function requireAdmin(req, res) {
  if (req.query.token !== process.env.ADMIN_TOKEN) {
    res.status(403).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

/* -------------------------------------------------
   Health
-------------------------------------------------- */
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/* -------------------------------------------------
   Driver submission (public)
   Expects body:
   {
     driver_token, log_date (YYYY-MM-DD), truck_unit (string/number),
     miles, value, detention_minutes, notes
   }
-------------------------------------------------- */
app.post('/api/public/submit', async (req, res) => {
  try {
    const {
      driver_token,
      log_date,
      truck_unit,
      miles,
      value,
      detention_minutes,
      notes
    } = req.body || {};

    // Validate required fields
    if (!log_date) throw new Error('log_date is required (YYYY-MM-DD)');
    if (!truck_unit) throw new Error('truck_unit is required');

    // Resolve driver by token (from env DRIVER_TOKENS_JSON)
    const driver_id = driverIdFromToken(driver_token || req.headers['x-auth']);
    if (!driver_id) {
      throw new Error('invalid driver token (no match in DRIVER_TOKENS_JSON)');
    }

    // Resolve or create truck_id
    const truck_id = await getOrCreateTruckId(String(truck_unit).trim());
    if (!truck_id) throw new Error('could not resolve truck_id from truck_unit');

    // Coerce numerics
    const milesNum = Number(miles || 0);
    const valueNum = Number(value || 0);
    const detMin   = Number(detention_minutes || 0);

    // Insert via db.js; db.js should default rpm/per_value/detention_rate if needed
    await insertLog({
      log_date,
      driver_id,
      truck_id,
      miles: milesNum,
      value: valueNum,
      detention_minutes: detMin,
      notes: notes || ''
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/public/submit] error:', err);
    // Return specific reason to help debug from the browser
    return res.status(400).json({ error: err?.message || String(err) });
  }
});

/* -------------------------------------------------
   Admin: list logs (optional from/to filters)
-------------------------------------------------- */
app.get('/api/admin/logs', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { from, to } = req.query;
  const logs = getLogs(from, to);
  res.json(logs);
});

/* -------------------------------------------------
   Admin: get one log by id
-------------------------------------------------- */
app.get('/api/admin/logs/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const log = getLogById(req.params.id);
  if (!log) return res.status(404).json({ error: 'Not found' });
  res.json(log);
});

/* -------------------------------------------------
   Admin: update a log
-------------------------------------------------- */
app.put('/api/admin/logs/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    updateLog(req.params.id, req.body);
    res.json({ ok: true });
  } catch (e) {
    console.error('[PUT /api/admin/logs/:id] error:', e);
    res.status(500).json({ error: 'Update failed' });
  }
});

/* -------------------------------------------------
   Admin: mark multiple logs paid
   Body: { ids: [1,2,3] }
-------------------------------------------------- */
app.post('/api/admin/mark-paid', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids required' });
  try {
    markPaid(ids);
    res.json({ ok: true });
  } catch (e) {
    console.error('[POST /api/admin/mark-paid] error:', e);
    res.status(500).json({ error: 'Mark paid failed' });
  }
});

/* -------------------------------------------------
   Admin: payroll summary (optional from/to filters)
-------------------------------------------------- */
app.get('/api/admin/payroll', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { from, to } = req.query;
  const payroll = getPayroll(from, to);
  res.json(payroll);
});

/* -------------------------------------------------
   Boot
-------------------------------------------------- */
app.listen(PORT, () => {
  console.log(`Driver Daily Log API running on :${PORT}`);
  initDb();
});
