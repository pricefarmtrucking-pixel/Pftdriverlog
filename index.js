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

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Submit log
app.post('/api/public/submit', async (req, res) => {
  try {
    const log = req.body;
    await insertLog(log);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit log' });
  }
});

// Admin routes
app.get('/api/admin/logs', (req, res) => {
  if (req.query.token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const logs = getLogs();
  res.json(logs);
});

app.get('/api/admin/payroll', (req, res) => {
  if (req.query.token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const payroll = getPayroll();
  res.json(payroll);
});

app.listen(PORT, () => {
  console.log(`Driver Daily Log API running on :${PORT}`);
  initDb();
});
