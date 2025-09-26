import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import cors from 'cors';
import {
  insertDriver, insertTruck, listDrivers, listTrucks, getDriver,
  addLog, listLogs, deleteLog, updateLog, getPayrollTotals,
  listLogsUnapproved, approveLog, listLogsByPeriod, closePeriodMarkApproved, setLogPeriod
} from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---- CORS ----
const ALLOWED_ORIGINS = [
  'https://pricefarmtrucking-pixel.github.io',
  'https://pricefarmtrucking.github.io'
];
app.use(cors({
  origin: function (origin, cb) {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, false);
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

// ---- Role/Auth helpers ----
function roleFrom(req) {
  const token = req.headers['x-auth'] || req.query.token;
  if (!token) return { role: 'guest' };
  if (process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN) return { role: 'admin' };

  let map = {};
  try { map = JSON.parse(process.env.DRIVER_TOKENS_JSON || '{}'); } catch {}
  for (const [driverId, t] of Object.entries(map)) {
    if (token === t) return { role: 'driver', driverId: Number(driverId) };
  }
  return { role: 'guest' };
}

// ---- CSV escape helper ----
function csvEscape(s) {
  const str = String(s ?? '');
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// ---- Pay period helpers ----
const WEEK_STARTS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
function currentPayPeriod(now = new Date()) {
  const startCode = (process.env.PAY_WEEK_START || 'MON').toUpperCase();
  const startIdx = WEEK_STARTS.indexOf(startCode);
  const hhmm = String(process.env.PAY_CUTOFF_HHMM || '1700').padStart(4,'0');
  const cutoffH = Number(hhmm.slice(0,2)), cutoffM = Number(hhmm.slice(2,4));

  const d = new Date(now);
  const day = d.getDay();
  let diff = (day - startIdx + 7) % 7;
  const start = new Date(d); start.setHours(0,0,0,0); start.setDate(d.getDate()-diff);

  const cutoff = new Date(start); cutoff.setHours(cutoffH, cutoffM, 0, 0);
  if (now < cutoff) start.setDate(start.getDate()-7);

  const end = new Date(start); end.setDate(start.getDate()+6);
  const toISO = (x)=> x.toISOString().slice(0,10);
  return { start: toISO(start), end: toISO(end) };
}

// ---- API routes (truncated for brevity, same as before) ----
// Example: logs.csv endpoint fixed

app.get('/api/logs.csv', (req, res) => {
  const user = roleFrom(req);
  const params = {
    from: req.query.from || null,
    to: req.query.to || null,
    driver_id: req.query.driver_id ? Number(req.query.driver_id) : (user.role==='driver' ? user.driverId : null),
    truck_id:  req.query.truck_id ? Number(req.query.truck_id) : null
  };
  const rows = listLogs.all(params);
  const header = ['id','log_date','driver_name','truck_unit','miles','value','rpm','per_value','detention_minutes','detention_rate','notes','approved_at','approved_by','period_start','period_end'];
  const csv = [
    header.join(','),
    ...rows.map(r => header.map(h => csvEscape(r[h])).join(','))
  ].join('\n');

  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename="driver_logs.csv"');
  res.send(csv);
});

// ---- health ----
app.get('/api/ping', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`Driver Daily Log API booting on :${PORT}`);
});
