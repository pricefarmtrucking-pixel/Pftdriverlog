import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// Use Render disk if available, else fallback
const dataDir = process.env.DATA_DIR || '/var/data';
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, 'driverlogs.sqlite');
const db = new Database(dbPath);

// Init schema
export function initDb() {
  db.prepare(`CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_token TEXT,
    log_date TEXT,
    truck TEXT,
    miles REAL,
    value REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

export function insertLog({ driver_token, log_date, truck, miles, value }) {
  const stmt = db.prepare(
    'INSERT INTO logs (driver_token, log_date, truck, miles, value) VALUES (?, ?, ?, ?, ?)'
  );
  stmt.run(driver_token, log_date, truck, miles, value);
}

export function getLogs() {
  return db.prepare('SELECT * FROM logs ORDER BY created_at DESC').all();
}

export function getPayroll() {
  return db.prepare(`
    SELECT driver_token, 
           SUM(miles) as total_miles, 
           SUM(value) as total_value,
           (SUM(miles) * 0.46 + SUM(value) * 25) as total_pay
    FROM logs
    GROUP BY driver_token
  `).all();
}
