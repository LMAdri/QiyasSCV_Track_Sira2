'use strict';
const { db, tx } = require('../db');
const { today, daysBetween } = require('./util');

/*
 * Reminder rules (in-app notifications to the graduate's project officer AND every active admin):
 *  - Status 6 (passed, waiting for offer): one reminder when the expected offer date is 3 days away or closer.
 *  - Status 3 (scheduled interview/exam): a reminder at 3 days before, and another at 1 day before.
 * Only each graduate's current (latest) record is considered. Safe to run repeatedly; duplicates are ignored.
 */
function runNotifications() {
  const t = today();
  const rows = db.prepare(`
    SELECT r.id AS record_id, r.status, r.interview_date, r.expected_offer_date,
      g.first_name || ' ' || g.father_name || ' ' || g.grandfather_name AS name,
      g.officer_id, uo.full_name AS officer
    FROM current_records r
    JOIN graduates g ON g.id = r.graduate_id
    LEFT JOIN users uo ON uo.id = g.officer_id
    WHERE (r.status = 6 AND r.expected_offer_date IS NOT NULL)
       OR (r.status = 3 AND r.interview_date IS NOT NULL)`).all();
  if (!rows.length) return 0;

  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1").all().map((a) => a.id);
  const ins = db.prepare(`INSERT OR IGNORE INTO notifications
    (user_id, record_id, kind, offset_days, target_date, message) VALUES (?,?,?,?,?,?)`);
  const when = (d) => (d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`);
  let created = 0;

  tx(() => {
    for (const r of rows) {
      let kind, target, offset, text;
      if (r.status === 6) {
        kind = 'offer'; target = r.expected_offer_date;
        const d = daysBetween(t, target);
        if (d < 0 || d > 3) continue;
        offset = 3;
        text = `Offer expected ${when(d)} (${target}): ${r.name}`;
      } else {
        kind = 'interview'; target = r.interview_date;
        const d = daysBetween(t, target);
        if (d < 0 || d > 3) continue;
        offset = d <= 1 ? 1 : 3;
        text = `Interview / exam ${when(d)} (${target}): ${r.name}`;
      }
      const recipients = new Set(admins);
      if (r.officer_id) recipients.add(r.officer_id);
      for (const uid of recipients) {
        const msg = uid === r.officer_id || !r.officer ? text : `${text} - officer: ${r.officer}`;
        created += Number(ins.run(uid, r.record_id, kind, offset, target, msg).changes);
      }
    }
  });
  return created;
}

function startScheduler() {
  const safe = () => { try { runNotifications(); } catch (e) { console.error('Notification job failed:', e.message); } };
  safe();
  const timer = setInterval(safe, 60 * 60 * 1000); // hourly; catches the day rollover
  timer.unref();
}

module.exports = { runNotifications, startScheduler };
