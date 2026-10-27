'use strict';
/*
 * Exercises the REAL route handlers and middleware (server/index.js) without needing the npm packages:
 * express / multer / helmet / exceljs / pdfkit are replaced by tiny in-memory stand-ins, so this checks the
 * application's own logic (permissions, validation, files, notifications), not the third-party libraries.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const Module = require('module');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'get-routes-'));
process.env.DATA_DIR = tmp;
process.env.DB_FILE = ':memory:';
process.env.ADMIN_PASSWORD = 'Admin@12345';
process.env.DEFAULT_PASSWORD = 'ChangeMe@123';

// ---------------- minimal express stand-in ----------------
function compile(p) {
  const keys = [];
  const re = new RegExp('^' + p.replace(/:([A-Za-z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  return { re, keys };
}
function makeRouter() {
  const layers = [];
  function router(req, res, out) {
    let i = 0;
    const origUrl = req.url;
    function next(err) {
      if (i >= layers.length) { req.url = origUrl; return out(err); }
      const L = layers[i++];
      let restore;
      try {
        if (L.use) {
          if (L.path !== '/') {
            const u = req.url;
            if (!(u === L.path || u.startsWith(L.path + '/'))) return next(err);
            restore = u; req.url = u.slice(L.path.length) || '/';
          }
          const done = (e) => { if (restore !== undefined) req.url = restore; next(e); };
          if (err) return L.h.length === 4 ? L.h(err, req, res, done) : done(err);
          if (L.h.length === 4) return done();
          return L.h(req, res, done);
        }
        if (err) return next(err);
        if (L.method !== req.method) return next();
        const m = L.re.exec(req.url);
        if (!m) return next();
        req.params = {};
        L.keys.forEach((k, j) => { req.params[k] = decodeURIComponent(m[j + 1]); });
        return L.h(req, res, next);
      } catch (e) {
        if (restore !== undefined) req.url = restore;
        return next(e);
      }
    }
    next();
  }
  router.use = (...a) => { let p = '/'; if (typeof a[0] === 'string') p = a.shift(); a.forEach((h) => layers.push({ use: true, path: p, h })); };
  ['get', 'post', 'put', 'delete'].forEach((m) => {
    router[m] = (p, ...hs) => { const c = compile(p); hs.forEach((h) => layers.push({ method: m.toUpperCase(), ...c, h })); };
  });
  return router;
}
const passthrough = () => (req, res, next) => next();
function expressStub() {
  const app = makeRouter();
  app.disable = () => {}; app.set = () => {};
  app.listen = (port, host, cb) => { if (cb) cb(); };
  return app;
}
expressStub.Router = makeRouter;
expressStub.json = passthrough;
expressStub.static = passthrough;
function multerStub() { return { single: () => (req, res, next) => next() }; }
multerStub.memoryStorage = () => ({});
multerStub.MulterError = class MulterError extends Error {};
const STUBS = {
  express: expressStub, multer: multerStub, helmet: passthrough,
  exceljs: { Workbook: class {} }, pdfkit: function PDFDocument() {},
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (STUBS[request]) return STUBS[request];
  return origLoad.apply(this, arguments);
};
let appInstance;
const origExpress = STUBS.express;
STUBS.express = Object.assign(function () { appInstance = origExpress(); return appInstance; }, origExpress);

const logs = [];
const origLog = console.log; console.log = (...a) => logs.push(a.join(' '));
require('../server/index.js');
console.log = origLog;

const { db } = require('../server/db');
const { today } = require('../server/lib/util');
const addDays = (n) => new Date(Date.parse(today() + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// ---------------- request helper ----------------
function call(who, method, url, { body, file } = {}) {
  return new Promise((resolve) => {
    const [pathname, qstr] = url.split('?');
    const req = {
      method: method.toUpperCase(), url: pathname, originalUrl: url, headers: { cookie: who?.cookie || '' },
      body: body || {}, query: Object.fromEntries(new URLSearchParams(qstr || '')), ip: who?.ip || '10.0.0.1', file,
    };
    const res = {
      statusCode: 200, headers: {}, headersSent: false,
      status(c) { this.statusCode = c; return this; },
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      json(o) { this.body = o; resolve(this); return this; },
      end() { resolve(this); }, sendFile(p) { this.file = p; resolve(this); },
    };
    appInstance(req, res, (err) => { res.statusCode = err ? 500 : 404; res.body = { error: err ? String(err) : 'no route' }; resolve(res); });
  });
}
async function login(username, password, ip) {
  const who = { ip: ip || '10.0.0.1' };
  const r = await call(who, 'POST', '/api/auth/login', { body: { username, password } });
  if (r.statusCode === 200) who.cookie = String(r.headers['set-cookie']).split(';')[0];
  who.res = r;
  return who;
}
const relog = (who, r) => { who.cookie = String(r.headers['set-cookie']).split(';')[0]; };

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };

(async () => {
  await test('first run created accounts and printed the admin password once', () => {
    assert(logs.join('\n').includes('admin   / Admin@12345'));
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM users').get().n, 42);
  });

  const anon = {};
  await test('API requires sign-in; static meta blocked', async () => {
    assert.strictEqual((await call(anon, 'GET', '/api/meta')).statusCode, 401);
    assert.strictEqual((await call(anon, 'GET', '/api/graduates')).statusCode, 401);
    assert.strictEqual((await call({ cookie: 'token=garbage' }, 'GET', '/api/meta')).statusCode, 401);
  });

  await test('login: wrong password rejected, lockout after repeated failures, right password works', async () => {
    assert.strictEqual((await login('po01', 'nope')).res.statusCode, 401);
    assert.strictEqual((await login('ghost', 'nope')).res.statusCode, 401);
    for (let i = 0; i < 25; i++) await login('po39', 'wrong', '10.9.9.9');
    assert.strictEqual((await login('po39', 'ChangeMe@123', '10.9.9.9')).res.statusCode, 429);
    const ok = await login('po01', 'ChangeMe@123');
    assert.strictEqual(ok.res.statusCode, 200);
    assert.strictEqual(ok.res.body.user.must_change_password, true);
    assert(String(ok.res.headers['set-cookie']).includes('HttpOnly'));
  });

  // ---- forced password change at first login ----
  const po1 = await login('po01', 'ChangeMe@123');
  await test('first login: everything is blocked until the default password is changed', async () => {
    const r = await call(po1, 'GET', '/api/meta');
    assert.strictEqual(r.statusCode, 403);
    assert.strictEqual(r.body.code, 'PASSWORD_CHANGE_REQUIRED');
    assert.strictEqual((await call(po1, 'GET', '/api/auth/me')).statusCode, 200);
    assert.strictEqual((await call(po1, 'POST', '/api/auth/change-password', { body: { current_password: 'bad', new_password: 'Newpass123' } })).statusCode, 400);
    assert.strictEqual((await call(po1, 'POST', '/api/auth/change-password', { body: { current_password: 'ChangeMe@123', new_password: 'short' } })).statusCode, 400);
    assert.strictEqual((await call(po1, 'POST', '/api/auth/change-password', { body: { current_password: 'ChangeMe@123', new_password: 'ChangeMe@123' } })).statusCode, 400);
    const stale = { cookie: po1.cookie };
    const r2 = await call(po1, 'POST', '/api/auth/change-password', { body: { current_password: 'ChangeMe@123', new_password: 'Officer#2026' } });
    assert.strictEqual(r2.statusCode, 200);
    relog(po1, r2);
    assert.strictEqual((await call(po1, 'GET', '/api/meta')).statusCode, 200);
    assert.strictEqual((await call(stale, 'GET', '/api/meta')).statusCode, 401, 'old session must be invalidated');
    assert.strictEqual((await login('po01', 'ChangeMe@123')).res.statusCode, 401, 'old default password no longer works');
  });

  // finish the first-login change for the other accounts used below
  async function ready(username, defaultPw, newPw, ip) {
    const w = await login(username, defaultPw, ip);
    const r = await call(w, 'POST', '/api/auth/change-password', { body: { current_password: defaultPw, new_password: newPw } });
    relog(w, r); return w;
  }
  const admin = await ready('admin', 'Admin@12345', 'Admin#2026x', '10.0.1.1');
  const po2 = await ready('po02', 'ChangeMe@123', 'Officer#2026', '10.0.1.2');
  const pm = await ready('pm', 'ChangeMe@123', 'Manager#2026', '10.0.1.3');
  const officers = (await call(admin, 'GET', '/api/meta')).body.officers;
  const o1 = officers.find((o) => o.username === 'po01'); const o2 = officers.find((o) => o.username === 'po02');

  const gradBody = (over = {}) => ({
    first_name: 'Abel', father_name: 'Tesfaye', grandfather_name: 'Alemu', track: 'Web & Enterprise Application Development', gender: 'Male',
    phone: '0911223344', campus: 'Selam', prev_education: "Bachelor's degree", field_of_study: 'CS', officer_id: o1.id, ...over,
  });
  let g1; let g2;

  await test('only the admin can create / edit / delete graduates; duplicates and bad data rejected', async () => {
    assert.strictEqual((await call(po1, 'POST', '/api/graduates', { body: gradBody() })).statusCode, 403);
    assert.strictEqual((await call(pm, 'POST', '/api/graduates', { body: gradBody() })).statusCode, 403);
    const bad = await call(admin, 'POST', '/api/graduates', { body: gradBody({ track: 'Cooking', phone: 'x' }) });
    assert.strictEqual(bad.statusCode, 400);
    const ok = await call(admin, 'POST', '/api/graduates', { body: gradBody() });
    assert.strictEqual(ok.statusCode, 201); g1 = ok.body.id;
    assert.strictEqual((await call(admin, 'POST', '/api/graduates', { body: gradBody() })).statusCode, 409);
    const ok2 = await call(admin, 'POST', '/api/graduates', { body: gradBody({ first_name: 'Hanna', phone: '0922334455', officer_id: o2.id, prev_education: 'TVET Level 3', tvet_field: 'ICT', gender: 'Female' }) });
    g2 = ok2.body.id;
    assert.strictEqual((await call(po1, 'PUT', `/api/graduates/${g1}`, { body: gradBody({ first_name: 'Hacked' }) })).statusCode, 403);
    assert.strictEqual((await call(po1, 'DELETE', `/api/graduates/${g1}`)).statusCode, 403);
    assert.strictEqual((await call(admin, 'PUT', `/api/graduates/${g1}`, { body: gradBody({ other_info: 'updated' }) })).statusCode, 200);
    assert.strictEqual((await call(admin, 'GET', `/api/graduates/${g1}`)).body.graduate.other_info, 'updated');
  });

  await test('officers only see their own graduates; PM and admin see all', async () => {
    const l1 = (await call(po1, 'GET', '/api/graduates')).body;
    assert(l1.rows.every((r) => r.officer_id === o1.id) && l1.total === 1);
    assert.strictEqual((await call(po1, 'GET', `/api/graduates/${g2}`)).statusCode, 404);
    assert.strictEqual((await call(po1, 'GET', `/api/graduates?officer_id=${o2.id}`)).body.total, 1, 'cannot widen scope via query');
    assert.strictEqual((await call(pm, 'GET', '/api/graduates')).body.total, 2);
    assert.strictEqual((await call(pm, 'GET', `/api/graduates/${g2}`)).statusCode, 200);
  });

  let rec1;
  await test('officer records employment: validation per status, own graduates only, PM cannot write', async () => {
    const base = { graduate_id: g1, report_date: today(), status: 2, company_name: 'ACME', company_city: 'Addis Ababa', contact_person: 'Ato X', company_tel: '0911', company_description: 'IT firm' };
    assert.strictEqual((await call(po1, 'POST', '/api/records', { body: { ...base, graduate_id: g2 } })).statusCode, 403);
    assert.strictEqual((await call(pm, 'POST', '/api/records', { body: base })).statusCode, 403);
    assert.strictEqual((await call(po1, 'POST', '/api/records', { body: { ...base, status: 3 } })).statusCode, 400);
    assert.strictEqual((await call(po1, 'POST', '/api/records', { body: { ...base, status: 6 } })).statusCode, 400);
    assert.strictEqual((await call(po1, 'POST', '/api/records', { body: { ...base, company_name: '' } })).statusCode, 400);
    assert.strictEqual((await call(po1, 'POST', '/api/records', { body: { ...base, graduate_id: 99999 } })).statusCode, 404);
    const r = await call(po1, 'POST', '/api/records', { body: { ...base, report_date: addDays(-3), application_date: addDays(-3) } });
    assert.strictEqual(r.statusCode, 201); rec1 = r.body.id;
    const st = (await call(po1, 'GET', '/api/graduates')).body.rows[0];
    assert.strictEqual(st.status, 2);
    // a date range report
    const rr = await call(po1, 'POST', '/api/records', { body: { ...base, status: 1, report_date: addDays(-2), report_date_end: addDays(-1) } });
    assert.strictEqual(rr.statusCode, 201);
    assert.strictEqual((await call(po1, 'POST', '/api/records', { body: { ...base, status: 1, report_date: addDays(-2), report_date_end: addDays(-9) } })).statusCode, 400);
  });

  await test('interview / expected-offer reminders reach officer and admin (not PM)', async () => {
    const r1 = await call(po1, 'POST', '/api/records', { body: { graduate_id: g1, report_date: today(), status: 3, company_name: 'ACME', interview_date: addDays(3) } });
    assert.strictEqual(r1.statusCode, 201);
    const n1 = (await call(po1, 'GET', '/api/notifications')).body;
    assert.strictEqual(n1.unread, 1);
    assert(n1.rows[0].message.includes('Abel') && n1.rows[0].kind === 'interview');
    assert.strictEqual((await call(admin, 'GET', '/api/notifications')).body.unread, 1);
    assert.strictEqual((await call(pm, 'GET', '/api/notifications')).body.unread, 0);
    assert.strictEqual((await call(po2, 'GET', '/api/notifications')).body.unread, 0);
    // user can only mark their own notification as read
    const nid = n1.rows[0].id;
    await call(po2, 'POST', `/api/notifications/${nid}/read`);
    assert.strictEqual((await call(po1, 'GET', '/api/notifications/count')).body.unread, 1);
    await call(po1, 'POST', `/api/notifications/${nid}/read`);
    assert.strictEqual((await call(po1, 'GET', '/api/notifications/count')).body.unread, 0);
    const r2 = await call(po1, 'POST', '/api/records', { body: { graduate_id: g1, report_date: addDays(1), status: 6, company_name: 'ACME', expected_offer_date: addDays(2) } });
    assert.strictEqual(r2.statusCode, 201);
    const n2 = (await call(po1, 'GET', '/api/notifications')).body;
    assert(n2.rows.some((n) => n.kind === 'offer'));
    await call(po1, 'POST', '/api/notifications/read-all');
    assert.strictEqual((await call(po1, 'GET', '/api/notifications/count')).body.unread, 0);
  });

  await test('offer letter PDF: only for status 7, must be a real PDF, access-controlled, removed on status change', async () => {
    const pdf = { buffer: Buffer.from('%PDF-1.4\n%fake\n'), originalname: 'My Offer (final).pdf' };
    const base = { graduate_id: g1, report_date: addDays(2), status: 7, company_name: 'ACME', position: 'Dev', salary: '15,000', offer_received_date: today() };
    assert.strictEqual((await call(po1, 'POST', '/api/records', { body: { ...base, status: 2 }, file: pdf })).statusCode, 400, 'wrong status');
    assert.strictEqual((await call(po1, 'POST', '/api/records', { body: base, file: { buffer: Buffer.from('MZ\x90 not pdf'), originalname: 'x.pdf' } })).statusCode, 400, 'not a pdf');
    const r = await call(po1, 'POST', '/api/records', { body: base, file: pdf });
    assert.strictEqual(r.statusCode, 201);
    const id = r.body.id;
    const row = db.prepare('SELECT * FROM employment_records WHERE id=?').get(id);
    assert.strictEqual(row.salary, 15000);
    assert(/^[0-9a-f]{32}\.pdf$/.test(row.offer_letter_file));
    const file = path.join(tmp, 'uploads', row.offer_letter_file);
    assert(fs.existsSync(file));
    const dl = await call(po1, 'GET', `/api/records/${id}/offer-letter`);
    assert.strictEqual(dl.file, file); assert.strictEqual(dl.headers['content-type'], 'application/pdf');
    assert.strictEqual((await call(po2, 'GET', `/api/records/${id}/offer-letter`)).statusCode, 403);
    assert.strictEqual((await call(pm, 'GET', `/api/records/${id}/offer-letter`)).statusCode, 200);
    assert.strictEqual((await call(po2, 'PUT', `/api/records/${id}`, { body: { ...base, company_name: 'Hijack' } })).statusCode, 403);
    // editing to a different status drops the attachment
    const up = await call(po1, 'PUT', `/api/records/${id}`, { body: { ...base, status: 9 } });
    assert.strictEqual(up.statusCode, 200);
    await new Promise((r2) => setTimeout(r2, 50));
    assert(!fs.existsSync(file), 'file should be deleted');
    assert.strictEqual(db.prepare('SELECT offer_letter_file f FROM employment_records WHERE id=?').get(id).f, null);
  });

  await test('reports & stats: admin/PM only; export admin only; officer scoped stats', async () => {
    assert.strictEqual((await call(po1, 'GET', '/api/reports')).statusCode, 403);
    assert.strictEqual((await call(po1, 'GET', '/api/reports/secured')).statusCode, 403);
    assert.strictEqual((await call(pm, 'GET', '/api/reports/secured/export?format=xlsx')).statusCode, 403);
    const list = (await call(pm, 'GET', '/api/reports')).body.reports;
    assert.strictEqual(list.length, 12);
    for (const r of list) {
      const out = await call(admin, 'GET', `/api/reports/${r.key}?page=1`);
      assert.strictEqual(out.statusCode, 200, r.key);
    }
    assert.strictEqual((await call(admin, 'GET', '/api/reports/nope')).statusCode, 404);
    const working = (await call(admin, 'GET', '/api/reports/working')).body;
    assert.strictEqual(working.total, 1); assert.strictEqual(working.rows[0].company_name, 'ACME');
    assert.strictEqual((await call(admin, 'GET', `/api/reports/working?officer_id=${o2.id}`)).body.total, 0);
    const s = (await call(admin, 'GET', '/api/stats')).body.summary;
    assert.strictEqual(s.total, 2); assert.strictEqual(s.employed, 1); assert.strictEqual(s.not_reported, 1);
    assert.strictEqual((await call(po1, 'GET', '/api/stats')).body.summary.total, 1, 'officer sees own numbers only');
    assert.strictEqual((await call(admin, 'GET', '/api/stats/breakdown?group=officer')).body.rows.length, 2);
    assert.strictEqual((await call(admin, 'GET', '/api/stats/breakdown?group=bogus')).statusCode, 400);
  });

  await test('user management: admin only; temp passwords; deactivate signs the user out', async () => {
    assert.strictEqual((await call(po1, 'GET', '/api/users')).statusCode, 403);
    assert.strictEqual((await call(pm, 'POST', '/api/users', { body: { username: 'x1', full_name: 'X', role: 'admin' } })).statusCode, 403);
    assert.strictEqual((await call(admin, 'POST', '/api/users', { body: { username: 'po01', full_name: 'Dup', role: 'officer' } })).statusCode, 409);
    assert.strictEqual((await call(admin, 'POST', '/api/users', { body: { username: 'a b', full_name: 'Bad', role: 'officer' } })).statusCode, 400);
    const c = await call(admin, 'POST', '/api/users', { body: { username: 'po41', full_name: 'Officer 41', role: 'officer' } });
    assert.strictEqual(c.statusCode, 201); assert(c.body.temp_password.length >= 10);
    const w = await login('po41', c.body.temp_password, '10.0.2.1');
    assert.strictEqual(w.res.body.user.must_change_password, true);
    const reset = await call(admin, 'POST', `/api/users/${c.body.user.id}/reset-password`, { body: {} });
    assert.strictEqual(reset.statusCode, 200);
    assert.strictEqual((await call(w, 'GET', '/api/auth/me')).statusCode, 401, 'reset signs the user out');
    const adminId = db.prepare("SELECT id FROM users WHERE username='admin'").get().id;
    assert.strictEqual((await call(admin, 'PUT', `/api/users/${adminId}`, { body: { active: false } })).statusCode, 400, 'cannot deactivate yourself');
    assert.strictEqual((await call(admin, 'PUT', `/api/users/${o1.id}`, { body: { role: 'pm' } })).statusCode, 400, 'officer with graduates cannot change role');
    assert.strictEqual((await call(admin, 'PUT', `/api/users/${o1.id}`, { body: { active: false } })).statusCode, 200);
    assert.strictEqual((await call(po1, 'GET', '/api/meta')).statusCode, 401, 'deactivated user is signed out');
    assert.strictEqual((await login('po01', 'Officer#2026', '10.0.3.1')).res.statusCode, 401);
  });
  console.log(`\n${passed} route test groups passed`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
