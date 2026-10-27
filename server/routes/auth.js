'use strict';
const express = require('express');
const { db } = require('../db');
const sec = require('../lib/security');
const { auth, setSession, clearSession } = require('../middleware');

const router = express.Router();

const publicUser = (u) => ({
  id: u.id, username: u.username, full_name: u.full_name, role: u.role,
  must_change_password: !!u.must_change_password,
});

router.post('/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const key = `${req.ip}|${username.toLowerCase()}`;
  if (sec.loginBlocked(key)) {
    return res.status(429).json({ error: 'Too many failed attempts. Please wait 15 minutes and try again.' });
  }
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  // Always run a hash comparison so response time does not reveal whether the username exists.
  const ok = u ? sec.verifyPassword(password, u.password_hash) : sec.verifyPassword(password, 'scrypt$00$00');
  if (!u || !u.active || !ok) {
    sec.loginFailed(key);
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  sec.loginSucceeded(key);
  setSession(res, u);
  res.json({ user: publicUser(u) });
});

router.use(auth);

router.get('/me', (req, res) => res.json({ user: publicUser(req.user) }));

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.post('/change-password', (req, res) => {
  const current = String(req.body?.current_password || '');
  const next = String(req.body?.new_password || '');
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!sec.verifyPassword(current, row.password_hash)) return res.status(400).json({ error: 'Current password is incorrect' });
  const problem = sec.passwordProblem(next);
  if (problem) return res.status(400).json({ error: problem });
  if (next === current) return res.status(400).json({ error: 'New password must be different from the current one' });
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, token_version = token_version + 1 WHERE id = ?')
    .run(sec.hashPassword(next), req.user.id);
  // token_version changed, so re-issue this session's cookie; all other sessions are signed out.
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  setSession(res, fresh);
  res.json({ user: publicUser(fresh) });
});

module.exports = router;
