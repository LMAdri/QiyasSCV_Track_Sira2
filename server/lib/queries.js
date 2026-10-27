'use strict';
const { db } = require('../db');
const { STATUS_LABEL } = require('./constants');

// ---------- report definitions (admin requirements 1-11, plus "interviewed") ----------
const col = (key, label, w = 1) => ({ key, label, w });
const C = {
  name: col('full_name', 'Full name', 1.6),
  phone: col('phone', 'Graduate tel', 1.1),
  track: col('track', 'Training track', 1.6),
  campus: col('campus', 'Campus', 1.1),
  edu: col('prev_education', 'Previous education', 1.2),
  field: col('field_of_study', 'Previous field of study', 1.3),
  officer: col('officer', 'Project officer', 1.2),
  company: col('company_name', 'Company name', 1.4),
  desc: col('company_description', 'Company details', 2),
  ctel: col('company_tel', 'Company tel', 1.1),
  position: col('position', 'Position', 1.2),
  salary: col('salary', 'Salary (ETB)', 0.9),
  offerDate: col('offer_received_date', 'Offer letter received', 1),
  city: col('company_city', 'Company city', 1),
  contact: col('contact_person', 'Contact person', 1.2),
  appliedCo: col('company_name', 'Company applied to', 1.4),
  appDate: col('application_date', 'Date of application', 1),
  interviewDate: col('interview_date', 'Interview / exam date', 1),
  expectedOffer: col('expected_offer_date', 'Expected offer date', 1),
  status: col('status_label', 'Employment status', 1.6),
  reportDate: col('report_date', 'Last report date', 1),
};
const COMPANY_COLS = [C.name, C.phone, C.company, C.desc, C.ctel, C.position, C.salary, C.offerDate, C.city, C.contact, C.officer];
const PERSON_COLS = [C.name, C.phone, C.track, C.campus, C.edu, C.field];

const REPORTS = {
  waiting_offer: { title: 'Passed interview - waiting for offer letter', statuses: [6], columns: [...COMPANY_COLS, C.expectedOffer] },
  secured: { title: 'Secured job / got employment letter (employed recently)', statuses: [7], columns: COMPANY_COLS },
  declined: { title: 'Declined the job offer', statuses: [8], columns: COMPANY_COLS },
  working: { title: 'Already actively working / employed previously', statuses: [9], columns: COMPANY_COLS },
  self_employed: { title: 'Currently self-employed', statuses: [10], columns: COMPANY_COLS },
  unemployed: { title: 'Currently unemployed / still searching for job', statuses: [1], columns: [C.name, C.phone, C.track, C.campus, C.officer] },
  all_graduates: { title: 'All graduates', statuses: null, columns: [...PERSON_COLS, C.officer, C.status] },
  applied: { title: 'Applied for job position / sent CV', statuses: [2], columns: [...PERSON_COLS, C.appliedCo, C.appDate] },
  scheduled: { title: 'Scheduled for interview / exam', statuses: [3], columns: [...PERSON_COLS, C.appliedCo, C.interviewDate] },
  interviewed: { title: 'Interviewed / took exam (result pending)', statuses: [4], columns: [...PERSON_COLS, C.appliedCo, C.interviewDate] },
  passed: { title: 'Passed interview / exam', statuses: [6], columns: [...PERSON_COLS, C.appliedCo, C.interviewDate, C.expectedOffer] },
  failed: { title: 'Failed interview / exam', statuses: [5], columns: [...PERSON_COLS, C.appliedCo, C.interviewDate] },
};

// ---------- shared SQL ----------
const BASE_SELECT = `
SELECT g.id AS graduate_id,
  g.first_name || ' ' || g.father_name || ' ' || g.grandfather_name AS full_name,
  g.phone, g.gender, g.track, g.campus, g.prev_education,
  TRIM(COALESCE(NULLIF(g.field_of_study,''), NULLIF(g.tvet_field,''), '')) AS field_of_study,
  g.officer_id, uo.full_name AS officer,
  r.id AS record_id, COALESCE(r.status, 0) AS status, r.status_detail, r.report_date,
  r.company_name, r.company_description, r.company_city, r.company_location,
  r.contact_person, r.company_tel, r.position, r.salary,
  r.application_date, r.interview_date, r.expected_offer_date, r.offer_received_date,
  (r.offer_letter_file IS NOT NULL) AS has_offer_letter
FROM graduates g
LEFT JOIN users uo ON uo.id = g.officer_id
LEFT JOIN current_records r ON r.graduate_id = g.id`;

/** Build WHERE clauses from query-string filters. Officers are always scoped to their own graduates. */
function buildFilters(q, user, statuses) {
  const where = [];
  const params = [];
  const officerId = user.role === 'officer' ? user.id : Number(q.officer_id) || null;
  if (officerId) { where.push('g.officer_id = ?'); params.push(officerId); }
  if (q.track) { where.push('g.track = ?'); params.push(String(q.track)); }
  if (q.campus) { where.push('g.campus = ?'); params.push(String(q.campus)); }
  if (q.gender) { where.push('g.gender = ?'); params.push(String(q.gender)); }
  if (q.q) {
    const like = `%${String(q.q).trim()}%`;
    where.push(`(g.first_name || ' ' || g.father_name || ' ' || g.grandfather_name LIKE ? OR g.phone LIKE ?
      OR g.fayda_id LIKE ? OR r.company_name LIKE ?)`);
    params.push(like, like, like, like);
  }
  if (q.city) { where.push('r.company_city LIKE ?'); params.push(`%${String(q.city).trim()}%`); }
  if (q.date_from) { where.push('r.report_date >= ?'); params.push(String(q.date_from)); }
  if (q.date_to) { where.push('r.report_date <= ?'); params.push(String(q.date_to)); }
  if (q.status !== undefined && q.status !== '' && Number.isInteger(Number(q.status))) {
    where.push('COALESCE(r.status, 0) = ?'); params.push(Number(q.status));
  }
  if (statuses) {
    where.push(`r.status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  return { sql: where.length ? ' WHERE ' + where.join(' AND ') : '', params };
}

const ORDER = ' ORDER BY g.first_name, g.father_name, g.grandfather_name, g.id';

function decorate(row) {
  row.status_label = STATUS_LABEL[row.status] || '';
  return row;
}

function listGraduates(q, user, { page = 1, pageSize = 50 } = {}) {
  const f = buildFilters(q, user, null);
  const total = db.prepare(`SELECT COUNT(*) n FROM (${BASE_SELECT}${f.sql})`).get(...f.params).n;
  const rows = db.prepare(BASE_SELECT + f.sql + ORDER + ' LIMIT ? OFFSET ?')
    .all(...f.params, pageSize, (page - 1) * pageSize).map(decorate);
  return { rows, total };
}

function runReport(key, q, user, { page = 1, pageSize = 25, all = false } = {}) {
  const def = REPORTS[key];
  if (!def) return null;
  const f = buildFilters(q, user, def.statuses);
  const total = db.prepare(`SELECT COUNT(*) n FROM (${BASE_SELECT}${f.sql})`).get(...f.params).n;
  const sql = BASE_SELECT + f.sql + ORDER + (all ? '' : ' LIMIT ? OFFSET ?');
  const args = all ? f.params : [...f.params, pageSize, (page - 1) * pageSize];
  const rows = db.prepare(sql).all(...args).map(decorate);
  return { key, title: def.title, columns: def.columns, rows, total };
}

// ---------- statistics for the dashboard ----------
const EMPLOYED = [7, 9];
const SELF = [10];
const UNEMPLOYED = [1, 2, 3, 4, 5, 6, 8];

function summarise(counts) {
  const sum = (ids) => ids.reduce((a, id) => a + (counts[id] || 0), 0);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    total,
    employed: sum(EMPLOYED),
    self_employed: sum(SELF),
    unemployed: sum(UNEMPLOYED),
    not_reported: counts[0] || 0,
  };
}

function getStats(q, user) {
  const f = buildFilters({ ...q, status: undefined }, user, null);
  const rows = db.prepare(`SELECT COALESCE(r.status,0) AS status, COUNT(*) AS n
    FROM graduates g LEFT JOIN current_records r ON r.graduate_id = g.id${f.sql} GROUP BY 1`).all(...f.params);
  const counts = {};
  for (let i = 0; i <= 10; i++) counts[i] = 0;
  rows.forEach((r) => { counts[r.status] = r.n; });
  return {
    counts,
    labels: STATUS_LABEL,
    summary: summarise(counts),
    generated_at: new Date().toISOString(),
  };
}

const GROUP_COLUMNS = { track: 'g.track', campus: 'g.campus', officer: "COALESCE(uo.full_name, '(unassigned)')" };

function getBreakdown(group, q, user) {
  const expr = GROUP_COLUMNS[group];
  if (!expr) return null;
  const f = buildFilters({ ...q, status: undefined }, user, null);
  const rows = db.prepare(`SELECT ${expr} AS grp, COALESCE(r.status,0) AS status, COUNT(*) AS n
    FROM graduates g LEFT JOIN users uo ON uo.id = g.officer_id
    LEFT JOIN current_records r ON r.graduate_id = g.id${f.sql} GROUP BY 1, 2 ORDER BY 1`).all(...f.params);
  const map = new Map();
  rows.forEach((r) => {
    if (!map.has(r.grp)) map.set(r.grp, {});
    map.get(r.grp)[r.status] = r.n;
  });
  return [...map.entries()].map(([name, counts]) => ({ name, ...summarise(counts) }));
}

module.exports = { REPORTS, listGraduates, runReport, getStats, getBreakdown, buildFilters, BASE_SELECT };
