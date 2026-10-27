'use strict';
const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { db, tx, UPLOAD_DIR } = require('../db');
const C = require('../lib/constants');
const { allow } = require('../middleware');
const { validateGraduate, norm } = require('../lib/validate');
const { listGraduates } = require('../lib/queries');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const FIELDS = ['first_name', 'father_name', 'grandfather_name', 'track', 'gender', 'fayda_id', 'kebele_id', 'phone',
  'address', 'campus', 'prev_education', 'field_of_study', 'tvet_field', 'idp', 'disability', 'returnee',
  'additional_cert', 'worked_as_intern', 'intern_company', 'intern_description', 'other_info', 'officer_id'];

function canSee(user, grad) {
  return user.role !== 'officer' || grad.officer_id === user.id;
}

function isDuplicate(d, exceptId = 0) {
  const row = db.prepare(`SELECT id FROM graduates WHERE id != ? AND phone = ?
    AND lower(first_name || ' ' || father_name || ' ' || grandfather_name) = lower(?)`)
    .get(exceptId, d.phone, `${d.first_name} ${d.father_name} ${d.grandfather_name}`);
  return !!row;
}

// ---------- list (officers only ever see their own graduates) ----------
router.get('/', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(2000, Math.max(1, Number(req.query.page_size) || 50));
  const { rows, total } = listGraduates(req.query, req.user, { page, pageSize });
  res.json({ rows, total, page, pages: Math.max(1, Math.ceil(total / pageSize)) });
});

// ---------- Excel bulk import (admin) ----------
const HEADERS = {
  first_name: ['firstname', 'first'],
  father_name: ['fathername', 'fathersname', 'father'],
  grandfather_name: ['grandfathername', 'grandfathersname', 'grandfather'],
  track: ['trainingtrack', 'track'],
  gender: ['gender', 'sex'],
  fayda_id: ['faydaid', 'fayda'],
  kebele_id: ['kebeleid', 'kebele'],
  phone: ['phone', 'phoneno', 'cellphone', 'cellphoneno', 'mobile', 'tel'],
  address: ['livingaddress', 'address'],
  campus: ['campus', 'campusname'],
  prev_education: ['previouseducation', 'previouseducationalbackground', 'educationalbackground', 'education'],
  field_of_study: ['fieldofstudy', 'previousfieldofstudy', 'bachelorsfieldofstudy'],
  tvet_field: ['tvetfieldofstudy', 'tvetfield', 'fieldofstudyintvet'],
  idp: ['idp'],
  disability: ['disability'],
  returnee: ['returnee'],
  additional_cert: ['additionalcertification', 'additionalcert', 'certification'],
  worked_as_intern: ['workedasintern', 'workedasinternduringtraining', 'intern'],
  intern_company: ['interncompany'],
  intern_description: ['interndescription'],
  other_info: ['otherinfo', 'other'],
  officer: ['projectofficer', 'officer', 'projectofficerusername', 'officerusername'],
};

const TEMPLATE_COLUMNS = [
  ['First Name', 'first_name', 14], ['Father Name', 'father_name', 14], ['Grandfather Name', 'grandfather_name', 16],
  ['Training Track', 'track', 38], ['Gender', 'gender', 9], ['Fayda ID', 'fayda_id', 16], ['Kebele ID', 'kebele_id', 14],
  ['Phone', 'phone', 14], ['Living Address', 'address', 24], ['Campus', 'campus', 20],
  ['Previous Education', 'prev_education', 22], ['Field of Study', 'field_of_study', 22], ['TVET Field of Study', 'tvet_field', 22],
  ['IDP', 'idp', 7], ['Disability', 'disability', 10], ['Returnee', 'returnee', 10],
  ['Additional Certification', 'additional_cert', 24], ['Worked as Intern', 'worked_as_intern', 16],
  ['Intern Company', 'intern_company', 20], ['Intern Description', 'intern_description', 24], ['Other Info', 'other_info', 24],
  ['Project Officer', 'officer', 20],
];

function cellText(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (v.result !== undefined) return String(v.result);
    if (v.text !== undefined) return String(v.text);
    return '';
  }
  return String(v);
}

router.get('/import-template', allow('admin'), async (req, res, next) => {
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Graduates');
    ws.columns = TEMPLATE_COLUMNS.map(([header, key, width]) => ({ header, key, width }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.getColumn('phone').numFmt = '@'; // keep leading zero
    ws.addRow({
      first_name: 'Abel', father_name: 'Tesfaye', grandfather_name: 'Alemu', track: C.TRACKS[0], gender: 'Male',
      phone: '0911223344', address: 'Bole, Addis Ababa', campus: C.CAMPUS_NAMES[0], prev_education: C.EDUCATION[2],
      field_of_study: 'Computer Science', idp: 'No', disability: 'No', returnee: 'No', worked_as_intern: 'No', officer: 'po01',
    });
    const lists = wb.addWorksheet('Allowed values');
    const cols = [['Training Track', C.TRACKS], ['Gender', ['Male', 'Female']], ['Campus', C.CAMPUS_NAMES],
      ['Previous Education', C.EDUCATION], ['IDP / Disability / Returnee / Intern', ['Yes', 'No']],
      ['Project Officer (username)', db.prepare("SELECT username FROM users WHERE role='officer' AND active=1 ORDER BY username").all().map((u) => u.username)]];
    cols.forEach(([h, vals], i) => {
      lists.getColumn(i + 1).width = 40;
      lists.getCell(1, i + 1).value = h;
      lists.getCell(1, i + 1).font = { bold: true };
      vals.forEach((v, j) => { lists.getCell(j + 2, i + 1).value = v; });
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="graduates-import-template.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { next(e); }
});

router.post('/import', allow('admin'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Please choose an .xlsx file' });
    if (req.file.buffer.slice(0, 2).toString('latin1') !== 'PK') return res.status(400).json({ error: 'The file is not a valid .xlsx workbook' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    const ws = wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: 'The workbook has no sheets' });

    const colFor = {};
    ws.getRow(1).eachCell((cell, n) => {
      const h = norm(cellText(cell));
      for (const [field, aliases] of Object.entries(HEADERS)) if (aliases.includes(h) && !colFor[field]) colFor[field] = n;
    });
    const missing = ['first_name', 'father_name', 'grandfather_name', 'track', 'gender', 'phone', 'campus', 'prev_education', 'officer'].filter((f) => !colFor[f]);
    if (missing.length) return res.status(400).json({ error: 'Missing column(s) in row 1: ' + missing.join(', ') + '. Download the template to see the expected headers.' });
    if (ws.rowCount > 5001) return res.status(400).json({ error: 'Too many rows (max 5000 per import)' });

    const officers = db.prepare("SELECT id, username, full_name FROM users WHERE role='officer' AND active=1").all();
    const findOfficer = (v) => {
      const n = norm(v);
      return n ? officers.find((o) => norm(o.username) === n) || officers.find((o) => norm(o.full_name) === n) : null;
    };

    const errors = [];
    const valid = [];
    const seen = new Set();
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const raw = {};
      let any = false;
      for (const [field, n] of Object.entries(colFor)) {
        const cell = row.getCell(n);
        let t = cellText(cell).trim();
        if (field === 'phone' && typeof cell.value === 'number') {
          t = String(Math.trunc(cell.value));
          if (t.length === 9) t = '0' + t; // Excel dropped the leading zero
        }
        raw[field] = t;
        if (t) any = true;
      }
      if (!any) continue;
      const officer = findOfficer(raw.officer);
      const { errors: errs, data } = validateGraduate({ ...raw, officer_id: officer ? officer.id : 0 });
      if (!officer) {
        const i = errs.findIndex((e) => e.startsWith('A valid, active project officer'));
        const msg = `Project officer "${raw.officer}" not found (use the officer's username or full name)`;
        if (i >= 0) errs[i] = msg; else errs.push(msg);
      }
      if (errs.length) { errors.push({ row: r, name: `${raw.first_name} ${raw.father_name}`.trim(), message: errs.join('; ') }); continue; }
      const key = `${data.first_name} ${data.father_name} ${data.grandfather_name}|${data.phone}`.toLowerCase();
      if (seen.has(key) || isDuplicate(data)) { errors.push({ row: r, name: `${data.first_name} ${data.father_name}`, message: 'Duplicate (same full name and phone) - skipped' }); continue; }
      seen.add(key);
      valid.push(data);
    }

    const ins = db.prepare(`INSERT INTO graduates (${FIELDS.join(',')}) VALUES (${FIELDS.map(() => '?').join(',')})`);
    tx(() => valid.forEach((d) => ins.run(...FIELDS.map((f) => d[f] ?? null))));
    res.json({ imported: valid.length, skipped: errors.length, errors: errors.slice(0, 200) });
  } catch (e) {
    if (e instanceof multer.MulterError) return res.status(400).json({ error: e.message });
    next(e);
  }
});

// ---------- single graduate ----------
router.get('/:id', (req, res) => {
  const g = db.prepare(`SELECT g.*, u.full_name AS officer_name FROM graduates g
    LEFT JOIN users u ON u.id = g.officer_id WHERE g.id = ?`).get(Number(req.params.id));
  if (!g || !canSee(req.user, g)) return res.status(404).json({ error: 'Graduate not found' });
  const records = db.prepare(`SELECT r.id, r.report_date, r.report_date_end, r.status, r.status_detail, r.company_name,
    r.company_description, r.company_city, r.company_location, r.contact_person, r.company_tel, r.position, r.salary,
    r.application_date, r.interview_date, r.expected_offer_date, r.offer_received_date,
    (r.offer_letter_file IS NOT NULL) AS has_offer_letter, r.offer_letter_name, r.created_at, r.updated_at,
    u.full_name AS recorded_by_name
    FROM employment_records r LEFT JOIN users u ON u.id = r.recorded_by
    WHERE r.graduate_id = ? ORDER BY r.report_date DESC, r.id DESC`).all(g.id)
    .map((r) => ({ ...r, status_label: C.STATUS_LABEL[r.status] }));
  res.json({ graduate: { ...g }, records });
});

router.post('/', allow('admin'), (req, res) => {
  const { errors, data } = validateGraduate(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors[0], details: errors });
  if (isDuplicate(data)) return res.status(409).json({ error: 'A graduate with the same full name and phone number already exists' });
  const r = db.prepare(`INSERT INTO graduates (${FIELDS.join(',')}) VALUES (${FIELDS.map(() => '?').join(',')})`)
    .run(...FIELDS.map((f) => data[f] ?? null));
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

router.put('/:id', allow('admin'), (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM graduates WHERE id = ?').get(id)) return res.status(404).json({ error: 'Graduate not found' });
  const { errors, data } = validateGraduate(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors[0], details: errors });
  if (isDuplicate(data, id)) return res.status(409).json({ error: 'Another graduate has the same full name and phone number' });
  db.prepare(`UPDATE graduates SET ${FIELDS.map((f) => f + ' = ?').join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...FIELDS.map((f) => data[f] ?? null), id);
  res.json({ ok: true });
});

router.delete('/:id', allow('admin'), (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM graduates WHERE id = ?').get(id)) return res.status(404).json({ error: 'Graduate not found' });
  const files = db.prepare('SELECT offer_letter_file f FROM employment_records WHERE graduate_id = ? AND offer_letter_file IS NOT NULL').all(id);
  db.prepare('DELETE FROM graduates WHERE id = ?').run(id);
  files.forEach(({ f }) => fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(f))).catch(() => {}));
  res.json({ ok: true });
});

module.exports = router;
