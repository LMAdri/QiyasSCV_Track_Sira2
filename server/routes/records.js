'use strict';
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, UPLOAD_DIR } = require('../db');
const C = require('../lib/constants');
const { allow } = require('../middleware');
const { validateRecord, isPdf } = require('../lib/validate');
const { runNotifications } = require('../lib/notify');
const { fileSafe } = require('../lib/util');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const unlink = (f) => f && fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(f))).catch(() => {});

// Officers may only report on their own graduates; admins may report on anyone's behalf; PMs are view-only.
function loadGraduateFor(user, graduateId) {
  const g = db.prepare('SELECT id, officer_id FROM graduates WHERE id = ?').get(Number(graduateId));
  if (!g) return { error: [404, 'Graduate not found'] };
  if (user.role === 'officer' && g.officer_id !== user.id) return { error: [403, 'This graduate is not under your supervision'] };
  return { g };
}

function loadRecordFor(user, id) {
  const r = db.prepare(`SELECT r.*, g.officer_id FROM employment_records r JOIN graduates g ON g.id = r.graduate_id WHERE r.id = ?`).get(Number(id));
  if (!r) return { error: [404, 'Record not found'] };
  if (user.role === 'officer' && r.officer_id !== user.id) return { error: [403, 'This record is not under your supervision'] };
  return { r };
}

/** Parses multipart body, validates the record and the optional PDF. Returns {errors, data, pdf}. */
function prepare(req) {
  const { errors, data } = validateRecord(req.body || {});
  let pdf = null;
  if (req.file) {
    if (data.status !== C.OFFER_LETTER_STATUS) errors.push('An offer letter can only be attached when the status is "Currently secured job"');
    else if (!isPdf(req.file.buffer)) errors.push('The offer letter must be a PDF file');
    else pdf = req.file;
  }
  return { errors, data, pdf };
}

function savePdf(file) {
  const name = crypto.randomBytes(16).toString('hex') + '.pdf';
  fs.writeFileSync(path.join(UPLOAD_DIR, name), file.buffer, { mode: 0o640 });
  return { stored: name, original: fileSafe(path.parse(file.originalname || 'offer-letter').name) + '.pdf' };
}

const COLS = ['report_date', 'report_date_end', 'status', 'status_detail', 'company_name', 'company_description', 'company_city',
  'company_location', 'contact_person', 'company_tel', 'position', 'salary', 'application_date', 'interview_date',
  'expected_offer_date', 'offer_received_date'];

const handleUpload = (req, res, next) => upload.single('offer_letter')(req, res, (err) => {
  if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The PDF must be 5 MB or smaller' : err.message });
  next();
});

// ---------- list ----------
router.get('/', (req, res) => {
  const where = []; const params = [];
  if (req.user.role === 'officer') { where.push('g.officer_id = ?'); params.push(req.user.id); }
  else if (Number(req.query.officer_id)) { where.push('g.officer_id = ?'); params.push(Number(req.query.officer_id)); }
  if (Number(req.query.graduate_id)) { where.push('r.graduate_id = ?'); params.push(Number(req.query.graduate_id)); }
  if (req.query.date_from) { where.push('r.report_date >= ?'); params.push(String(req.query.date_from)); }
  if (req.query.date_to) { where.push('r.report_date <= ?'); params.push(String(req.query.date_to)); }
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(200, Math.max(1, Number(req.query.page_size) || 25));
  const total = db.prepare(`SELECT COUNT(*) n FROM employment_records r JOIN graduates g ON g.id = r.graduate_id${w}`).get(...params).n;
  const rows = db.prepare(`SELECT r.id, r.graduate_id, r.report_date, r.report_date_end, r.status, r.company_name, r.position,
    r.interview_date, r.expected_offer_date, (r.offer_letter_file IS NOT NULL) AS has_offer_letter, r.updated_at,
    g.first_name || ' ' || g.father_name || ' ' || g.grandfather_name AS graduate_name
    FROM employment_records r JOIN graduates g ON g.id = r.graduate_id${w}
    ORDER BY r.report_date DESC, r.id DESC LIMIT ? OFFSET ?`).all(...params, size, (page - 1) * size)
    .map((r) => ({ ...r, status_label: C.STATUS_LABEL[r.status] }));
  res.json({ rows, total, page, pages: Math.max(1, Math.ceil(total / size)) });
});

router.get('/:id', (req, res) => {
  const { r, error } = loadRecordFor(req.user, req.params.id);
  if (error) return res.status(error[0]).json({ error: error[1] });
  const { offer_letter_file, ...rest } = r;
  res.json({ record: { ...rest, has_offer_letter: !!offer_letter_file } });
});

// ---------- create ----------
router.post('/', allow('officer', 'admin'), handleUpload, (req, res) => {
  const { g, error } = loadGraduateFor(req.user, req.body?.graduate_id);
  if (error) return res.status(error[0]).json({ error: error[1] });
  const { errors, data, pdf } = prepare(req);
  if (errors.length) return res.status(400).json({ error: errors[0], details: errors });
  const file = pdf ? savePdf(pdf) : null;
  const cols = ['graduate_id', 'recorded_by', ...COLS, 'offer_letter_file', 'offer_letter_name'];
  const vals = [g.id, req.user.id, ...COLS.map((c) => data[c] ?? null), file?.stored ?? null, file?.original ?? null];
  const r = db.prepare(`INSERT INTO employment_records (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
  try { runNotifications(); } catch (_) { /* reminders are best-effort here; the hourly job retries */ }
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

// ---------- update ----------
router.put('/:id', allow('officer', 'admin'), handleUpload, (req, res) => {
  const { r: old, error } = loadRecordFor(req.user, req.params.id);
  if (error) return res.status(error[0]).json({ error: error[1] });
  const { errors, data, pdf } = prepare(req);
  if (errors.length) return res.status(400).json({ error: errors[0], details: errors });

  let stored = old.offer_letter_file; let original = old.offer_letter_name;
  const remove = data.status !== C.OFFER_LETTER_STATUS || req.body?.remove_offer_letter === '1';
  if (remove && stored) { unlink(stored); stored = null; original = null; }
  if (pdf) { unlink(stored); const f = savePdf(pdf); stored = f.stored; original = f.original; }

  db.prepare(`UPDATE employment_records SET ${COLS.map((c) => c + ' = ?').join(', ')},
    offer_letter_file = ?, offer_letter_name = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(...COLS.map((c) => data[c] ?? null), stored, original, old.id);
  try { runNotifications(); } catch (_) { /* best-effort */ }
  res.json({ ok: true });
});

router.delete('/:id', allow('admin'), (req, res) => {
  const { r, error } = loadRecordFor(req.user, req.params.id);
  if (error) return res.status(error[0]).json({ error: error[1] });
  db.prepare('DELETE FROM employment_records WHERE id = ?').run(r.id);
  unlink(r.offer_letter_file);
  res.json({ ok: true });
});

// ---------- offer letter download (same access rules as the record) ----------
router.get('/:id/offer-letter', (req, res) => {
  const { r, error } = loadRecordFor(req.user, req.params.id);
  if (error) return res.status(error[0]).json({ error: error[1] });
  if (!r.offer_letter_file) return res.status(404).json({ error: 'No offer letter attached' });
  const file = path.join(UPLOAD_DIR, path.basename(r.offer_letter_file));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File is missing on the server' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${r.offer_letter_name || 'offer-letter.pdf'}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(file);
});

module.exports = router;
