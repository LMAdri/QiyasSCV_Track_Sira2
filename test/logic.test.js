'use strict';
// Tests the business logic and SQL against a throw-away database (no web server needed).
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'get-test-'));
process.env.DATA_DIR = tmp;
process.env.DB_FILE = ':memory:';
process.env.ADMIN_PASSWORD = 'Admin@12345';

const assert = require('assert');
const { db } = require('../server/db');
const sec = require('../server/lib/security');
const V = require('../server/lib/validate');
const Q = require('../server/lib/queries');
const { runNotifications } = require('../server/lib/notify');
const { seedAccounts, seedDemo } = require('../server/seed');
const { today } = require('../server/lib/util');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };
const addDays = (n) => new Date(Date.parse(today() + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

seedAccounts();
seedDemo();
const admin = db.prepare("SELECT * FROM users WHERE username='admin'").get();
const po1 = db.prepare("SELECT * FROM users WHERE username='po01'").get();
const pm = db.prepare("SELECT * FROM users WHERE username='pm'").get();

test('accounts: 1 admin, 1 pm, 40 officers', () => {
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM users WHERE role='officer'").get().n, 40);
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get().n, 1);
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM users WHERE role='pm'").get().n, 1);
});

test('992 demo graduates spread over 5 tracks, 9 campuses, 40 officers', () => {
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM graduates').get().n, 992);
  assert.strictEqual(db.prepare('SELECT COUNT(DISTINCT track) n FROM graduates').get().n, 5);
  assert.strictEqual(db.prepare('SELECT COUNT(DISTINCT campus) n FROM graduates').get().n, 9);
  assert.strictEqual(db.prepare('SELECT COUNT(DISTINCT officer_id) n FROM graduates').get().n, 40);
});

test('password hashing, policy and tokens', () => {
  const h = sec.hashPassword('Secret123');
  assert(sec.verifyPassword('Secret123', h));
  assert(!sec.verifyPassword('secret123', h));
  assert(sec.passwordProblem('short1'));
  assert(sec.passwordProblem('allletters'));
  assert.strictEqual(sec.passwordProblem('Good1234'), null);
  const t = sec.signToken({ uid: 5, tv: 0 });
  assert.strictEqual(sec.verifyToken(t).uid, 5);
  assert.strictEqual(sec.verifyToken(t.slice(0, -2) + 'xx'), null);
});

test('graduate validation: matching, conditional fields, required officer', () => {
  const ok = V.validateGraduate({
    first_name: 'Abel', father_name: 'Tesfaye', grandfather_name: 'Alemu', track: 'web', gender: 'm',
    phone: '0911223344', campus: 'selam', prev_education: 'Bachelors degree', field_of_study: 'CS', tvet_field: 'ignored',
    worked_as_intern: 'yes', intern_company: 'ACME', officer_id: po1.id,
  });
  assert.deepStrictEqual(ok.errors, []);
  assert.strictEqual(ok.data.track, 'Web & Enterprise Application Development');
  assert.strictEqual(ok.data.field_of_study, 'CS');
  assert.strictEqual(ok.data.tvet_field, null);
  const bad = V.validateGraduate({ first_name: '', track: 'x', gender: 'z', phone: 'abc', campus: 'Nowhere', prev_education: '??', officer_id: 99999 });
  assert(bad.errors.length >= 8);
});

test('record validation: statuses require their special fields', () => {
  const base = { report_date: today(), company_name: 'ACME' };
  assert(V.validateRecord({ ...base, status: 3 }).errors.join().includes('interview'));
  assert(V.validateRecord({ ...base, status: 6 }).errors.join().includes('Expected date of offer'));
  assert.deepStrictEqual(V.validateRecord({ ...base, status: 6, expected_offer_date: addDays(2) }).errors, []);
  assert(V.validateRecord({ report_date: today(), status: 2 }).errors.join().includes('Company name'));
  assert.deepStrictEqual(V.validateRecord({ report_date: today(), status: 1 }).errors, []);
  const sal = V.validateRecord({ ...base, status: 7, salary: '12,500' });
  assert.strictEqual(sal.data.salary, 12500);
  assert.strictEqual(V.validateRecord({ ...base, status: 2, salary: 999 }).data.salary, null);
  assert(V.validateRecord({ ...base, status: 7, salary: -5 }).errors.length);
  assert(V.validateRecord({ report_date: '2026-02-31', status: 1 }).errors.length);
  assert(V.validateRecord({ report_date: '2026-05-10', report_date_end: '2026-05-01', status: 1 }).errors.length);
  assert(V.isPdf(Buffer.from('%PDF-1.7 ...')) && !V.isPdf(Buffer.from('MZ not a pdf')));
});

test('latest report per graduate is the current status', () => {
  const g = db.prepare('SELECT id FROM graduates WHERE officer_id = ? LIMIT 1').get(po1.id).id;
  db.prepare('DELETE FROM employment_records WHERE graduate_id = ?').run(g);
  const ins = db.prepare("INSERT INTO employment_records (graduate_id, recorded_by, report_date, status) VALUES (?,?,?,?)");
  ins.run(g, po1.id, '2026-09-01', 1);
  ins.run(g, po1.id, '2026-10-01', 2);
  ins.run(g, po1.id, '2026-09-15', 5); // older date entered later must not win
  assert.strictEqual(db.prepare('SELECT status FROM current_records WHERE graduate_id=?').get(g).status, 2);
});

test('all 12 reports run and respect their status filter', () => {
  const expectStatus = { waiting_offer: 6, secured: 7, declined: 8, working: 9, self_employed: 10, unemployed: 1, applied: 2, scheduled: 3, interviewed: 4, passed: 6, failed: 5 };
  for (const key of Object.keys(Q.REPORTS)) {
    const r = Q.runReport(key, {}, admin, { all: true });
    assert.strictEqual(r.rows.length, r.total, key);
    if (expectStatus[key]) assert(r.rows.every((x) => x.status === expectStatus[key]), key);
    r.columns.forEach((c) => assert(r.rows.length === 0 || c.key in r.rows[0], `${key}: column ${c.key} missing`));
  }
  assert.strictEqual(Q.runReport('all_graduates', {}, admin, { all: true }).total, 992);
});

test('filters: officer, track, campus, search, pagination; officer scope enforced', () => {
  const all = Q.runReport('all_graduates', { officer_id: po1.id }, admin, { all: true });
  assert(all.total >= 24 && all.rows.every((r) => r.officer_id === po1.id));
  const scoped = Q.runReport('all_graduates', { officer_id: 2 }, po1, { all: true }); // officer cannot widen scope
  assert(scoped.rows.every((r) => r.officer_id === po1.id));
  assert.strictEqual(scoped.total, all.total);
  const tr = Q.runReport('all_graduates', { track: 'AI Integrated Digital Marketing' }, admin, { all: true });
  assert(tr.rows.every((r) => r.track === 'AI Integrated Digital Marketing') && tr.total > 150);
  assert(Q.runReport('all_graduates', { campus: 'Hossana PTC' }, admin, { all: true }).rows.every((r) => r.campus === 'Hossana PTC'));
  const page2 = Q.runReport('all_graduates', {}, admin, { page: 2, pageSize: 25 });
  assert.strictEqual(page2.rows.length, 25);
  assert.strictEqual(Q.listGraduates({ q: "'; DROP TABLE users;--" }, admin).total, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM users').get().n, 42);
});

test('stats: counts add up to total; breakdown consistent', () => {
  const s = Q.getStats({}, pm);
  const sum = Object.values(s.counts).reduce((a, b) => a + b, 0);
  assert.strictEqual(sum, 992);
  assert.strictEqual(s.summary.total, 992);
  assert.strictEqual(s.summary.employed + s.summary.self_employed + s.summary.unemployed + s.summary.not_reported, 992);
  for (const grp of ['track', 'campus', 'officer']) {
    const b = Q.getBreakdown(grp, {}, admin);
    assert.strictEqual(b.reduce((a, r) => a + r.total, 0), 992, grp);
  }
  assert.strictEqual(Q.getBreakdown('track', {}, admin).length, 5);
  assert.strictEqual(Q.getBreakdown('campus', {}, admin).length, 9);
  assert.strictEqual(Q.getBreakdown('officer', {}, admin).length, 40);
  assert.strictEqual(Q.getBreakdown('nonsense', {}, admin), null);
});

test('notifications: 3-day offer reminder, 3-day and 1-day interview reminders, to officer + admin, no duplicates', () => {
  db.exec('DELETE FROM notifications; DELETE FROM employment_records;');
  const gs = db.prepare('SELECT id, officer_id FROM graduates WHERE officer_id = ? LIMIT 4').all(po1.id);
  const ins = db.prepare('INSERT INTO employment_records (graduate_id, recorded_by, report_date, status, expected_offer_date, interview_date) VALUES (?,?,?,?,?,?)');
  ins.run(gs[0].id, po1.id, today(), 6, addDays(3), null); // offer in 3 days -> notify
  ins.run(gs[1].id, po1.id, today(), 6, addDays(5), null); // too early -> nothing
  ins.run(gs[2].id, po1.id, today(), 3, null, addDays(3)); // interview in 3 days
  ins.run(gs[3].id, po1.id, today(), 3, null, addDays(1)); // interview tomorrow
  const first = runNotifications();
  assert.strictEqual(first, 6); // 3 records x (officer + admin)
  assert.strictEqual(runNotifications(), 0); // idempotent
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=?').get(po1.id).n, 3);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=?').get(admin.id).n, 3);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=?').get(pm.id).n, 0);
  // the date gets closer for the 3-day interview -> second (1-day) reminder
  db.prepare('UPDATE employment_records SET interview_date=? WHERE graduate_id=?').run(addDays(1), gs[2].id);
  assert.strictEqual(runNotifications(), 2);
  // moving on from the status (passed -> secured) stops reminders
  ins.run(gs[1].id, po1.id, addDays(1), 7, null, null);
  db.prepare('UPDATE employment_records SET expected_offer_date=? WHERE graduate_id=? AND status=6').run(addDays(2), gs[1].id);
  assert.strictEqual(runNotifications(), 0);
});

console.log(`\n${passed} test groups passed`);
fs.rmSync(tmp, { recursive: true, force: true });
