
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const DB_FILE = process.env.DB_FILE || '/tmp/driverlog.db';
const DB_DIR = path.dirname(DB_FILE);
try { fs.mkdirSync(DB_DIR, { recursive: true }); } catch {}

let db;

/** Initialize DB and schema */
export function initDb() {
  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');

  db.exec(`
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    log_date TEXT NOT NULL,
    driver_name TEXT,
    driver_email TEXT,
    truck_unit TEXT,
    miles REAL DEFAULT 0,
    stop_value REAL DEFAULT 0, -- "Value (hrs)" monetized or raw hours; we keep numeric
    detention_minutes INTEGER DEFAULT 0,
    detention_rate REAL DEFAULT 0,
    start_time TEXT,
    end_time TEXT,
    total_minutes INTEGER DEFAULT 0,
    notes TEXT,
    paid INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_logs_date ON logs (log_date);
  CREATE INDEX IF NOT EXISTS idx_logs_paid ON logs (paid);
  `);
}

/** Insert a new log. Returns ID */
export function insertLog(data) {
  if (!db) initDb();
  const stmt = db.prepare(`
    INSERT INTO logs
    (log_date, driver_name, driver_email, truck_unit, miles, stop_value, detention_minutes, detention_rate, start_time, end_time, total_minutes, notes, paid, created_at, updated_at)
    VALUES
    (@log_date, @driver_name, @driver_email, @truck_unit, @miles, @stop_value, @detention_minutes, @detention_rate, @start_time, @end_time, @total_minutes, @notes, 0, datetime('now'), datetime('now'))
  `);
  const info = stmt.run({
    log_date: data.log_date,
    driver_name: data.driver_name,
    driver_email: data.driver_email,
    truck_unit: data.truck_unit,
    miles: Number(data.miles || 0),
    stop_value: Number(data.stop_value || 0),
    detention_minutes: Number(data.detention_minutes || 0),
    detention_rate: Number(data.detention_rate || 0),
    start_time: data.start_time || null,
    end_time: data.end_time || null,
    total_minutes: Number(data.total_minutes || 0),
    notes: data.notes || null
  });
  return info.lastInsertRowid;
}

/** Get logs with optional date bounds */
export function getLogs(from = null, to = null) {
  if (!db) initDb();
  let sql = `SELECT *, (detention_minutes/60.0)*detention_rate AS detention_value FROM logs`;
  const args = [];
  if (from && to) { sql += ` WHERE log_date BETWEEN ? AND ?`; args.push(from, to); }
  else if (from) { sql += ` WHERE log_date >= ?`; args.push(from); }
  else if (to)   { sql += ` WHERE log_date <= ?`; args.push(to); }
  sql += ` ORDER BY log_date DESC, id DESC`;
  const rows = db.prepare(sql).all(...args);
  return rows;
}

export function getLogById(id) {
  if (!db) initDb();
  const row = db.prepare(`SELECT *, (detention_minutes/60.0)*detention_rate AS detention_value FROM logs WHERE id=?`).get(id);
  return row || null;
}

export function updateLog(id, fields) {
  if (!db) initDb();
  // Build dynamic update
  const allowed = ['log_date','driver_name','driver_email','truck_unit','miles','stop_value','detention_minutes','detention_rate','start_time','end_time','total_minutes','notes','paid'];
  const sets = [];
  const args = [];
  for (const k of allowed) {
    if (k in fields) {
      sets.push(`${k} = ?`);
      args.push(fields[k]);
    }
  }
  if (!sets.length) return;
  sets.push(`updated_at = datetime('now')`);
  const sql = `UPDATE logs SET ${sets.join(', ')} WHERE id = ?`;
  args.push(id);
  db.prepare(sql).run(...args);
}

export function markPaid(ids) {
  if (!db) initDb();
  const stmt = db.prepare(`UPDATE logs SET paid=1, updated_at=datetime('now') WHERE id=?`);
  const t = db.transaction((arr)=>{ arr.forEach(id=>stmt.run(id)); });
  t(ids);
}

export function getPayroll(from = null, to = null) {
  if (!db) initDb();
  let sql = `SELECT 
    log_date,
    COUNT(*) as count,
    SUM(miles) as miles,
    SUM(stop_value) as stop_value,
    SUM(detention_minutes) as detention_minutes,
    SUM((detention_minutes/60.0)*detention_rate) AS detention_value,
    SUM(total_minutes) as total_minutes
  FROM logs`;
  const args = [];
  if (from && to) { sql += ` WHERE log_date BETWEEN ? AND ?`; args.push(from, to); }
  else if (from) { sql += ` WHERE log_date >= ?`; args.push(from); }
  else if (to)   { sql += ` WHERE log_date <= ?`; args.push(to); }
  sql += ` GROUP BY log_date ORDER BY log_date DESC`;
  return db.prepare(sql).all(...args);
}
