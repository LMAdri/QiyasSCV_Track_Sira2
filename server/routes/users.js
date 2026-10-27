'use strict';
const express = require('express');
const { db } = require('../db');
const sec = require('../lib/security');
const { allow } = require('../middleware');
const { str } = require('../lib/util');

const router = express.Router();
router.use(allow('admin'));

const SELECT = `SELECT u.id, u.username, u.full_name, u.role, u.active, u.must_change_password, u.created_at,
  (SELECT COUNT(*) FROM graduates g WHERE g.officer_id = u.id) AS graduate_count FROM users u`;

router.get('/', (req, res) => {
  const role = ['admin', 'officer', 'pm'].includes(req.query.role) ? req.query.role : null;
  const rows = role
    ? db.prepare(SELECT + ' WHERE u.role = ? ORDER BY u.username').all(role)
    : db.prepare(SELECT + ' ORDER BY u.role, u.username').all();
  res.json({ rows });
});

router.post('/', (req, res) => {
  const username = str(req.body?.username, 30);
  const fullName = str(req.body?.full_name, 100);
  const role = req.body?.role;
  if (!/^[a-z0-9._-]{3,30}$/i.test(username)) return res.status(400).json({ error: 'Username must be 3-30 letters, numbers, dot, dash or underscore' });
  if (!fullName) return res.status(400).json({ error: 'Full name is required' });
  if (!['admin', 'officer', 'pm'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return res.status(409).json({ error: 'Username already exists' });
  const temp = req.body?.password ? String(req.body.password) : sec.randomPassword();
  const problem = sec.passwordProblem(temp);
  if (problem) return res.status(400).json({ error: problem });
  const r = db.prepare('INSERT INTO users (username, full_name, role, password_hash, must_change_password) VALUES (?,?,?,?,1)')
    .run(username, fullName, role, sec.hashPassword(temp));
  res.status(201).json({ user: db.prepare(SELECT + ' WHERE u.id = ?').get(Number(r.lastInsertRowid)), temp_password: temp });
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const fullName = str(req.body?.full_name ?? u.full_name, 100);
  const role = req.body?.role ?? u.role;
  const active = req.body?.active === undefined ? u.active : (req.body.active ? 1 : 0);
  if (!fullName) return res.status(400).json({ error: 'Full name is required' });
  if (!['admin', 'officer', 'pm'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (id === req.user.id && (role !== u.role || !active)) return res.status(400).json({ error: 'You cannot change your own role or deactivate yourself' });
  if (role !== u.role && u.role === 'officer') {
    const n = db.prepare('SELECT COUNT(*) n FROM graduates WHERE officer_id = ?').get(id).n;
    if (n) return res.status(400).json({ error: `This officer still has ${n} graduates assigned. Reassign them first.` });
  }
  db.prepare('UPDATE users SET full_name = ?, role = ?, active = ?, token_version = token_version + ? WHERE id = ?')
    .run(fullName, role, active, active ? 0 : 1, id);
  res.json({ user: db.prepare(SELECT + ' WHERE u.id = ?').get(id) });
});

router.post('/:id/reset-password', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) return res.status(404).json({ error: 'User not found' });
  const temp = req.body?.password ? String(req.body.password) : sec.randomPassword();
  const problem = sec.passwordProblem(temp);
  if (problem) return res.status(400).json({ error: problem });
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, token_version = token_version + 1 WHERE id = ?')
    .run(sec.hashPassword(temp), id);
  res.json({ temp_password: temp });
});

module.exports = router;
