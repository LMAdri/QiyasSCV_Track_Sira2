'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../db');

// ---- passwords (scrypt, built into Node) ----
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  try {
    const [alg, s, h] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(h, 'hex');
    const actual = crypto.scryptSync(pw, Buffer.from(s, 'hex'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch (_) {
    return false;
  }
}

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters';
  if (pw.length > 100) return 'Password is too long';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain letters and numbers';
  return null;
}

function randomPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out + crypto.randomInt(10);
}

// ---- signed session token (HS256 JWT) ----
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const f = path.join(DATA_DIR, '.session_secret');
  try {
    return fs.readFileSync(f, 'utf8').trim();
  } catch (_) {
    const s = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(f, s, { mode: 0o600 });
    return s;
  }
}
const SECRET = loadSecret();
const b64 = (b) => Buffer.from(b).toString('base64url');
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 8);

function signToken(payload) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600 };
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = head + '.' + b64(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return data + '.' + sig;
}

function verifyToken(token) {
  try {
    const [h, p, s] = String(token).split('.');
    const expected = crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest();
    const given = Buffer.from(s || '', 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    const body = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch (_) {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

// ---- tiny in-memory limiter for failed logins ----
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = Number(process.env.LOGIN_MAX_FAILS || 20);
function loginBlocked(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() > a.reset) { attempts.delete(key); return false; }
  return a.count >= MAX_FAILS;
}
function loginFailed(key) {
  const a = attempts.get(key);
  if (!a || Date.now() > a.reset) attempts.set(key, { count: 1, reset: Date.now() + WINDOW_MS });
  else a.count += 1;
}
function loginSucceeded(key) { attempts.delete(key); }

module.exports = {
  hashPassword, verifyPassword, passwordProblem, randomPassword,
  signToken, verifyToken, parseCookies, loginBlocked, loginFailed, loginSucceeded,
};
