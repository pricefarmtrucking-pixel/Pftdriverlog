
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import {
  initDb,
  insertLog,
  getLogs,
  getLogById,
  updateLog,
  markPaid,
  getPayroll
} from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/** Auth helper for admin routes */
function assertAdmin(req, res) {
  if (req.query.token !== process.env.ADMIN_TOKEN && req.headers['x-auth'] !== process.env.ADMIN_TOKEN) {
    res.status(403).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// Submit log (driver facing)
app.post('/api/public/submit', async (req, res) => {
  try {
    const log = req.body || {};
    // sanitize minimal
    const data = {
      log_date: log.log_date || null,
      driver_name: log.driver_name || null,
      driver_email: log.driver_email || null,
      truck_unit: log.truck_unit || null,
      miles: Number(log.miles || 0),
      stop_value: Number(log.value || 0),
      detention_minutes: Number(log.detention_minutes || 0),
      detention_rate: Number(log.detention_rate || 0),
      start_time: log.start_time || null,
      end_time: log.end_time || null,
      total_minutes: Number(log.total_minutes || 0),
      notes: log.notes || null
    };
    const id = insertLog(data);
    res.json({ ok: true, id });
  } catch (err) {
    console.error('[submit] error:', err);
    res.status(500).json({ error: 'Failed to submit log' });
  }
});

// ---- Admin: list logs with filters ----
app.get('/api/admin/logs', (req, res) => {
  if (!assertAdmin(req, res)) return;
  const { from, to } = req.query;
  const rows = getLogs(from || null, to || null);
  res.json(rows);
});

// ---- Admin: get log by id ----
app.get('/api/admin/logs/:id', (req, res) => {
  if (!assertAdmin(req, res)) return;
  const row = getLogById(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// ---- Admin: update log ----
app.put('/api/admin/logs/:id', async (req, res) => {
  if (!assertAdmin(req, res)) return;
  try {
    const fields = req.body || {};
    updateLog(Number(req.params.id), fields);

    // Optional: notify via webhook (edited copy)
    const hook = process.env.MAIL_WEBHOOK_URL;
    if (hook) {
      try {
        const row = getLogById(Number(req.params.id));
        await fetch(hook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'driver_log_edited', log: row })
        }).catch(()=>{});
      } catch {}
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[update] error:', e);
    res.status(500).json({ error: 'Update failed' });
  }
});

// ---- Admin: mark selected as paid ----
app.post('/api/admin/mark-paid', (req, res) => {
  if (!assertAdmin(req, res)) return;
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids required' });
  markPaid(ids.map(n=>Number(n)));
  res.json({ ok: true });
});

// ---- Admin: payroll summary ----
app.get('/api/admin/payroll', (req, res) => {
  if (!assertAdmin(req, res)) return;
  const { from, to } = req.query;
  const rows = getPayroll(from || null, to || null);
  res.json(rows);
});

app.listen(PORT, () => {
  console.log(`Driver Daily Log API running on :${PORT}`);
  initDb();
});
