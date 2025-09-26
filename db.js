import Database from 'better-sqlite3';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH || './driverlog.sqlite';

// Ensure dir exists
const dir = DB_PATH.includes('/') ? DB_PATH.split('/').slice(0, -1).join('/') : '.';
if (dir && dir !== '.' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Schema (idempotent)
db.exec(`
CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  rpm_default REAL,
  hourly_default REAL
);

CREATE TABLE IF NOT EXISTS trucks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_date TEXT NOT NULL,
  driver_id INTEGER NOT NULL,
  truck_id INTEGER NOT NULL,
  miles REAL DEFAULT 0,
  value REAL DEFAULT 0,
  rpm REAL DEFAULT 0.46,
  per_value REAL DEFAULT 25,
  detention_minutes INTEGER DEFAULT 0,
  detention_rate REAL DEFAULT 0,
  notes TEXT,
  approved_at TEXT,
  approved_by TEXT,
  period_start TEXT,
  period_end TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(driver_id) REFERENCES drivers(id),
  FOREIGN KEY(truck_id) REFERENCES trucks(id)
);

CREATE VIEW IF NOT EXISTS v_logs AS
  SELECT l.*, d.name AS driver_name, t.unit AS truck_unit
  FROM logs l
  JOIN drivers d ON d.id = l.driver_id
  JOIN trucks t ON t.id = l.truck_id;
`);

// Prepared statements
export const insertDriver = db.prepare(`INSERT OR IGNORE INTO drivers(name, rpm_default, hourly_default) VALUES(?, NULL, NULL)`);
export const insertTruck  = db.prepare(`INSERT OR IGNORE INTO trucks(unit)  VALUES(?)`);

export const listDrivers = db.prepare(`SELECT * FROM drivers ORDER BY name`);
export const listTrucks  = db.prepare(`SELECT * FROM trucks ORDER BY unit`);
export const getDriver   = db.prepare(`SELECT * FROM drivers WHERE id=?`);

export const setDriverDefaults = db.prepare(`
  UPDATE drivers SET rpm_default=@rpm_default, hourly_default=@hourly_default WHERE id=@id
`);

export const addLog = db.prepare(`
  INSERT INTO logs (
    log_date, driver_id, truck_id, miles, value, rpm, per_value,
    detention_minutes, detention_rate, notes, period_start, period_end
  ) VALUES (
    @log_date, @driver_id, @truck_id, @miles, @value, @rpm, @per_value,
    @detention_minutes, @detention_rate, @notes, @period_start, @period_end
  )
`);

export const listLogs = db.prepare(`
  SELECT * FROM v_logs
  WHERE (@from IS NULL OR log_date >= @from)
    AND (@to   IS NULL OR log_date <= @to)
    AND (@driver_id IS NULL OR driver_id = @driver_id)
    AND (@truck_id  IS NULL OR truck_id  = @truck_id)
  ORDER BY log_date DESC, id DESC
`);

export const deleteLog = db.prepare(`DELETE FROM logs WHERE id = ?`);

export const updateLog = db.prepare(`
  UPDATE logs SET
    log_date=@log_date, driver_id=@driver_id, truck_id=@truck_id,
    miles=@miles, value=@value, rpm=@rpm, per_value=@per_value,
    detention_minutes=@detention_minutes, detention_rate=@detention_rate,
    notes=@notes
  WHERE id=@id
`);

export const getPayrollTotals = db.prepare(`
  SELECT
    driver_id,
    driver_name,
    SUM(miles) AS total_miles,
    SUM(value) AS total_value,
    ROUND(SUM(miles * rpm + value * per_value + (detention_minutes/60.0)*detention_rate), 2) AS total_pay
  FROM v_logs
  WHERE (@from IS NULL OR log_date >= @from)
    AND (@to   IS NULL OR log_date <= @to)
    AND (@driver_id IS NULL OR driver_id = @driver_id)
    AND (@truck_id  IS NULL OR truck_id  = @truck_id)
  GROUP BY driver_id, driver_name
  ORDER BY driver_name
`);

export const listLogsUnapproved = db.prepare(`
  SELECT * FROM v_logs
  WHERE approved_at IS NULL
  ORDER BY log_date DESC, id DESC
`);

export const approveLog = db.prepare(`
  UPDATE logs SET approved_at=datetime('now'), approved_by=@by WHERE id=@id
`);

export const listLogsByPeriod = db.prepare(`
  SELECT * FROM v_logs
  WHERE period_start=@start AND period_end=@end
  ORDER BY log_date ASC, id ASC
`);

export const closePeriodMarkApproved = db.prepare(`
  UPDATE logs
  SET approved_at=COALESCE(approved_at, datetime('now')),
      approved_by=COALESCE(approved_by, @by)
  WHERE period_start=@start AND period_end=@end
`);

export const setLogPeriod = (ids, start, end) => {
  if (!ids || !ids.length) return;
  const placeholders = ids.map(()=>'?').join(',');
  const stmt = db.prepare(
    'UPDATE logs SET period_start=?, period_end=? WHERE id IN (' + placeholders + ')'
  );
  stmt.run(start, end, ...ids);
};

export default db;
