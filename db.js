import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || '/data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'driverlog.db');
export const db = new Database(DB_PATH);

// Pragmas for reliability
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Schema ---
db.exec(`
CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rpm_default REAL DEFAULT 0.46,
  hourly_default REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS trucks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_date TEXT NOT NULL,                 -- YYYY-MM-DD
  driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  truck_id INTEGER NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  miles REAL DEFAULT 0,
  value REAL DEFAULT 0,                   -- detention/value hours (not $)
  rpm REAL DEFAULT 0.46,
  per_value REAL DEFAULT 25,              -- $ per "value" hour unit
  detention_minutes INTEGER DEFAULT 0,
  detention_rate REAL DEFAULT 0,          -- $/hour for detention
  notes TEXT DEFAULT '',
  approved_at TEXT,                       -- ISO timestamp
  approved_by TEXT,
  period_start TEXT,                      -- YYYY-MM-DD
  period_end TEXT                         -- YYYY-MM-DD
);
`);

// --- Prepared statements (exports) ---

// Drivers
export const insertDriver = db.prepare(`INSERT INTO drivers (name, rpm_default, hourly_default) VALUES (?, COALESCE(?, 0.46), COALESCE(?, 0))`);
export const listDrivers  = db.prepare(`SELECT id, name, rpm_default, hourly_default FROM drivers ORDER BY name`);
export const getDriver    = db.prepare(`SELECT * FROM drivers WHERE id = ?`);
export const setDriverDefaults = db.prepare(`UPDATE drivers SET rpm_default = COALESCE(@rpm_default, rpm_default), hourly_default = COALESCE(@hourly_default, hourly_default) WHERE id = @id`);

// Trucks
export const insertTruck = db.prepare(`INSERT OR IGNORE INTO trucks (unit) VALUES (?)`);
export const listTrucks  = db.prepare(`SELECT id, unit FROM trucks ORDER BY unit`);
export const getTruckByUnit = db.prepare(`SELECT id FROM trucks WHERE unit = ?`);

// Logs: helpers to build filters
function filterClause(params = {}){
  const parts = [];
  if (params.from) parts.push(`log_date >= @from`);
  if (params.to) parts.push(`log_date <= @to`);
  if (params.driver_id) parts.push(`driver_id = @driver_id`);
  if (params.truck_id) parts.push(`truck_id = @truck_id`);
  return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
}

export function listLogsAll(params = {}){
  const clause = filterClause(params);
  const sql = `
    SELECT l.*,
           d.name AS driver_name,
           t.unit AS truck_unit
      FROM logs l
      JOIN drivers d ON d.id = l.driver_id
      JOIN trucks t  ON t.id = l.truck_id
      ${clause}
     ORDER BY log_date DESC, l.id DESC`;
  return db.prepare(sql).all(params);
}

export const addLog = db.prepare(`
  INSERT INTO logs (
    log_date, driver_id, truck_id,
    miles, value, rpm, per_value,
    detention_minutes, detention_rate, notes,
    approved_at, approved_by, period_start, period_end
  ) VALUES (
    @log_date, @driver_id, @truck_id,
    @miles, @value, @rpm, @per_value,
    @detention_minutes, @detention_rate, @notes,
    NULL, NULL, @period_start, @period_end
  )`);

export const updateLog = db.prepare(`
  UPDATE logs SET
    log_date = @log_date,
    driver_id = @driver_id,
    truck_id = @truck_id,
    miles = @miles,
    value = @value,
    rpm = @rpm,
    per_value = @per_value,
    detention_minutes = @detention_minutes,
    detention_rate = @detention_rate,
    notes = @notes
  WHERE id = @id`);

export const deleteLog = db.prepare(`DELETE FROM logs WHERE id = ?`);

// Payroll aggregation: sum pay per driver per period/range
export function getPayrollTotals(params = {}){
  const clause = filterClause(params);
  const sql = `
    SELECT d.id AS driver_id, d.name AS driver_name,
           SUM(l.miles) AS miles,
           AVG(l.rpm) AS rpm,               -- informative
           SUM(l.value) AS value_hours,
           AVG(l.per_value) AS per_value,   -- informative
           SUM(l.detention_minutes) AS detention_minutes,
           AVG(l.detention_rate) AS detention_rate, -- informative
           -- computed $:
           SUM(l.miles * l.rpm + (l.value * l.per_value) + (l.detention_minutes/60.0) * l.detention_rate) AS gross_pay
      FROM logs l
      JOIN drivers d ON d.id = l.driver_id
      ${clause}
     GROUP BY d.id, d.name
     ORDER BY d.name`;
  return db.prepare(sql).all(params);
}

// Approvals
export const listLogsUnapproved = db.prepare(`
  SELECT l.*, d.name AS driver_name, t.unit AS truck_unit
    FROM logs l
    JOIN drivers d ON d.id = l.driver_id
    JOIN trucks t  ON t.id = l.truck_id
   WHERE l.approved_at IS NULL
   ORDER BY l.log_date DESC, l.id DESC`);

export const approveLog = db.prepare(`
  UPDATE logs SET approved_at = datetime('now'), approved_by = @by WHERE id = @id`);

// Period operations
export const setLogPeriodStmt = db.prepare(`
  UPDATE logs SET period_start = @start, period_end = @end WHERE id = @id`);

export function setLogPeriod(ids, start, end){
  const tx = db.transaction((idsInner) => {
    for (const id of idsInner) setLogPeriodStmt.run({ id, start, end });
  });
  tx(ids);
}

export const listLogsByPeriod = db.prepare(`
  SELECT l.*, d.name AS driver_name, t.unit AS truck_unit
    FROM logs l
    JOIN drivers d ON d.id = l.driver_id
    JOIN trucks t  ON t.id = l.truck_id
   WHERE l.period_start = @start AND l.period_end = @end
   ORDER BY l.log_date, l.id`);

export const closePeriodMarkApproved = db.prepare(`
  UPDATE logs
     SET approved_at = datetime('now'), approved_by = @by
   WHERE period_start = @start AND period_end = @end
`);

export default db;
