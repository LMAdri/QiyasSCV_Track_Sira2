'use strict';
/* Core helpers, API wrapper, modal/toast, login, password change and the app shell. */
const PAGES = {};
let me = null;
let meta = null;
const timers = [];

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = (n) => Number(n || 0).toLocaleString('en-US');
const pct = (n, t) => (t ? ((n * 100) / t).toFixed(1) + '%' : '0%');
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date());
const qs = (o) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined) p.set(k, v); });
  return p.toString();
};
const opts = (list, sel, placeholder) =>
  (placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : '') +
  list.map((x) => {
    const v = typeof x === 'object' ? x.value : x;
    const l = typeof x === 'object' ? x.label : x;
    return `<option value="${esc(v)}"${String(v) === String(sel ?? '') ? ' selected' : ''}>${esc(l)}</option>`;
  }).join('');
const officerOpts = (sel, placeholder = 'All project officers') =>
  opts((meta?.officers || []).map((o) => ({ value: o.id, label: `${o.full_name} (${o.username})` })), sel, placeholder);

function stopTimers() { while (timers.length) clearInterval(timers.pop()); }

async function api(path, { method = 'GET', body, form } = {}) {
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if (form) opt.body = form;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch('/api' + path, opt);
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login')) { me = null; showLogin('Your session has ended. Please sign in again.'); }
    if (data?.code === 'PASSWORD_CHANGE_REQUIRED') showChangePassword(true);
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.details = data?.details;
    throw err;
  }
  return data;
}

function toast(msg, isErr) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), isErr ? 7000 : 3500);
}

function modal(title, content, { wide = false, onClose } = {}) {
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">&times;</button></div>
    <div class="modal-body"></div></div>`;
  const body = $('.modal-body', o);
  if (typeof content === 'string') body.innerHTML = content; else body.append(content);
  const close = () => { document.removeEventListener('keydown', onKey); o.remove(); if (onClose) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  o.addEventListener('mousedown', (e) => { if (e.target === o) close(); });
  $('[data-close]', o).addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(o);
  return { el: o, body, close };
}

function showError(el, msg) {
  let box = $('.error', el);
  if (!msg) { if (box) box.remove(); return; }
  if (!box) { box = document.createElement('div'); box.className = 'error'; box.setAttribute('role', 'alert'); el.prepend(box); }
  box.textContent = msg;
}

async function withBusy(btn, fn) {
  btn.disabled = true;
  try { return await fn(); } finally { btn.disabled = false; }
}

// ---------------- auth screens ----------------
function showLogin(message) {
  stopTimers();
  $('#app').innerHTML = `<div class="auth-box"><div class="card">
    <h2>Graduate Employment Tracker</h2>
    <p class="muted small">Qiyas SCV Intermediate Digital Skills training</p>
    ${message ? `<div class="notice">${esc(message)}</div>` : ''}
    <form id="loginForm" autocomplete="on">
      <p><label for="u">Username</label><input id="u" name="username" autocomplete="username" required autofocus></p>
      <p><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required></p>
      <button class="primary" style="width:100%">Sign in</button>
      <p class="muted small">Forgot your password? Ask the system administrator to reset it.</p>
    </form></div></div>`;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; const btn = $('button', f);
    showError(f);
    await withBusy(btn, async () => {
      try {
        const r = await api('/auth/login', { method: 'POST', body: { username: f.username.value, password: f.password.value } });
        me = r.user;
        if (me.must_change_password) showChangePassword(true); else boot();
      } catch (err) { showError(f, err.message); }
    });
  });
}

function showChangePassword(forced) {
  stopTimers();
  const box = document.createElement('div');
  box.className = 'auth-box';
  box.innerHTML = `<div class="card"><h2>${forced ? 'Set a new password' : 'Change password'}</h2>
    ${forced ? '<div class="notice">For security you must replace your default password before continuing.</div>' : ''}
    <form id="pwForm">
      <p><label for="cp">Current password</label><input id="cp" type="password" name="current_password" autocomplete="current-password" required></p>
      <p><label for="np">New password</label><input id="np" type="password" name="new_password" autocomplete="new-password" required minlength="8">
        <span class="muted small">At least 8 characters, with letters and numbers.</span></p>
      <p><label for="np2">Confirm new password</label><input id="np2" type="password" name="confirm" autocomplete="new-password" required></p>
      <button class="primary">Save password</button>
      ${forced ? '<button type="button" id="pwOut" class="link" style="margin-left:1rem">Sign out</button>' : '<button type="button" id="pwCancel" style="margin-left:.5rem">Cancel</button>'}
    </form></div>`;
  if (forced) $('#app').replaceChildren(box); else { $('#app').replaceChildren(box); }
  const f = $('#pwForm', box);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(f);
    if (f.new_password.value !== f.confirm.value) return showError(f, 'The two new passwords do not match');
    await withBusy($('button.primary', f), async () => {
      try {
        const r = await api('/auth/change-password', { method: 'POST', body: { current_password: f.current_password.value, new_password: f.new_password.value } });
        me = r.user; toast('Password changed'); boot();
      } catch (err) { showError(f, err.message); }
    });
  });
  const out = $('#pwOut', box); if (out) out.addEventListener('click', logout);
  const cancel = $('#pwCancel', box); if (cancel) cancel.addEventListener('click', () => boot());
}

async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch (_) { /* ignore */ }
  me = null; meta = null; showLogin();
}

// ---------------- shell + router ----------------
const NAV = {
  admin: [['dashboard', 'Dashboard'], ['reports', 'Reports'], ['graduates', 'Graduates'], ['record', 'Record employment'], ['submissions', 'All reports'], ['users', 'Users'], ['notifications', 'Notifications']],
  pm: [['dashboard', 'Dashboard'], ['reports', 'Reports'], ['graduates', 'Graduates'], ['notifications', 'Notifications']],
  officer: [['record', 'Record employment'], ['graduates', 'My graduates'], ['submissions', 'My reports'], ['notifications', 'Notifications']],
};
const ROLE_NAME = { admin: 'Administrator', pm: 'Project manager', officer: 'Project officer' };

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = h.split('?');
  return { page: path.replace(/^\//, ''), params: Object.fromEntries(new URLSearchParams(query)) };
}

async function route() {
  if (!me || !meta) return;
  stopTimers();
  let { page, params } = parseHash();
  const allowed = NAV[me.role].map((n) => n[0]);
  if (!allowed.includes(page)) { page = allowed[0]; location.replace('#/' + page); return; }
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  const content = $('#content');
  content.innerHTML = '<p class="muted">Loading&hellip;</p>';
  try { await PAGES[page](content, params); } catch (e) {
    content.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}

async function refreshBell() {
  try {
    const { unread } = await api('/notifications/count');
    const b = $('#bellBadge');
    if (b) { b.textContent = unread; b.hidden = !unread; }
  } catch (_) { /* ignore */ }
}

async function boot() {
  try {
    if (!me) me = (await api('/auth/me')).user;
  } catch (_) { return showLogin(); }
  if (me.must_change_password) return showChangePassword(true);
  try { meta = await api('/meta'); } catch (e) { return showLogin(e.message); }
  $('#app').innerHTML = `<header class="topbar">
      <span class="brand">Graduate Employment Tracker</span>
      <nav class="nav">${NAV[me.role].map(([p, l]) => `<a href="#/${p}" data-page="${p}">${esc(l)}</a>`).join('')}</nav>
      <div class="userbox">
        <button class="bell" id="bell" title="Notifications" aria-label="Notifications">&#128276;<span class="badge" id="bellBadge" hidden>0</span></button>
        <span>${esc(me.full_name)} <span class="small" style="opacity:.7">(${ROLE_NAME[me.role]})</span></span>
        <button id="chpw">Password</button><button id="logoutBtn">Sign out</button>
      </div></header><main id="content"></main>`;
  $('#bell').addEventListener('click', () => { location.hash = '#/notifications'; });
  $('#chpw').addEventListener('click', () => showChangePassword(false));
  $('#logoutBtn').addEventListener('click', logout);
  refreshBell();
  window.__bellTimer && clearInterval(window.__bellTimer);
  window.__bellTimer = setInterval(() => { if (me) refreshBell(); }, 30000);
  if (!location.hash || location.hash === '#/') location.replace('#/' + NAV[me.role][0][0]);
  route();
}

window.addEventListener('hashchange', route);
