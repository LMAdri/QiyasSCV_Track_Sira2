'use strict';
/*
 * Creates the admin, a project-manager account and the 40 project-officer accounts (idempotent).
 *   npm run seed         -> accounts only
 *   npm run seed:demo    -> accounts + 992 FAKE graduates and random employment reports (for trying the system out)
 *
 * Env: ADMIN_PASSWORD (otherwise a random one is generated and printed once)
 *      DEFAULT_PASSWORD (initial password for officers / PM, default "ChangeMe@123"; changed at first login)
 */
const { db, tx } = require('./db');
const { hashPassword, randomPassword } = require('./lib/security');
const C = require('./lib/constants');
const { validateGraduate, validateRecord } = require('./lib/validate');
const { today } = require('./lib/util');

const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || 'ChangeMe@123';

function ensureUser(username, fullName, role, password) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return { id: existing.id, created: false };
  const r = db.prepare('INSERT INTO users (username, full_name, role, password_hash, must_change_password) VALUES (?,?,?,?,1)')
    .run(username, fullName, role, hashPassword(password));
  return { id: Number(r.lastInsertRowid), created: true };
}

function seedAccounts() {
  const out = [];
  const adminPw = process.env.ADMIN_PASSWORD || randomPassword();
  const a = ensureUser('admin', 'System Administrator', 'admin', adminPw);
  if (a.created) out.push(`admin   / ${adminPw}   (change at first login)`);
  const pm = ensureUser('pm', 'Project Manager', 'pm', DEFAULT_PASSWORD);
  if (pm.created) out.push(`pm      / ${DEFAULT_PASSWORD}`);
  let n = 0;
  for (let i = 1; i <= 40; i++) {
    const u = 'po' + String(i).padStart(2, '0');
    if (ensureUser(u, `Project Officer ${String(i).padStart(2, '0')}`, 'officer', DEFAULT_PASSWORD).created) n++;
  }
  if (n) out.push(`po01..po40 (${n} created) / ${DEFAULT_PASSWORD}   (change at first login)`);
  return out;
}

function seedDemo() {
  if (db.prepare('SELECT COUNT(*) n FROM graduates').get().n > 0) {
    console.log('Graduates already exist - skipping demo data.');
    return;
  }
  const officers = db.prepare("SELECT id FROM users WHERE role='officer' ORDER BY username").all().map((o) => o.id);
  const first = ['Abel', 'Hanna', 'Dawit', 'Selam', 'Yonas', 'Meron', 'Kidus', 'Bethel', 'Samuel', 'Tigist', 'Nahom', 'Rediet', 'Henok', 'Mahlet', 'Biniam', 'Saron', 'Eyob', 'Lidya', 'Amanuel', 'Hiwot'];
  const fathers = ['Tesfaye', 'Alemu', 'Bekele', 'Girma', 'Hailu', 'Kebede', 'Mulugeta', 'Negash', 'Tadesse', 'Wondimu', 'Assefa', 'Desta'];
  const cities = ['Addis Ababa', 'Dessie', 'Hossana', 'Adama', 'Bahir Dar'];
  const companies = ['Sunrise Tech PLC', 'Blue Nile Solutions', 'Habesha Digital', 'Abay Media', 'Zemen IT Services', 'Lalibela Design Studio'];
  const rnd = (n) => Math.floor(Math.random() * n);
  const pick = (a) => a[rnd(a.length)];
  const d = (offset) => { const x = new Date(Date.now() + offset * 86400000); return x.toISOString().slice(0, 10); };

  let made = 0;
  tx(() => {
    for (let i = 0; i < 992; i++) {
      const campus = C.CAMPUSES[i % C.CAMPUSES.length];
      const edu = pick(C.EDUCATION);
      const { errors, data } = validateGraduate({
        first_name: pick(first), father_name: pick(fathers), grandfather_name: pick(fathers),
        track: C.TRACKS[i % 5], gender: rnd(2) ? 'Male' : 'Female', phone: '09' + String(10000000 + rnd(89999999)),
        campus: campus.name, prev_education: edu,
        field_of_study: 'Information Technology', tvet_field: 'ICT Support',
        idp: rnd(15) === 0, disability: rnd(30) === 0, returnee: rnd(20) === 0,
        worked_as_intern: rnd(4) === 0, intern_company: pick(companies), intern_description: 'Assisted the IT team',
        officer_id: officers[i % 40],
      });
      if (errors.length) throw new Error(errors.join('; '));
      const cols = Object.keys(data);
      const r = db.prepare(`INSERT INTO graduates (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
        .run(...cols.map((c) => data[c]));
      made++;
      if (rnd(10) < 7) {
        const status = 1 + rnd(10);
        const { errors: re, data: rd } = validateRecord({
          status, report_date: d(-rnd(20)), status_detail: 'Demo entry',
          company_name: pick(companies), company_description: 'Demo company', company_city: pick(cities),
          company_location: 'Bole', contact_person: 'Ato Demo', company_tel: '0911000000', position: 'Junior staff',
          salary: 8000 + rnd(20000), application_date: d(-5), interview_date: d(rnd(6)),
          expected_offer_date: d(rnd(6)), offer_received_date: d(-3),
        });
        if (re.length) throw new Error(re.join('; '));
        const rc = Object.keys(rd);
        db.prepare(`INSERT INTO employment_records (graduate_id, recorded_by, ${rc.join(',')}) VALUES (?,?,${rc.map(() => '?').join(',')})`)
          .run(Number(r.lastInsertRowid), officers[i % 40], ...rc.map((c) => rd[c]));
      }
    }
  });
  console.log(`Demo data created: ${made} fake graduates (today is ${today()}).`);
}

if (require.main === module) {
  const lines = seedAccounts();
  if (lines.length) {
    console.log('\nAccounts created - note these now (shown only once):');
    lines.forEach((l) => console.log('  ' + l));
  } else {
    console.log('All accounts already exist.');
  }
  if (process.argv.includes('--demo')) seedDemo();
}

module.exports = { ensureUser, seedAccounts, seedDemo };
