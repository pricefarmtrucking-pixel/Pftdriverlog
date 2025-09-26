import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import { initDb, insertLog, getLogs, getLogById, updateLog, markPaid, getPayroll } from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Submit log (driver facing)
app.post('/api/public/submit', async (req, res) => {
  try {
    const log = req.body;
    const dup = insertLog(log);
    if (dup.duplicate) {
      return res.status(409).json({ error: 'duplicate', existing: dup.existing });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit log' });
  }
});

// Admin: list logs with filters
app.get('/api/admin/logs', (req, res) => {
  if (req.query.token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { from, to } = req.query;
  const logs = getLogs(from, to);
  res.json(logs);
});

// Admin: get log by id
app.get('/api/admin/logs/:id', (req, res) => {
  if (req.query.token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const log = getLogById(req.params.id);
  if (!log) return res.status(404).json({ error: 'Not found' });
  res.json(log);
});

// Admin: update log
app.put('/api/admin/logs/:id', (req, res) => {
  if (req.query.token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    updateLog(req.params.id, req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// Admin: mark paid
app.post('/api/admin/mark-paid', (req, res) => {
  if (req.query.token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids required' });
  markPaid(ids);
  res.json({ ok: true });
});

// Admin: payroll summary
app.get('/api/admin/payroll', (req, res) => {
  if (req.query.token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { from, to } = req.query;
  const payroll = getPayroll(from, to);
  res.json(payroll);
});

app.listen(PORT, () => {
  console.log(`Driver Daily Log API running on :${PORT}`);
  initDb();
});