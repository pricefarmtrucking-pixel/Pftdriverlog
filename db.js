// db.js
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use a project-local writable folder (avoid /data permission errors on Render)
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE  = path.join(DATA_DIR, 'driverlog.sqlite3');

export function initDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');

  // --- Schema ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS drivers (
      id            INTEGER PRIMARY KEY,
      name          TEXT NOT NULL,
      rpm_default   REAL DEFAULT 0.46,
      hourly_default REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS trucks (
      id    INTEGER PRIMARY KEY,
      unit  TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS logs (
      id                INTEGER PRIMARY KEY,
      log_date          TEXT NOT NULL,                -- YYYY-MM-DD
      driver_id         INTEGER NOT NULL,
      truck_id          INTEGER NOT NULL,
      miles             REAL    DEFAULT 0,
      value             REAL    DEFAULT 0,            -- “stop value hours”
      rpm               REAL    DEFAULT 0.46,         -- stored to snapshot rate used
      per_value         REAL    DEFAULT 25,           -- stored snapshot
      detention_minutes INTEGER DEFAULT 0,
      detention_rate    REAL    DEFAULT 0,            -- stored snapshot
      notes             TEXT    DEFAULT '',
      approved_at       TEXT    DEFAULT NULL,
      paid_at           TEXT    DEFAULT NULL,
      created_at        TEXT    DEFAULT (datetime('now')),
      FOREIGN KEY(driver_id) REFERENCES drivers(id),
      FOREIGN KEY(truck_id)  REFERENCES trucks(id)
    );
  `);

  // Optional: ensure driver rows exist for the IDs referenced in DRIVER_TOKENS_JSON
  try {
    const map = JSON.parse(process.env.DRIVER_TOKENS_JSON || '{}');
    const getDrv = db.prepare(`SELECT id FROM drivers WHERE id=?`);
    const insDrv = db.prepare(`INSERT INTO drivers (id, name) VALUES (?, ?)`);
    for (const key of Object.keys(map)) {
      const id = Number(key);
      if (!getDrv.get(id)) {
        insDrv.run(id, `Driver #${id}`);
      }
    }
  } catch { /* ignore */ }

  db.close();
}

function open() {
  const db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  return db;
}

/* -------------------------------------------------
   Utility: ensure/lookup truck id by unit
-------------------------------------------------- */
export function getOrCreateTruckId(unit) {
  const u = String(unit || '').trim();
  if (!u) return null;
  const db = open();
  try {
    const get = db.prepare(`SELECT id
