'use strict';
// SQLite via Node's built-in node:sqlite (Node >= 22.13). No native build step needed.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'app.db');
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','officer','pm')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS graduates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  father_name TEXT NOT NULL,
  grandfather_name TEXT NOT NULL,
  track TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('Male','Female')),
  fayda_id TEXT,
  kebele_id TEXT,
  phone TEXT NOT NULL,
  address TEXT,
  campus TEXT NOT NULL,
  prev_education TEXT NOT NULL,
  field_of_study TEXT,
  tvet_field TEXT,
  idp INTEGER NOT NULL DEFAULT 0,
  disability INTEGER NOT NULL DEFAULT 0,
  returnee INTEGER NOT NULL DEFAULT 0,
  additional_cert TEXT,
  worked_as_intern INTEGER NOT NULL DEFAULT 0,
  intern_company TEXT,
  intern_description TEXT,
  other_info TEXT,
  officer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_grad_officer ON graduates(officer_id);
CREATE INDEX IF NOT EXISTS idx_grad_track ON graduates(track);
CREATE INDEX IF NOT EXISTS idx_grad_campus ON graduates(campus);

CREATE TABLE IF NOT EXISTS employment_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  graduate_id INTEGER NOT NULL REFERENCES graduates(id) ON DELETE CASCADE,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  report_date TEXT NOT NULL,
  report_date_end TEXT,
  status INTEGER NOT NULL CHECK (status BETWEEN 1 AND 10),
  status_detail TEXT,
  company_name TEXT,
  company_description TEXT,
  company_city TEXT,
  company_location TEXT,
  contact_person TEXT,
  company_tel TEXT,
  position TEXT,
  salary REAL,
  application_date TEXT,
  interview_date TEXT,
  expected_offer_date TEXT,
  offer_received_date TEXT,
  offer_letter_file TEXT,
  offer_letter_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rec_grad ON employment_records(graduate_id, report_date, id);

-- The latest report (by reporting date, then id) is the graduate's current status.
CREATE VIEW IF NOT EXISTS current_records AS
  SELECT r.* FROM employment_records r
  WHERE r.id = (SELECT x.id FROM employment_records x WHERE x.graduate_id = r.graduate_id
                ORDER BY x.report_date DESC, x.id DESC LIMIT 1);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_id INTEGER NOT NULL REFERENCES employment_records(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  offset_days INTEGER NOT NULL,
  target_date TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, record_id, kind, offset_days, target_date)
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
`);

function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  }
}

module.exports = { db, tx, DATA_DIR, UPLOAD_DIR };
