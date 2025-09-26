// index.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import cors from 'cors';

import {
  insertDriver, insertTruck, listDrivers, listTrucks, getDriver,
  setDriverDefaults,
  addLog, listLogs, deleteLog, updateLog, getPayrollTotals,
  listLogsUnapproved, approveLog, listLogsByPeriod, closePeriodMarkApproved, setLogPeriod,
  db
} from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const ALLOWED_ORIGINS = [
  'https://pricefarmtrucking-pixel.github.io',
  'https://pricefarmtrucking.github.io'
];
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, false);
  }
}));

app.get('/', (req, res) => {
  res.type('text/plain').send('Driver Daily Log API running. Try /api/ping');
});

function roleFrom(req) {
  const token = req.headers['x-auth'] || req.query.token;
  if (!token) return { role: 'guest' };
  if (process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN) return { role: 'admin' };
  let map = {};
  try { map = JSON.parse(process.env.DRIVER_TOKENS_JSON || '{}'); } catch { map = {}; }
  for (const [driverId, t] of Object.entries(map)) {
    if (token === t) return { role: 'driver', driverId: Number(driverId) };
  }
  return { role: 'guest' };
}

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

function getOrCreateTruckId(unit){
  if (!unit || !unit.trim()) return null;
  const row = db.prepare('SELECT id FROM trucks WHERE unit = ?').get(unit.trim());
  if (row && row.id) return row.id;
  insertTruck.run(unit.trim());
  const row2 = db.prepare('SELECT id FROM trucks WHERE unit = ?').get(unit.trim());
  return row2 ? row2.id : null;
}

function driverIdFromToken(tok){
  let map = {};
  try { map = JSON.parse(process.env.DRIVER_TOKENS_JSON || '{}'); } catch { map = {}; }
  for (const [driverId, t] of Object.entries(map)) {
    if (tok === t) return Number(driverId);
  }
  return null;
}

app.post('/api/public/submit', (req, res) => {
  try {
    const token = req.body.driver_token || req.headers['x-auth'];
    const driverId = driverIdFromToken(token);
    if (!driverId) {
      console.warn('[submit] invalid token:', token);
      return res.status(401).json({ error: 'invalid driver token' });
    }
    const truck_unit = String(req.body.truck_unit || '').trim();
    const truckId = getOrCreateTruckId(truck_unit);
    if (!truckId) return res.status(400).json({ error: 'truck_unit required' });
    const log_date = req.body.log_date;
    if (!log_date) return res.status(400).json({ error: 'log_date required' });
    const drv = getDriver.get(driverId);
    const rpm = drv?.rpm_default ?? 0.46;
    const det_rate = drv?.hourly_default ?? 0;
    const per_value = 25;
    const { start, end } = currentPayPeriod();
    const data = {
      log_date,
      driver_id: driverId,
      truck_id: truckId,
      miles: Number(req.body.miles || 0),
      value: Number(req.body.value || 0),
      rpm: Number(rpm),
      per_value: Number(per_value),
      detention_minutes: Number(req.body.detention_minutes || 0),
      detention_rate: Number(det_rate),
      notes: req.body.notes || '',
      period_start: start,
      period_end: end
    };
    const existing = db.prepare(
      'SELECT * FROM logs WHERE log_date = ? AND truck_id = ? AND driver_id = ? ORDER BY id DESC LIMIT 1'
    ).get(data.log_date, data.truck_id, data.driver_id);
    const dupAction = (req.body.dup_action || '').toLowerCase();
    if (existing && !dupAction) {
      return res.status(409).json({
        duplicate: true,
        existing: { id: existing.id, miles: existing.miles, value: existing.value, detention_minutes: existing.detention_minutes }
      });
    }
    if (existing && dupAction === 'replace') {
      updateLog.run({ ...data, id: existing.id });
      return res.json({ ok: true, id: existing.id, action: 'replaced' });
    }
    if (existing && dupAction === 'append') {
      db.prepare(`UPDATE logs SET
        miles = miles + @miles,
        value = value + @value,
        detention_minutes = detention_minutes + @detention_minutes,
        notes = CASE
          WHEN @notes IS NULL OR TRIM(@notes) = '' THEN notes
          WHEN notes IS NULL OR TRIM(notes) = '' THEN @notes
          ELSE notes || char(10) || @notes
        END
      WHERE id=@id`).run({
        id: existing.id,
        miles: data.miles,
        value: data.value,
        detention_minutes: data.detention_minutes,
        notes: data.notes
      });
      return res.json({ ok: true, id: existing.id, action: 'appended' });
    }
    const info = addLog.run(data);
    return res.json({ ok: true, id: info.lastInsertRowid, action: 'created' });
  } catch (err) {
    console.error('[submit] ERROR:', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: 'server error', detail: String(err && err.message || err) });
  }
});

app.get('/api/ping', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`Driver Daily Log running on :${PORT}`);
});
