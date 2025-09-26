import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure /data dir exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new Database(path.join(dataDir, 'driverlog.db'));

// Init schema if not exists
db.exec(`
CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  rpm_default REAL DEFAULT 0.46,
  hourly_default REAL DEFAULT 25
);
CREATE TABLE IF NOT EXISTS trucks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_date TEXT,
  driver_id INTEGER,
  truck_id INTEGER,
  miles REAL,
  value REAL,
  rpm REAL,
  per_value REAL,
  detention_minutes INTEGER,
  detention_rate REAL,
  notes TEXT,
  approved_at TEXT,
  approved_by TEXT,
  period_start TEXT,
  period_end TEXT
);
`);

// Prepared statements
export const insertDriver = db.prepare('INSERT INTO drivers (name) VALUES (?)');
export const insertTruck = db.prepare('INSERT INTO trucks (unit) VALUES (?)');
export const listDrivers = db.prepare('SELECT * FROM drivers');
export const listTrucks = db.prepare('SELECT * FROM trucks');
export const getDriver = db.prepare('SELECT * FROM drivers WHERE id=?');
export const addLog = db.prepare(`INSERT INTO logs (log_date, driver_id, truck_id, miles, value, rpm, per_value, detention_minutes, detention_rate, notes, period_start, period_end)
VALUES (@log_date,@driver_id,@truck_id,@miles,@value,@rpm,@per_value,@detention_minutes,@detention_rate,@notes,@period_start,@period_end)`);
export const listLogs = db.prepare('SELECT * FROM logs');
export const deleteLog = db.prepare('DELETE FROM logs WHERE id=?');
export const updateLog = db.prepare(`UPDATE logs SET
  log_date=@log_date, driver_id=@driver_id, truck_id=@truck_id, miles=@miles, value=@value, rpm=@rpm, per_value=@per_value, detention_minutes=@detention_minutes, detention_rate=@detention_rate, notes=@notes
  WHERE id=@id`);
export const getPayrollTotals = db.prepare('SELECT driver_id, SUM(miles) as miles, SUM(value) as value FROM logs GROUP BY driver_id');
export const listLogsUnapproved = db.prepare('SELECT * FROM logs WHERE approved_at IS NULL');
export const approveLog = db.prepare('UPDATE logs SET approved_at=datetime("now"), approved_by=@by WHERE id=@id');
export const listLogsByPeriod = db.prepare('SELECT * FROM logs WHERE period_start=@start AND period_end=@end');
export const closePeriodMarkApproved = db.prepare('UPDATE logs SET approved_at=datetime("now"), approved_by=@by WHERE period_start=@start AND period_end=@end');
export const setLogPeriod = (ids, start, end) => {
  const stmt = db.prepare('UPDATE logs SET period_start=?, period_end=? WHERE id=?');
  for (const id of ids) stmt.run(start, end, id);
};

export default db;
