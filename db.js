// db.js
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || '/data';
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'driverlog.sqlite');
const db = new Database(DB_FILE);

// Minimal prepared statement example
export const insertDriver = db.prepare("INSERT INTO drivers(name) VALUES(?)");
// TODO: add rest of prepared statements and schema initialization

export default db;
