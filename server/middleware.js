'use strict';
const { db } = require('./db');
const sec = require('./lib/security');

const COOKIE = 'token';
const HOURS = Number(process.env.SESSION_HOURS || 8);

function setSession(res, user) {
  const token = sec.signToken({ uid: user.id, tv: user.token_version });
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${HOURS * 3600}${secure}`);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

/** Requires a valid session; loads req.user fresh from the DB on every request. */
function auth(req, res, next) {
  const payload = sec.verifyToken(sec.parseCookies(req.headers.cookie)[COOKIE]);
  if (!payload) return res.status(401).json({ error: 'Please sign in' });
  const u = db.prepare(
    'SELECT id, username, full_name, role, must_change_password, active, token_version FROM users WHERE id = ?'
  ).get(payload.uid);
  if (!u || !u.active || u.token_version !== payload.tv) return res.status(401).json({ error: 'Please sign in' });
  req.user = { ...u };
  next();
}

/** Blocks everything until the default/temporary password has been changed. */
function passwordChanged(req, res, next) {
  if (req.user.must_change_password) {
    return res.status(403).json({ error: 'You must change your password first', code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  next();
}

const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have permission for this action' });

module.exports = { auth, passwordChanged, allow, setSession, clearSession };
