import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const DATA_DIR = process.env.DB_DIR || '/var/data';
const DB_FILE  = path.join(DATA_DIR, 'driverlog.db');

let db;

// init DB and schema
export function initDb() {
  // Ensure data dir exists (Render disk should be mounted to /var/data)
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

  db = new Database(DB_FILE);

  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_token      TEXT NOT NULL,
      log_date          TEXT NOT NULL,       -- YYYY-MM-DD
      truck             TEXT,                -- raw unit text
      miles             REAL DEFAULT 0,
      value             REAL DEFAULT 0,
      detention_minutes INTEGER DEFAULT 0,
      notes             TEXT,
      created_at        TEXT DEFAULT (datetime('now'))
    );
  `);
}

// insert a row
export function insertLog(log) {
  const stmt = db.prepare(`
    INSERT INTO logs (driver_token, log_date, truck, miles, value, detention_minutes, notes)
    VALUES (@driver_token, @log_date, @truck, @miles, @value, @detention_minutes, @notes)
  `);
  stmt.run({
    driver_token: log.driver_token,
    log_date: log.log_date,
    truck: log.truck ?? null,
    miles: Number(log.miles || 0),
    value: Number(log.value || 0),
    detention_minutes: Number(log.detention_minutes || 0),
    notes: log.notes || ''
  });
}

// list all logs (simple order newest first)
export function getLogs() {
  return db
    .prepare(`SELECT id, driver_token, log_date, truck, miles, value, detention_minutes, notes, created_at
              FROM logs ORDER BY created_at DESC`)
    .all();
}

// simple payroll aggregation by log_date & driver_token
export function getPayroll() {
  return db
    .prepare(`
      SELECT 
        log_date,
        driver_token,
        SUM(miles)  AS total_miles,
        SUM(value)  AS total_value,
        SUM(COALESCE(detention_minutes,0)) AS total_detention_minutes,
        COUNT(*)    AS entries
      FROM logs
      GROUP BY log_date, driver_token
      ORDER BY log_date DESC, driver_token
    `)
    .all();
}