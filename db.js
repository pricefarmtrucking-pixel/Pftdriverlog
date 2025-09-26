import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dataDir = process.env.DATA_DIR || '/var/data';
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, 'driverlogs.sqlite');
const db = new Database(dbPath);

export function initDb() {
  db.prepare(`CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_token TEXT,
    log_date TEXT,
    truck TEXT,
    miles REAL,
    value REAL,
    detention REAL DEFAULT 0,
    start_time TEXT,
    end_time TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    paid INTEGER DEFAULT 0
  )`).run();
}

export function insertLog({ driver_token, log_date, truck, miles, value, detention, start_time, end_time }) {
  const stmt = db.prepare(
    'INSERT INTO logs (driver_token, log_date, truck, miles, value, detention, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  stmt.run(driver_token, log_date, truck, miles, value, detention, start_time, end_time);
}

export function getLogs(from, to) {
  let sql = 'SELECT * FROM logs WHERE 1=1';
  const params = [];
  if (from) { sql += ' AND log_date >= ?'; params.push(from); }
  if (to) { sql += ' AND log_date <= ?'; params.push(to); }
  sql += ' ORDER BY log_date DESC';
  return db.prepare(sql).all(...params);
}

export function getLogById(id) {
  return db.prepare('SELECT * FROM logs WHERE id = ?').get(id);
}

export function updateLog(id, { log_date, truck, miles, value, detention, start_time, end_time }) {
  db.prepare(`UPDATE logs SET
    log_date=?, truck=?, miles=?, value=?, detention=?, start_time=?, end_time=?
    WHERE id=?
  `).run(log_date, truck, miles, value, detention, start_time, end_time, id);
}

export function markPaid(ids) {
  const stmt = db.prepare('UPDATE logs SET paid=1 WHERE id=?');
  ids.forEach(id => stmt.run(id));
}

export function getPayroll(from, to) {
  let sql = `SELECT driver_token,
    SUM(miles) as total_miles,
    SUM(value) as total_value,
    SUM(detention) as total_detention,
    (SUM(miles) * 0.46 + SUM(value) * 25 + SUM(detention) * 25/60) as total_pay
    FROM logs WHERE 1=1`;
  const params = [];
  if (from) { sql += ' AND log_date >= ?'; params.push(from); }
  if (to) { sql += ' AND log_date <= ?'; params.push(to); }
  sql += ' GROUP BY driver_token';
  return db.prepare(sql).all(...params);
}
