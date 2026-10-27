'use strict';
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const { db } = require('./db');
const C = require('./lib/constants');
const { auth, passwordChanged, allow } = require('./middleware');
const { startScheduler } = require('./lib/notify');
const { seedAccounts } = require('./seed');

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', 1); // set when running behind nginx / a load balancer

app.use(helmet({
  contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': null } },
}));
app.use(express.json({ limit: '200kb' }));
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

// ---- API ----
app.use('/api/auth', require('./routes/auth'));

const api = express.Router();
api.use(auth, passwordChanged);
api.get('/meta', (req, res) => {
  const officers = req.user.role === 'officer' ? [] :
    db.prepare("SELECT id, username, full_name FROM users WHERE role = 'officer' AND active = 1 ORDER BY username").all();
  res.json({
    tracks: C.TRACKS, campuses: C.CAMPUSES, education: C.EDUCATION, statuses: C.STATUSES,
    tvet_levels: C.TVET_LEVELS, bachelors: C.BACHELORS, officers,
    rules: { salary: C.SALARY_STATUSES, company: C.COMPANY_STATUSES, offer_letter: C.OFFER_LETTER_STATUS },
  });
});
api.use('/users', require('./routes/users'));
api.use('/graduates', require('./routes/graduates'));
api.use('/records', require('./routes/records'));
api.use('/notifications', require('./routes/notifications'));
api.use('/', require('./routes/reports')); // /stats, /stats/breakdown, /reports...
api.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use('/api', api);

// ---- front end ----
const chartFile = path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js');
app.get('/vendor/chart.js', (req, res) => {
  if (!fs.existsSync(chartFile)) return res.status(404).send('Run "npm install" to install chart.js');
  res.sendFile(chartFile);
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- errors ----
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  if (res.headersSent) return res.end();
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Something went wrong on the server' });
});

// First run: create the admin, PM and the 40 officer accounts and print their initial passwords once.
if (db.prepare('SELECT COUNT(*) n FROM users').get().n === 0) {
  const lines = seedAccounts();
  console.log('\n=== First run: accounts created (note these now, shown only once) ===');
  lines.forEach((l) => console.log('  ' + l));
  console.log('====================================================================\n');
}

startScheduler();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => console.log(`Graduate Employment Tracker running on http://localhost:${PORT}`));
