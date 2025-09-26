// db.js
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Store DB file in project-local /data
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE  = path.join(DATA_DIR, 'driverlog.sqlite3');

export function initDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS drivers (
      id             INTEGER PRIMARY KEY,
      name           TEXT NOT NULL,
      rpm_default    REAL DEFAULT 0.46,
      hourly_default REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS trucks (
      id    INTEGER PRIMARY KEY,
      unit  TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS logs (
      id                INTEGER PRIMARY KEY,
      log_date          TEXT NOT NULL,
      driver_id         INTEGER NOT NULL,
      truck_id          INTEGER NOT NULL,
      miles             REAL DEFAULT 0,
      value             REAL DEFAULT 0,
      rpm               REAL DEFAULT 0.46,
      per_value         REAL DEFAULT 25,
      detention_minutes INTEGER DEFAULT 0,
      detention_rate    REAL DEFAULT 0,
      notes             TEXT DEFAULT '',
      approved_at       TEXT DEFAULT NULL,
      paid_at           TEXT DEFAULT NULL,
      created_at        TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(driver_id) REFERENCES drivers(id),
      FOREIGN KEY(truck_id)  REFERENCES trucks(id)
    );
  `);

  // Seed driver IDs if present in DRIVER_TOKENS_JSON
  try {
    const map = JSON.parse(process.env.DRIVER_TOKENS_JSON || '{}');
    const getDrv = db.prepare(`SELECT id FROM drivers WHERE id=?`);
    const insDrv = db.prepare(`INSERT INTO drivers (id, name) VALUES (?, ?)`);
    for (const key of Object.keys(map)) {
      const id = Number(key);
      if (!getDrv.get(id)) insDrv.run(id, `Driver #${id}`);
    }
  } catch {}

  db.close();
}

function open() {
  const db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  return db;
}

/* Ensure/lookup truck id */
export function getOrCreateTruckId(unit) {
  const u = String(unit || '').trim();
  if (!u) return null;
  const db = open();
  try {
    const get = db.prepare(`SELECT id FROM trucks WHERE unit=?`);
    const row = get.get(u);
    if (row?.id) return row.id;

    db.prepare(`INSERT INTO trucks (unit) VALUES (?)`).run(u);
    const row2 = get.get(u);
    return row2?.id ?? null;
  } finally {
    db.close();
  }
}

/* Insert log */
export function insertLog(payload) {
  const db = open();
  try {
    const { log_date, driver_id, truck_id, miles=0, value=0, detention_minutes=0, notes='' } = payload || {};
    if (!log_date) throw new Error('log_date required');
    if (!driver_id) throw new Error('driver_id required');
    if (!truck_id) throw new Error('truck_id required');

    const drv = db.prepare(`SELECT rpm_default, hourly_default FROM drivers WHERE id=?`).get(driver_id);
    const rpm = (drv?.rpm_default ?? 0.46);
    const detention_rate = (drv?.hourly_default ?? 0);
    const per_value = 25;

    db.prepare(`
      INSERT INTO logs
        (log_date, driver_id, truck_id, miles, value, rpm, per_value, detention_minutes, detention_rate, notes)
      VALUES
        (@log_date, @driver_id, @truck_id, @miles, @value, @rpm, @per_value, @detention_minutes, @detention_rate, @notes)
    `).run({
      log_date,
      driver_id,
      truck_id,
      miles: Number(miles),
      value: Number(value),
      rpm,
      per_value,
      detention_minutes: Number(detention_minutes),
      detention_rate,
      notes
    });
  } finally {
    db.close();
  }
}

/* List logs */
export function getLogs(from, to) {
  const db = open();
  try {
    const where = [];
    const params = {};
    if (from) { where.push(`log_date >= @from`); params.from = from; }
    if (to)   { where.push(`log_date <= @to`);   params.to   = to; }

    const sql = `
      SELECT l.*, d.name AS driver_name, t.unit AS truck_unit
      FROM logs l
      JOIN drivers d ON d.id = l.driver_id
      JOIN trucks  t ON t.id = l.truck_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY l.log_date DESC, l.id DESC
    `;
    return db.prepare(sql).all(params);
  } finally {
    db.close();
  }
}

/* Single log */
export function getLogById(id) {
  const db = open();
  try {
    const sql = `
      SELECT l.*, d.name AS driver_name, t.unit AS truck_unit
      FROM logs l
      JOIN drivers d ON d.id = l.driver_id
      JOIN trucks  t ON t.id = l.truck_id
      WHERE l.id = ?
    `;
    return db.prepare(sql).get(Number(id));
  } finally {
    db.close();
  }
}

/* Update log */
export function updateLog(id, patch) {
  const db = open();
  try {
    const cur = db.prepare(`SELECT * FROM logs WHERE id=?`).get(Number(id));
    if (!cur) throw new Error('log not found');

    const merged = { ...cur, ...patch, id: Number(id) };

    db.prepare(`
      UPDATE logs SET
        log_date=@log_date,
        driver_id=@driver_id,
        truck_id=@truck_id,
        miles=@miles,
        value=@value,
        detention_minutes=@detention_minutes,
        rpm=@rpm,
        per_value=@per_value,
        detention_rate=@detention_rate,
        notes=@notes
      WHERE id=@id
    `).run(merged);
  } finally {
    db.close();
  }
}

/* Mark logs paid */
export function markPaid(ids) {
  const db = open();
  try {
    const stmt = db.prepare(`UPDATE logs SET paid_at=datetime('now') WHERE id=?`);
    const tx = db.transaction((rows) => rows.forEach(id => stmt.run(Number(id))));
    tx(ids || []);
  } finally {
    db.close();
  }
}

/* Payroll summary */
export function getPayroll(from, to) {
  const db = open();
  try {
    const where = [];
    const params = {};
    if (from) { where.push(`log_date >= @from`); params.from = from; }
    if (to)   { where.push(`log_date <= @to`);   params.to   = to; }

    const sql = `
      SELECT d.id AS driver_id, d.name AS driver_name,
             SUM(l.miles) AS total_miles,
             SUM(l.value) AS total_value,
             SUM(l.detention_minutes) AS total_detention_minutes,
             SUM(l.miles*l.rpm + l.value*l.per_value + (l.detention_minutes/60.0)*l.detention_rate) AS gross_pay
      FROM logs l
      JOIN drivers d ON d.id = l.driver_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      GROUP BY d.id
      ORDER BY d.name
    `;
    return db.prepare(sql).all(params);
  } finally {
    db.close();
  }
}
