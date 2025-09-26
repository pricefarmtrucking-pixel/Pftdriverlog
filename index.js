import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import { initDb, insertLog, getLogs, getPayroll } from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (admin.html lives here)
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// --- Public submit (from the GitHub Pages driver form) ---
app.post('/api/public/submit', async (req, res) => {
  try {
    const b = req.body || {};

    // Normalize/defend inputs
    const normalized = {
      driver_token: String(b.driver_token || '').trim(),
      log_date: String(b.log_date || '').trim(),     // YYYY-MM-DD
      truck: (b.truck_unit ?? b.truck ?? null) ? String(b.truck_unit ?? b.truck).trim() : null,
      miles: Number(b.miles || 0),
      value: Number(b.value || 0),
      detention_minutes: Number(b.detention_minutes || 0),
      notes: String(b.notes || '').trim(),
    };

    if (!normalized.driver_token) return res.status(400).json({ error: 'driver_token required' });
    if (!normalized.log_date)     return res.status(400).json({ error: 'log_date required' });

    await insertLog(normalized);
    res.json({ ok: true });
  } catch (err) {
    console.error('submit error:', err);
    res.status(500).json({ error: 'Failed to submit log' });
  }
});

// --- Admin routes (token via query ?token=ADMIN_TOKEN) ---
function requireAdmin(req, res, next) {
  if (req.query.token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/api/admin/logs', requireAdmin, (req, res) => {
  res.json(getLogs());
});

app.get('/api/admin/payroll', requireAdmin, (req, res) => {
  res.json(getPayroll());
});

// Boot
app.listen(PORT, () => {
  console.log(`Driver Daily Log API running on :${PORT}`);
  initDb();
});