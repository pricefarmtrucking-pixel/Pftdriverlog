import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import cors from 'cors';
import {
  insertDriver, insertTruck, listDrivers, listTrucks, getDriver,
  setDriverDefaults,
  addLog, listLogs, deleteLog, updateLog, getPayrollTotals,
  listLogsUnapproved, approveLog, listLogsByPeriod, closePeriodMarkApproved, setLogPeriod
} from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// ---- CORS for GitHub Pages driver landing ----
const ALLOWED_ORIGINS = [
  'https://pricefarmtrucking-pixel.github.io',
  'https://pricefarmtrucking.github.io'
];
app.use(cors({
  origin: function (origin, cb) {
    // allow same-origin or no origin (like curl)
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, false);
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

// ---- Simple auth via header token ----
function roleFrom(req) {
  const token = req.headers['x-auth'] || req.query.token;
  if (!token) return { role: 'guest' };
  if (process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN) return { role: 'admin' };

  // Driver tokens map
  let map = {};
  try { map = JSON.parse(process.env.DRIVER_TOKENS_JSON || '{}'); } catch {}
  for (const [driverId, t] of Object.entries(map)) {
    if (token === t) return { role: 'driver', driverId: Number(driverId) };
  }
  return { role: 'guest' };
}

// ---- Pay period helpers ----
const WEEK_STARTS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
function currentPayPeriod(now = new Date()) {
  const startCode = (process.env.PAY_WEEK_START || 'MON').toUpperCase();
  const startIdx = WEEK_STARTS.indexOf(startCode); // 0..6
  const hhmm = String(process.env.PAY_CUTOFF_HHMM || '1700').padStart(4,'0');
  const cutoffH = Number(hhmm.slice(0,2)), cutoffM = Number(hhmm.slice(2,4));

  const d = new Date(now);
  const day = d.getDay(); // 0=SUN
  let diff = (day - startIdx + 7) % 7;
  const start = new Date(d); start.setHours(0,0,0,0); start.setDate(d.getDate()-diff);

  // If now is before the cutoff on the start day, roll back one week
  const cutoff = new Date(start); cutoff.setHours(cutoffH, cutoffM, 0, 0);
  if (now < cutoff) start.setDate(start.getDate()-7);

  const end = new Date(start); end.setDate(start.getDate()+6);
  const toISO = (x)=> x.toISOString().slice(0,10);
  return { start: toISO(start), end: toISO(end) };
}

// ---- Seed endpoints ----
app.post('/api/seed/driver', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  insertDriver.run(name);
  res.json({ ok: true });
});

app.post('/api/seed/truck', (req, res) => {
  const { unit } = req.body;
  if (!unit) return res.status(400).json({ error: 'unit required' });
  insertTruck.run(unit);
  res.json({ ok: true });
});

// ---- Admin: set per-driver defaults ----
app.post('/api/driver/:id/defaults', (req,res)=>{
  const user = roleFrom(req);
  if (user.role!=='admin') return res.status(403).json({ error:'admin only' });
  setDriverDefaults.run({ id:Number(req.params.id), rpm_default:req.body.rpm_default, hourly_default:req.body.hourly_default });
  res.json({ ok:true });
});

// ---- Lists ----
app.get('/api/drivers', (req, res) => res.json(listDrivers.all()));
app.get('/api/trucks',  (req, res) => res.json(listTrucks.all()));

// ---- Create log: server-side default rates (driver-specific) ----
app.post('/api/logs', (req, res) => {
  const user = roleFrom(req);

  let rpm = req.body.rpm;
  let per_value = req.body.per_value;
  let det_rate = req.body.detention_rate;

  if (rpm == null || det_rate == null) {
    const drv = getDriver.get(Number(req.body.driver_id));
    if (drv) {
      if (rpm == null) rpm = drv.rpm_default ?? 0.46;
      if (det_rate == null) det_rate = drv.hourly_default ?? 0;
    } else {
      if (rpm == null) rpm = 0.46;
      if (det_rate == null) det_rate = 0;
    }
  }
  if (per_value == null) per_value = 25;

  // Optionally, auto-assign current period when created
  const { start, end } = currentPayPeriod();

  const data = {
    log_date: req.body.log_date,
    driver_id: Number(req.body.driver_id),
    truck_id: Number(req.body.truck_id),
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
  const info = addLog.run(data);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// ---- Update/Delete ----
app.put('/api/logs/:id', (req, res) => {
  const user = roleFrom(req);
  if (user.role === 'guest') return res.status(401).json({ error: 'auth required' });

  const data = {
    id: Number(req.params.id),
    log_date: req.body.log_date,
    driver_id: Number(req.body.driver_id),
    truck_id: Number(req.body.truck_id),
    miles: Number(req.body.miles || 0),
    value: Number(req.body.value || 0),
    rpm: Number(req.body.rpm ?? 0.46),
    per_value: Number(req.body.per_value ?? 25),
    detention_minutes: Number(req.body.detention_minutes || 0),
    detention_rate: Number(req.body.detention_rate || 0),
    notes: req.body.notes || ''
  };
  updateLog.run(data);
  res.json({ ok: true });
});

app.delete('/api/logs/:id', (req, res) => {
  const user = roleFrom(req);
  if (user.role === 'guest') return res.status(401).json({ error: 'auth required' });
  deleteLog.run(Number(req.params.id));
  res.json({ ok: true });
});

// ---- Fetch logs w/ privacy for drivers ----
app.get('/api/logs', (req, res) => {
  const user = roleFrom(req);
  const params = {
    from: req.query.from || null,
    to: req.query.to || null,
    driver_id: req.query.driver_id ? Number(req.query.driver_id) : (user.role==='driver' ? user.driverId : null),
    truck_id:  req.query.truck_id ? Number(req.query.truck_id) : null
  };
  let rows = listLogs.all(params);

  if (user.role === 'driver') {
    rows = rows
      .filter(r => r.driver_id === user.driverId) // only own rows
      .map(r => ({
        ...r,
        // their own rates are visible; no other rows present
      }));
  }
  res.json(rows);
});

// ---- Payroll aggregation ----
app.get('/api/payroll', (req, res) => {
  const user = roleFrom(req);
  const params = {
    from: req.query.from || null,
    to: req.query.to || null,
    driver_id: req.query.driver_id ? Number(req.query.driver_id) : (user.role==='driver' ? user.driverId : null),
    truck_id:  req.query.truck_id ? Number(req.query.truck_id) : null
  };
  const rows = getPayrollTotals.all(params);
  res.json(rows);
});

// ---- CSV export (filtered) ----
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
    ...rows.map(r => header.map(h => {
      const v = r[h] ?? '';
      const s = String(v).replaceAll('"','""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    }).join(','))
  ].join('\n');

  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename="driver_logs.csv"');
  res.send(csv);
});

// ---- Approvals ----
app.get('/api/approvals/pending', (req, res) => {
  const user = roleFrom(req);
  if (user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  res.json(listLogsUnapproved.all());
});

app.post('/api/approvals/:id/approve', (req, res) => {
  const user = roleFrom(req);
  if (user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  approveLog.run({ id: Number(req.params.id), by: 'admin' });
  res.json({ ok: true });
});

// ---- Period assignment & closing ----
app.get('/api/period/current', (req, res) => {
  res.json(currentPayPeriod());
});

app.post('/api/period/assign', (req, res) => {
  const user = roleFrom(req);
  if (user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  const { ids } = req.body;
  const { start, end } = currentPayPeriod();
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids required' });
  setLogPeriod(ids.map(n=>Number(n)), start, end);
  res.json({ ok:true, start, end });
});

app.post('/api/period/close', async (req, res) => {
  const user = roleFrom(req);
  if (user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  const { start, end } = req.body;
  if (!start || !end) return res.status(400).json({ error: 'start/end required' });

  closePeriodMarkApproved.run({ start, end, by: 'admin' });

  const rows = listLogsByPeriod.all({ start, end });
  const header = ['id','log_date','driver_name','truck_unit','miles','value','rpm','per_value','detention_minutes','detention_rate','notes','approved_at','approved_by','period_start','period_end'];
  const csv = [
    header.join(','),
    ...rows.map(r => header.map(h => {
      const v = r[h] ?? '';
      const s = String(v).replaceAll('"','""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    }).join(','))
  ].join('\n');

  // Save to Render disk
  const fname = `/data/payroll_${start}_to_${end}.csv`;
  fs.writeFileSync(fname, csv, 'utf8');

  // Optional Drive upload
  let driveFileId = null;
  const haveDrive = !!(process.env.GOOGLE_SERVICE_EMAIL && process.env.GOOGLE_SERVICE_PRIVATE_KEY && process.env.GOOGLE_DRIVE_FOLDER_ID);
  if (haveDrive) {
    try {
      const { google } = await import('googleapis');
      const auth = new google.auth.JWT({
        email: process.env.GOOGLE_SERVICE_EMAIL,
        key: process.env.GOOGLE_SERVICE_PRIVATE_KEY.replace(/\n/g, '\n').replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/drive.file']
      });
      const drive = google.drive({ version: 'v3', auth });
      const resp = await drive.files.create({
        requestBody: {
          name: `payroll_${start}_to_${end}.csv`,
          parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
          mimeType: 'text/csv'
        },
        media: { mimeType: 'text/csv', body: Buffer.from(csv, 'utf8') }
      });
      driveFileId = resp.data.id || null;
    } catch (e) {
      console.error('Drive upload failed:', e.message);
    }
  }

  res.json({ ok:true, start, end, saved: fname, driveFileId });
});


// ---- Public submission endpoint (for GitHub Pages form) ----
// Accepts: { driver_token, log_date, truck_unit, miles, value, detention_minutes, notes, dup_action? }
// Uses driver defaults for rpm and hourly; ignores client-supplied rates for safety.
function driverIdFromToken(tok){
  let map = {};
  try { map = JSON.parse(process.env.DRIVER_TOKENS_JSON || '{}'); } catch {}
  for (const [driverId, t] of Object.entries(map)) {
    if (tok === t) return Number(driverId);
  }
  return null;
}

// find-or-create truck by unit
import db from './db.js';
function getOrCreateTruckId(unit){
  if (!unit || !unit.trim()) return null;
  const row = db.prepare('SELECT id FROM trucks WHERE unit = ?').get(unit.trim());
  if (row && row.id) return row.id;
  insertTruck.run(unit.trim());
  const row2 = db.prepare('SELECT id FROM trucks WHERE unit = ?').get(unit.trim());
  return row2 ? row2.id : null;
}

app.post('/api/public/submit', (req, res) => {
  const token = req.body.driver_token || req.headers['x-auth']; // allow header or body
  const driverId = driverIdFromToken(token);
  if (!driverId) return res.status(401).json({ error: 'invalid driver token' });

  const truck_unit = String(req.body.truck_unit || '').trim();
  const truckId = getOrCreateTruckId(truck_unit);
  if (!truckId) return res.status(400).json({ error: 'truck_unit required' });

  const log_date = req.body.log_date;
  if (!log_date) return res.status(400).json({ error: 'log_date required' });

  // pull driver defaults
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

  const existing = db.prepare('SELECT * FROM logs WHERE log_date = ? AND truck_id = ? AND driver_id = ? ORDER BY id DESC LIMIT 1')
                    .get(data.log_date, data.truck_id, data.driver_id);
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
  res.json({ ok: true, id: info.lastInsertRowid, action: 'created' });
});

// ---- health ----
app.get('/api/ping', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`Driver Daily Log running on :${PORT}`);
});
