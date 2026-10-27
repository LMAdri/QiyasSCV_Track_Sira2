'use strict';
const C = require('./constants');
const { db } = require('../db');
const { isDate, str, parseBool } = require('./util');

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function matchOption(v, list) {
  const n = norm(v);
  if (!n) return null;
  return list.find((x) => norm(x) === n) || null;
}

function matchTrack(v) {
  const exact = matchOption(v, C.TRACKS);
  if (exact) return exact;
  const n = norm(v);
  if (!n) return null;
  if (n.includes('marketing') || n.startsWith('ai')) return C.TRACKS[4];
  if (n.includes('device')) return C.TRACKS[3];
  if (n.includes('infra')) return C.TRACKS[2];
  if (n.includes('graphic') || n.includes('multimedia')) return C.TRACKS[1];
  if (n.includes('web') || n.includes('enterprise') || n.includes('application')) return C.TRACKS[0];
  return null;
}

function matchGender(v) {
  const n = norm(v);
  if (n === 'male' || n === 'm') return 'Male';
  if (n === 'female' || n === 'f') return 'Female';
  return null;
}

function validatePhone(p) {
  const digits = p.replace(/[^\d]/g, '');
  return /^[+\d][\d\s\-()]*$/.test(p) && digits.length >= 7 && digits.length <= 15;
}

/** Validate + normalise a graduate's basic info (used by the admin form and the Excel import). */
function validateGraduate(input) {
  const errors = [];
  const d = {};
  d.first_name = str(input.first_name, 100);
  d.father_name = str(input.father_name, 100);
  d.grandfather_name = str(input.grandfather_name, 100);
  if (!d.first_name) errors.push('First name is required');
  if (!d.father_name) errors.push("Father's name is required");
  if (!d.grandfather_name) errors.push("Grandfather's name is required");

  d.track = matchTrack(input.track);
  if (!d.track) errors.push('Training track is missing or not one of the 5 tracks');
  d.gender = matchGender(input.gender);
  if (!d.gender) errors.push('Gender must be Male or Female');
  d.campus = matchOption(input.campus, C.CAMPUS_NAMES);
  if (!d.campus) errors.push('Campus is missing or not in the campus list');
  d.prev_education = matchOption(input.prev_education, C.EDUCATION);
  if (!d.prev_education) errors.push('Previous education background is missing or not in the list');

  d.phone = str(input.phone, 30);
  if (!d.phone) errors.push('Cell phone number is required');
  else if (!validatePhone(d.phone)) errors.push('Cell phone number looks invalid');

  d.fayda_id = str(input.fayda_id, 40) || null;
  d.kebele_id = str(input.kebele_id, 40) || null;
  d.address = str(input.address, 300) || null;
  d.additional_cert = str(input.additional_cert, 500) || null;
  d.other_info = str(input.other_info, 2000) || null;

  d.field_of_study = null;
  d.tvet_field = null;
  if (d.prev_education === C.BACHELORS) d.field_of_study = str(input.field_of_study, 200) || null;
  if (C.TVET_LEVELS.includes(d.prev_education)) d.tvet_field = str(input.tvet_field, 200) || null;

  d.idp = parseBool(input.idp) ? 1 : 0;
  d.disability = parseBool(input.disability) ? 1 : 0;
  d.returnee = parseBool(input.returnee) ? 1 : 0;

  d.worked_as_intern = parseBool(input.worked_as_intern) ? 1 : 0;
  d.intern_company = d.worked_as_intern ? str(input.intern_company, 200) || null : null;
  d.intern_description = d.worked_as_intern ? str(input.intern_description, 1000) || null : null;
  if (d.worked_as_intern && !d.intern_company) errors.push('Intern company is required when "worked as intern" is Yes');

  const oid = Number(input.officer_id);
  const officer = Number.isInteger(oid)
    ? db.prepare("SELECT id FROM users WHERE id = ? AND role = 'officer' AND active = 1").get(oid)
    : null;
  if (!officer) errors.push('A valid, active project officer must be assigned');
  d.officer_id = officer ? officer.id : null;

  return { errors, data: d };
}

/** Validate an employment record submitted by an officer. */
function validateRecord(input) {
  const errors = [];
  const d = {};
  const status = Number(input.status);
  if (!Number.isInteger(status) || status < 1 || status > 10) {
    errors.push('Employment status is required');
    return { errors, data: d };
  }
  d.status = status;

  d.report_date = str(input.report_date, 10);
  if (!isDate(d.report_date)) errors.push('A valid reporting date is required');
  d.report_date_end = str(input.report_date_end, 10) || null;
  if (d.report_date_end) {
    if (!isDate(d.report_date_end)) errors.push('Reporting end date is invalid');
    else if (isDate(d.report_date) && d.report_date_end < d.report_date) errors.push('End date cannot be before the start date');
  }

  d.status_detail = str(input.status_detail, 4000) || null;

  const hasCompany = C.COMPANY_STATUSES.includes(status);
  d.company_name = hasCompany ? str(input.company_name, 200) || null : null;
  d.company_description = hasCompany ? str(input.company_description, 3000) || null : null;
  d.company_city = hasCompany ? str(input.company_city, 100) || null : null;
  d.company_location = hasCompany ? str(input.company_location, 300) || null : null;
  d.contact_person = hasCompany ? str(input.contact_person, 150) || null : null;
  d.company_tel = hasCompany ? str(input.company_tel, 40) || null : null;
  d.position = hasCompany ? str(input.position, 200) || null : null;
  if (hasCompany && !d.company_name) errors.push('Company name is required for this status');

  d.salary = null;
  if (C.SALARY_STATUSES.includes(status)) {
    const raw = input.salary;
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      const n = Number(String(raw).replace(/,/g, ''));
      if (!Number.isFinite(n) || n < 0) errors.push('Salary must be a positive number');
      else d.salary = n;
    }
  }

  const dateField = (key, label, allowed, required) => {
    const v = str(input[key], 10);
    if (!allowed) { d[key] = null; return; }
    if (!v) {
      d[key] = null;
      if (required) errors.push(`${label} is required`);
      return;
    }
    if (!isDate(v)) { d[key] = null; errors.push(`${label} is invalid`); return; }
    d[key] = v;
  };
  dateField('application_date', 'Date of application', status === 2, false);
  dateField('interview_date', 'Date of interview / exam', [3, 4, 5, 6].includes(status), status === 3);
  dateField('expected_offer_date', 'Expected date of offer', status === 6, true);
  dateField('offer_received_date', 'Date offer letter was received', [7, 8].includes(status), false);

  return { errors, data: d };
}

/** PDF magic-bytes check for the offer letter attachment. */
function isPdf(buf) {
  return Buffer.isBuffer(buf) && buf.length > 4 && buf.slice(0, 5).toString('latin1') === '%PDF-';
}

module.exports = { validateGraduate, validateRecord, matchOption, matchTrack, matchGender, isPdf, norm };
