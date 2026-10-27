'use strict';

// "Today" in the project's time zone (Ethiopia by default), formatted YYYY-MM-DD.
function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TZ || 'Africa/Addis_Ababa',
  }).format(new Date());
}

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

function str(v, max = 500) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}

function parseBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  return ['1', 'true', 'yes', 'y', 'x', 'on'].includes(String(v ?? '').trim().toLowerCase());
}

function fileSafe(s) {
  return String(s).replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60);
}

module.exports = { today, isDate, daysBetween, str, parseBool, fileSafe };
