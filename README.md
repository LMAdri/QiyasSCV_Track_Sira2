# Graduate Employment Tracker

Web application for recording and monitoring the employment outcomes of the **992 graduates** of the
Qiyas SCV Intermediate Digital Skills training (5 tracks, Addis Ababa / Dessie / Hossana), organised under
**40 project officers**.

* **Back end:** Node.js + Express, SQLite (Node's built-in `node:sqlite`, no database server needed)
* **Front end:** plain HTML/CSS/JavaScript single-page app + Chart.js (no build step)
* **Runs in any browser**, so officers can sign in from wherever they are.

## 1. Install and run

Requirements: **Node.js 22.13 or newer** (https://nodejs.org).

```bash
npm install
npm start            # http://localhost:3000
```

On the **first start** the system creates these accounts and prints their passwords **once** in the console:

| Account | Username | Initial password |
|---|---|---|
| Administrator | `admin` | random (printed), or set `ADMIN_PASSWORD` before the first start |
| Project manager | `pm` | `ChangeMe@123` (or `DEFAULT_PASSWORD`) |
| 40 project officers | `po01` ... `po40` | `ChangeMe@123` (or `DEFAULT_PASSWORD`) |

Every account **must change its password at first sign-in**. Rename the officers (Users page) and assign graduates to them.
New users and password resets get a generated temporary password that is shown once.

To try the system with fake data (992 invented graduates and random reports): `npm run seed:demo` on a fresh install
(delete the `data/` folder afterwards to start clean for real use).

## 2. Who can do what

| | Admin | Project officer | Project manager |
|---|:--:|:--:|:--:|
| Create / edit / delete graduate basic data, Excel bulk import | yes | no | no |
| See graduates | all | **only their own** | all (view only) |
| Record / edit employment reports | yes (on anyone's behalf) | own graduates | no |
| Dashboard, 12 reports with filters | yes | own numbers only | yes (view) |
| Export reports to Excel / PDF | yes | no | no |
| Manage users / reset passwords | yes | no | no |
| In-app reminders | yes | yes (own graduates) | no |

## 3. Employment reporting (project officer)

1. Pick a **single date** or a **date range** (calendar widgets).
2. Pick the graduate from the drop-down (the server only returns that officer's graduates).
3. Pick one of the 10 statuses; a details/description box always appears, plus status-specific fields:

| Status | Extra fields |
|---|---|
| 1 Unemployed, searching | details only |
| 2 Applied / sent CV | company applied to, date of application |
| 3 Scheduled for interview/exam | **expected interview/exam date** (reminders 3 days and 1 day before) |
| 4 Interviewed / took exam | interview date |
| 5 Failed interview/exam | interview date |
| 6 Passed, waiting for offer | **expected offer date** (reminder 3 days before) |
| 7 Secured job / employment letter | salary, offer-received date, **PDF offer letter** (max 5 MB) |
| 8 Declined the offer | offer-received date |
| 9 Already working | salary |
| 10 Self-employed | company details |

Company fields (name, description, city, location, contact person, tel, position) are available for statuses 2-10.
The most recent report (by reporting date) is the graduate's **current status**; earlier reports stay as history.

Reminders appear in the bell/notification page for the graduate's officer **and every admin**, and are generated
when a report is saved and again every hour (so they also appear on the right day without anyone saving anything).

## 4. Admin features

* **Dashboard** - live (refreshes every 15 s) pie charts and bar graph with counts and percentages; filter by
  project officer, training track and campus; breakdown tables by track, campus or officer.
  *Employed* = recently employed + already working; *Self-employed*; *Unemployed* = still searching or in the
  recruitment process without a job (statuses 1-6 and 8); *Not yet reported* is shown separately.
* **Reports** - the 11 requested lists plus "Interviewed (result pending)", each with search, officer, track, campus,
  company-city and date filters, and **Export Excel / Export PDF** buttons that apply the same filters.
* **Graduates** - add/edit/delete one by one, or **Import from Excel** (download the template from the dialog; use
  the officer's username in the *Project Officer* column; bad rows are reported, good rows are imported; duplicates by
  name + phone are skipped).
* **Users** - add users, rename officers, disable accounts, reset passwords.

## 5. Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | `3000`, `0.0.0.0` | where to listen |
| `DATA_DIR` | `./data` | database and uploaded offer letters (**back this folder up**) |
| `ADMIN_PASSWORD` | random | initial admin password on first start |
| `DEFAULT_PASSWORD` | `ChangeMe@123` | initial password for PM and the 40 officers |
| `COOKIE_SECURE` | off | set `true` when served over HTTPS (recommended in production) |
| `TRUST_PROXY` | off | set to any value when behind nginx/Apache so client IPs are right |
| `SESSION_HOURS` | `8` | sign-in lifetime |
| `JWT_SECRET` | generated in `DATA_DIR` | signing secret for sessions |
| `APP_TZ` | `Africa/Addis_Ababa` | time zone used for "today" and reminders |
| `ETHIOPIC_FONT` | none | path to a `.ttf` (e.g. Noto Sans Ethiopic) so **PDF exports** can show Amharic names |

## 6. Putting it on the internet

* Run it behind a reverse proxy (nginx, Caddy, IIS...) that provides **HTTPS**, then start with `COOKIE_SECURE=true TRUST_PROXY=1`.
* Keep it running with `pm2`, a systemd service, or a Windows service wrapper.
* Back up `DATA_DIR` regularly (copy `app.db` while the service is stopped, or use `sqlite3 app.db ".backup file"`).

## 7. Tests

`npm test` runs two suites: business logic/SQL on 992 demo graduates, and the real route handlers (permissions,
validation, PDF handling, reminders, sessions).

## 8. Known limits

* SQLite on one server comfortably handles this workload (hundreds of users, thousands of rows); it is not meant for a multi-server cluster.
* Reminders are in-app only (no e-mail/SMS).
* Excel import/export and PDF export rely on the `exceljs` and `pdfkit` packages.
* Amharic text in PDF exports needs the `ETHIOPIC_FONT` setting; Excel exports are unaffected.
