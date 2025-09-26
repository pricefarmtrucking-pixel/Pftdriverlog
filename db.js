import Database from 'better-sqlite3';
import fs from 'fs';

const dbFile = './data.db';
const db = new Database(dbFile);

export function initDb() {
  db.prepare(`CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    log_date TEXT,
    truck TEXT,
    miles REAL,
    stop_value REAL,
    detention_value REAL,
    start_time TEXT,
    end_time TEXT,
    total_hours REAL,
    notes TEXT,
    paid INTEGER DEFAULT 0
  )`).run();
}

export function insertLog(log) {
  const existing = db.prepare(`SELECT * FROM logs WHERE log_date=? AND truck=?`).get(log.log_date, log.truck);
  if (existing) {
    return { duplicate: true, existing };
  }
  db.prepare(`INSERT INTO logs (log_date, truck, miles, stop_value, detention_value, start_time, end_time, total_hours, notes)
              VALUES (@log_date,@truck,@miles,@stop_value,@detention_value,@start_time,@end_time,@total_hours,@notes)`)
    .run(log);
  return { duplicate: false };
}

export function getLogs(from, to) {
  if (from && to) {
    return db.prepare(`SELECT * FROM logs WHERE log_date BETWEEN ? AND ?`).all(from, to);
  }
  return db.prepare(`SELECT * FROM logs`).all();
}

export function getLogById(id) {
  return db.prepare(`SELECT * FROM logs WHERE id=?`).get(id);
}

export function updateLog(id, data) {
  db.prepare(`UPDATE logs SET log_date=@log_date, truck=@truck, miles=@miles, stop_value=@stop_value, detention_value=@detention_value,
              start_time=@start_time, end_time=@end_time, total_hours=@total_hours, notes=@notes WHERE id=@id`)
    .run({ ...data, id });
}

export function markPaid(ids) {
  const stmt = db.prepare(`UPDATE logs SET paid=1 WHERE id=?`);
  ids.forEach(id => stmt.run(id));
}

export function getPayroll(from, to) {
  if (from && to) {
    return db.prepare(`SELECT truck, SUM(miles) as total_miles, SUM(stop_value+detention_value) as total_pay FROM logs WHERE log_date BETWEEN ? AND ? GROUP BY truck`).all(from, to);
  }
  return db.prepare(`SELECT truck, SUM(miles) as total_miles, SUM(stop_value+detention_value) as total_pay FROM logs GROUP BY truck`).all();
}