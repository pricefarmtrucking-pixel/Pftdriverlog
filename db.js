// db.js
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// ---------- Open DB (Render persistent disk lives at /data) ----------
const DATA_DIR = process.env.DATA_DIR || '/data';
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'driverlog.sqlite');
const db = new Database(DB_FILE);

// ---------- Schema ----------
db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  rpm_default REAL,
  hourly_default REAL
);

CREATE TABLE IF NOT EXISTS trucks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_date TEXT NOT NULL,             -- YYYY-MM-DD
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  truck_id INTEGER NOT NULL REFERENCES trucks(id),
  miles REAL DEFAULT 0,
  value REAL DEFAULT 0,               -- "value hours"
  rpm REAL DEFAULT 0.46,
  per_value REAL DEFAULT 25,
  detention_minutes INTEGER DEFAULT 0,
  detention_rate REAL DEFAULT 0,
  notes TEXT,
  approved_at TEXT,
  approved_by TEXT,
  period_start TEXT,
  period_end TEXT
);

CREATE INDEX IF NOT EXISTS idx_logs_date ON logs(log_date);
CREATE INDEX IF NOT EXISTS idx_logs_driver ON logs(driver_id);
CREATE INDEX IF NOT EXISTS idx_logs_truck ON logs(truck_id);
CREATE INDEX IF NOT EXISTS idx_logs_period ON logs(period_start, period_end);
`);

// ---------- Prepared statements ----------
export const insertDriver = db.prepare(`INSERT OR IGNORE INTO drivers(name,rpm_default,hourly_default) VALUES(?, NULL, NULL)`);
export const insertTruck  = db.prepare(`INSERT OR IGNORE INTO trucks(unit) VALUES(?)`);

export const setDriverDefaults = db.prepare(`
  UPDATE drivers
     SET rpm_default = @rpm_default,
         hourly_default = @hourly_default
   WHERE id = @id
`);

export const getDriver = db.prepare(`SELECT * FROM drivers WHERE id = ?`);
export const listDrivers = db.prepare(`SELECT id, name, rpm_default, hourly_default FROM drivers ORDER BY name COLLATE NOCASE`);
export const listTrucks  = db.prepare(`SELECT id, unit FROM trucks ORDER BY unit COLLATE NOCASE`);

export const addLog = db.prepare(`
  INSERT INTO logs (log_date, driver_id, truck_id, miles, value, rpm, per_value, detention_minutes, detention_rate, notes, approved_at, approved_by, period_start, period_end)
  VALUES (@log_date, @driver_id, @truck_id, @miles, @value, @rpm, @per_value, @detention_minutes, @detention_rate, @notes, NULL, NULL, @period_start, @period_end)
`);

export const updateLog = db.prepare(`
  UPDATE logs
     SET log_date = @log_date,
         driver_id = @driver_id,
         truck_id = @truck_id,
         miles = @miles,
         value = @value,
         rpm = @rpm,
         per_value = @per_value,
         detention_minutes = @detention_minutes,
         detention_rate = @detention_rate,
         notes = @notes
   WHERE id = @id
`);

export const deleteLog = db.prepare(`DELETE FROM logs WHERE id = ?`);

function whereClause(params) {
  const parts = [];
  const bind = {};
  if (params.from) { parts.push(`log_date >= @from`); bind.from = params.from; }
  if (params.to)   { parts.push(`log_date <= @to`); bind.to = params.to; }
  if (params.driver_id) { parts.push(`driver_id = @driver_id`); bind.driver_id = params.driver_id; }
  if (params.truck_id)  { parts.push(`truck_id = @truck_id`); bind.truck_id = params.truck_id; }
  const sql = parts.length ? ('WHERE ' + parts.join(' AND ')) : '';
  return { sql, bind };
}

export const listLogs = {
  all(params = {}) {
    const { sql, bind } = whereClause(params);
    const q = `
      SELECT
        l.id, l.log_date,
        l.driver_id, d.name AS driver_name,
        l.truck_id,  t.unit AS truck_unit,
        l.miles, l.value, l.rpm, l.per_value,
        l.detention_minutes, l.detention_rate,
        l.notes, l.approved_at, l.approved_by,
        l.period_start, l.period_end
      FROM logs l
      JOIN drivers d ON d.id = l.driver_id
      JOIN trucks  t ON t.id = l.truck_id
      ${sql}
      ORDER BY l.log_date DESC, l.id DESC
    `;
    return db.prepare(q).all(bind);
  }
};

export const listLogsUnapproved = db.prepare(`
  SELECT l.id, l.log_date, d.name AS driver_name, t.unit AS truck_unit,
         l.miles, l.value, l.rpm, l.per_value, l.detention_minutes, l.detention_rate, l.notes
    FROM logs l
    JOIN drivers d ON d.id = l.driver_id
    JOIN trucks  t ON t.id = l.truck_id
   WHERE l.approved_at IS NULL
   ORDER BY l.log_date DESC, l.id DESC
`);

export const approveLog = db.prepare(`
  UPDATE logs
     SET approved_at = datetime('now'),
         approved_by = @by
   WHERE id = @id
`);

export const setLogPeriod = (ids, start, end) => {
  const tx = db.transaction((arr) => {
    const stmt = db.prepare(`UPDATE logs SET period_start = ?, period_end = ? WHERE id = ?`);
    for (const i of arr) stmt.run(start, end, i);
  });
  tx(ids);
};

export const closePeriodMarkApproved = db.prepare(`
  UPDATE logs
     SET approved_at = COALESCE(approved_at, datetime('now')),
         approved_by = @by
   WHERE period_start = @start AND period_end = @end
`);

export const listLogsByPeriod = db.prepare(`
  SELECT
    l.id, l.log_date,
    d.name AS driver_name, t.unit AS truck_unit,
    l.miles, l.value, l.rpm, l.per_value, l.detention_minutes, l.detention_rate,
    l.notes, l.approved_at, l.approved_by, l.period_start, l.period_end
  FROM logs l
  JOIN drivers d ON d.id = l.driver_id
  JOIN trucks  t ON t.id = l.truck_id
  WHERE l.period_start = @start AND l.period_end = @end
  ORDER BY l.log_date ASC, l.id ASC
`);

export const getPayrollTotals = {
  all(params = {}) {
    const { sql, bind } = whereClause(params);
    const q = `
      SELECT
        d.id AS driver_id,
        d.name AS driver_name,
        ROUND(SUM(l.miles), 2) AS sum_miles,
        ROUND(SUM(l.miles * l.rpm), 2) AS pay_miles,
        ROUND(SUM(l.value * l.per_value), 2) AS pay_value,
        ROUND(SUM((l.detention_minutes/60.0) * l.detention_rate), 2) AS pay_detention,
        ROUND(SUM(l.miles * l.rpm + l.value * l.per_value + (l.detention_minutes/60.0) * l.detention_rate), 2) AS pay_total
      FROM logs l
      JOIN drivers d ON d.id = l.driver_id
      ${sql ? sql.replace('WHERE', 'WHERE') : ''}
      GROUP BY d.id, d.name
      ORDER BY d.name COLLATE NOCASE
    `;
    return db.prepare(q).all(bind);
  }
};

export default db;
