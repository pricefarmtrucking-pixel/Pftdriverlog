// db.js
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Use persistent disk on Render if available
const DB_PATH = process.env.DB_PATH || '/data/pft_driverlog.sqlite';

// IMPORTANT: export the db instance
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// --- your schema / prepared statements ---
db.exec(`
CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY,
  name TEXT,
  rpm_default REAL,
  hourly_default REAL
);
CREATE TABLE IF NOT EXISTS trucks (
  id INTEGER PRIMARY KEY,
  unit TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY,
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

export const insertDriver = db.prepare('INSERT INTO drivers (name) VALUES (?)');
export const insertTruck  = db.prepare('INSERT OR IGNORE INTO trucks (unit) VALUES (?)');
export const listDrivers  = db.prepare('SELECT * FROM drivers ORDER BY id');
export const listTrucks   = db.prepare('SELECT * FROM trucks ORDER BY unit');
export const getDriver    = db.prepare('SELECT * FROM drivers WHERE id = ?');

export const addLog = db.prepare(`
INSERT INTO logs (log_date, driver_id, truck_id, miles, value, rpm, per_value,
  detention_minutes, detention_rate, notes, approved_at, approved_by, period_start, period_end)
VALUES (@log_date, @driver_id, @truck_id, @miles, @value, @rpm, @per_value,
  @detention_minutes, @detention_rate, @notes, NULL, NULL, @period_start, @period_end)
`);

export const updateLog = db.prepare(`
UPDATE logs SET
  log_date=@log_date, driver_id=@driver_id, truck_id=@truck_id, miles=@miles, value=@value,
  rpm=@rpm, per_value=@per_value, detention_minutes=@detention_minutes, detention_rate=@detention_rate, notes=@notes
WHERE id=@id
`);

export const deleteLog = db.prepare('DELETE FROM logs WHERE id=?');

export const listLogs = db.prepare(`
SELECT l.*, d.name as driver_name, t.unit as truck_unit
FROM logs l
LEFT JOIN drivers d ON d.id = l.driver_id
LEFT JOIN trucks t  ON t.id = l.truck_id
WHERE ( @from IS NULL OR l.log_date >= @from )
  AND ( @to   IS NULL OR l.log_date <= @to )
  AND ( @driver_id IS NULL OR l.driver_id=@driver_id )
  AND ( @truck_id  IS NULL OR l.truck_id=@truck_id )
ORDER BY l.log_date DESC, l.id DESC
`);

export const listLogsUnapproved = db.prepare(`
SELECT l.*, d.name as driver_name, t.unit as truck_unit
FROM logs l
LEFT JOIN drivers d ON d.id = l.driver_id
LEFT JOIN trucks t  ON t.id = l.truck_id
WHERE l.approved_at IS NULL
ORDER BY l.log_date ASC, l.id ASC
`);

export const approveLog = db.prepare(`
UPDATE logs SET approved_at = datetime('now'), approved_by = @by WHERE id = @id
`);

export const getPayrollTotals = db.prepare(`
SELECT d.name as driver_name,
  SUM(l.miles * l.rpm) + SUM(l.value * l.per_value) + SUM(l.detention_minutes/60.0 * l.detention_rate) AS gross
FROM logs l
LEFT JOIN drivers d ON d.id = l.driver_id
WHERE ( @from IS NULL OR l.log_date >= @from )
  AND ( @to   IS NULL OR l.log_date <= @to )
  AND ( @driver_id IS NULL OR l.driver_id=@driver_id )
  AND ( @truck_id  IS NULL OR l.truck_id=@truck_id )
GROUP BY l.driver_id, d.name
ORDER BY d.name
`);

export const listLogsByPeriod = db.prepare(`
SELECT l.*, d.name as driver_name, t.unit as truck_unit
FROM logs l
LEFT JOIN drivers d ON d.id = l.driver_id
LEFT JOIN trucks t  ON t.id = l.truck_id
WHERE l.period_start = @start AND l.period_end = @end
ORDER BY l.log_date ASC, l.id ASC
`);

export const closePeriodMarkApproved = db.prepare(`
UPDATE logs SET approved_at = COALESCE(approved_at, datetime('now')), approved_by = @by
WHERE period_start = @start AND period_end = @end
`);

export function setLogPeriod(ids, start, end) {
  const update = db.prepare(`UPDATE logs SET period_start=?, period_end=? WHERE id=?`);
  const tx = db.transaction((rows) => {
    rows.forEach((id) => update.run(start, end, id));
  });
  tx(ids);
}

export default db; // optional (kept for backward compatibility)
