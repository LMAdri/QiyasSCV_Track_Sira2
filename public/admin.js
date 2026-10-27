'use strict';
/* Dashboard, reports, graduates (+ detail / form / import) and user management. */

// ======================= Dashboard =======================
const PIE_GROUPS = [
  ['Previously employed (already working)', [9], '#2a9d8f'],
  ['Recently employed (got offer letter)', [7], '#1d7a46'],
  ['Unemployed (still searching for job)', [1], '#e76f51'],
  ['Sent CV / applied', [2], '#f4a261'],
  ['Scheduled interview / exam', [3], '#e9c46a'],
  ['Interviewed / took exam (pending)', [4], '#8d99ae'],
  ['Passed interview / exam (waiting for offer)', [6], '#4c78a8'],
  ['Failed interview / exam', [5], '#b5413a'],
  ['Declined the job offer', [8], '#9b6b9e'],
  ['Self-employed', [10], '#264653'],
  ['Not yet reported', [0], '#c9ced6'],
];

function chartTooltip(total) {
  return { callbacks: { label: (c) => ` ${fmtN(c.raw)} graduates (${pct(c.raw, total)})` } };
}

const barValueLabels = {
  id: 'valueLabels',
  afterDatasetsDraw(chart) {
    const total = chart.$total || 0;
    const { ctx } = chart;
    ctx.save();
    ctx.fillStyle = '#1d2733';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    chart.getDatasetMeta(0).data.forEach((bar, i) => {
      const v = chart.data.datasets[0].data[i];
      ctx.fillText(`${fmtN(v)} (${pct(v, total)})`, bar.x + 6, bar.y);
    });
    ctx.restore();
  },
};

PAGES.dashboard = async function (el) {
  el.innerHTML = `<h2>Dashboard <span class="muted small" id="upd"></span></h2>
    <div class="filters">
      <div><label>Project officer</label><select id="fOfficer">${officerOpts('')}</select></div>
      <div><label>Training track</label><select id="fTrack">${opts(meta.tracks, '', 'All tracks')}</select></div>
      <div><label>Campus</label><select id="fCampus">${opts(meta.campuses.map((c) => c.name), '', 'All campuses')}</select></div>
    </div>
    <div class="kpis" id="kpis"></div>
    <div class="grid2">
      <div class="card"><h3>Employment status of graduates</h3><div class="chartbox tall"><canvas id="c1"></canvas></div></div>
      <div class="card"><h3>Employed vs self-employed vs unemployed</h3><div class="chartbox tall"><canvas id="c2"></canvas></div></div>
    </div>
    <div class="card"><h3>Graduates per status (bar graph)</h3><div class="chartbox tall"><canvas id="c3"></canvas></div></div>
    <div class="card"><div class="toolbar"><h3 style="margin:0">Breakdown by</h3>
      <select id="grp" style="width:auto"><option value="track">Training track</option><option value="campus">Campus</option><option value="officer">Project officer</option></select></div>
      <div id="bd"></div></div>
    <p class="muted small">Figures refresh automatically every 15 seconds. Percentages are of all graduates in the current selection.
    "Employed" = recently employed + already working; "Unemployed" = everyone still searching or in the recruitment process without a job.</p>`;

  if (typeof Chart === 'undefined') { el.insertAdjacentHTML('afterbegin', '<div class="error">Charts could not be loaded (run "npm install" on the server).</div>'); }
  const filters = () => ({ officer_id: $('#fOfficer').value, track: $('#fTrack').value, campus: $('#fCampus').value });
  let c1, c2, c3;

  const mk = (id, cfg) => (typeof Chart === 'undefined' ? null : new Chart($(id).getContext('2d'), cfg));
  c1 = mk('#c1', { type: 'pie', data: { labels: [], datasets: [{ data: [], backgroundColor: PIE_GROUPS.map((g) => g[2]) }] },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } }, tooltip: {} } } });
  c2 = mk('#c2', { type: 'pie', data: { labels: [], datasets: [{ data: [], backgroundColor: ['#1d7a46', '#264653', '#e76f51', '#c9ced6'] }] },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12 } }, tooltip: {} } } });
  c3 = mk('#c3', { type: 'bar', data: { labels: [], datasets: [{ data: [], backgroundColor: PIE_GROUPS.map((g) => g[2]) }] },
    options: { indexAxis: 'y', maintainAspectRatio: false, layout: { padding: { right: 90 } }, plugins: { legend: { display: false }, tooltip: {} }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } },
    plugins: [barValueLabels] });

  async function refresh() {
    const f = filters();
    const [s, bd] = await Promise.all([api('/stats?' + qs(f)), api('/stats/breakdown?' + qs({ ...f, group: $('#grp').value }))]);
    const t = s.summary.total;
    $('#kpis').innerHTML = [
      ['Total graduates', t, '', '#1f5fa8'],
      ['Employed (secured)', s.summary.employed, pct(s.summary.employed, t), '#1d7a46'],
      ['Self-employed', s.summary.self_employed, pct(s.summary.self_employed, t), '#264653'],
      ['Unemployed', s.summary.unemployed, pct(s.summary.unemployed, t), '#e76f51'],
      ['Not yet reported', s.summary.not_reported, pct(s.summary.not_reported, t), '#8d99ae'],
    ].map(([l, v, p, c]) => `<div class="kpi" style="border-left-color:${c}"><div class="v">${fmtN(v)}</div><div class="l">${l}${p ? ` &middot; ${p}` : ''}</div></div>`).join('');

    const vals = PIE_GROUPS.map((g) => g[1].reduce((a, id) => a + (s.counts[id] || 0), 0));
    const lbl = PIE_GROUPS.map((g, i) => `${g[0]} - ${fmtN(vals[i])} (${pct(vals[i], t)})`);
    if (c1) { c1.data.labels = lbl; c1.data.datasets[0].data = vals; c1.options.plugins.tooltip = chartTooltip(t); c1.update(); }

    const v2 = [s.summary.employed, s.summary.self_employed, s.summary.unemployed, s.summary.not_reported];
    const l2 = ['Employed (secured)', 'Self-employed', 'Unemployed', 'Not yet reported'].map((n, i) => `${n} - ${fmtN(v2[i])} (${pct(v2[i], t)})`);
    if (c2) { c2.data.labels = l2; c2.data.datasets[0].data = v2; c2.options.plugins.tooltip = chartTooltip(t); c2.update(); }

    if (c3) {
      c3.$total = t;
      c3.data.labels = PIE_GROUPS.map((g) => g[0]);
      c3.data.datasets[0].data = vals;
      c3.options.plugins.tooltip = chartTooltip(t);
      c3.update();
    }

    $('#bd').innerHTML = `<div class="table-wrap"><table><thead><tr><th>${esc($('#grp').selectedOptions[0].text)}</th><th class="num">Total</th>
      <th class="num">Employed</th><th class="num">Self-employed</th><th class="num">Unemployed</th><th class="num">Not reported</th><th class="num">Employed + self-employed</th></tr></thead><tbody>
      ${bd.rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${fmtN(r.total)}</td>
        <td class="num">${fmtN(r.employed)} (${pct(r.employed, r.total)})</td><td class="num">${fmtN(r.self_employed)} (${pct(r.self_employed, r.total)})</td>
        <td class="num">${fmtN(r.unemployed)} (${pct(r.unemployed, r.total)})</td><td class="num">${fmtN(r.not_reported)} (${pct(r.not_reported, r.total)})</td>
        <td class="num"><strong>${pct(r.employed + r.self_employed, r.total)}</strong></td></tr>`).join('')}
      </tbody></table></div>`;
    $('#upd').textContent = '- updated ' + new Date().toLocaleTimeString();
  }

  $$('#fOfficer,#fTrack,#fCampus,#grp', el).forEach((s) => s.addEventListener('change', () => refresh().catch((e) => toast(e.message, true))));
  await refresh();
  timers.push(setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 15000));
};

// ======================= Reports =======================
const fmtCell = (c, v) => {
  if (v === null || v === undefined || v === '') return '';
  if (c.key === 'salary') return fmtN(v);
  return esc(v);
};

PAGES.reports = async function (el, params) {
  const list = (await api('/reports')).reports;
  const key = params.key && list.find((r) => r.key === params.key) ? params.key : 'all_graduates';
  const isAdmin = me.role === 'admin';
  el.innerHTML = `<h2>Reports</h2>
    <div class="card">
      <div class="filters">
        <div class="span-all" style="grid-column:1/-1"><label>Report</label><select id="rKey">${opts(list.map((r) => ({ value: r.key, label: r.title })), key)}</select></div>
        <div><label>Search (name, phone, Fayda ID, company)</label><input id="rQ" placeholder="Type to search"></div>
        <div><label>Project officer</label><select id="rOfficer">${officerOpts('')}</select></div>
        <div><label>Training track</label><select id="rTrack">${opts(meta.tracks, '', 'All tracks')}</select></div>
        <div><label>Campus</label><select id="rCampus">${opts(meta.campuses.map((c) => c.name), '', 'All campuses')}</select></div>
        <div><label>Company city</label><input id="rCity" placeholder="e.g. Addis Ababa"></div>
        <div><label>Last report from</label><input type="date" id="rFrom"></div>
        <div><label>Last report to</label><input type="date" id="rTo"></div>
      </div>
      <div class="toolbar"><button class="primary" id="rGo">Apply filters</button><button id="rReset">Reset</button><span class="spacer"></span>
        ${isAdmin ? '<a class="btn" id="xXlsx" href="#">Export Excel</a><a class="btn" id="xPdf" href="#">Export PDF</a>' : '<span class="muted small">Only the administrator can export.</span>'}</div>
      <div id="rOut"></div>
    </div>`;
  let page = 1;
  const filters = () => ({ q: $('#rQ').value.trim(), officer_id: $('#rOfficer').value, track: $('#rTrack').value, campus: $('#rCampus').value,
    city: $('#rCity').value.trim(), date_from: $('#rFrom').value, date_to: $('#rTo').value });

  async function load() {
    const k = $('#rKey').value;
    const d = await api(`/reports/${k}?` + qs({ ...filters(), page, page_size: 25 }));
    const exp = (fmt) => `/api/reports/${k}/export?` + qs({ ...filters(), format: fmt });
    if (isAdmin) { $('#xXlsx').href = exp('xlsx'); $('#xPdf').href = exp('pdf'); }
    $('#rOut').innerHTML = `<p><strong>${esc(d.title)}</strong> &middot; ${fmtN(d.total)} graduate(s)</p>
      <div class="table-wrap"><table><thead><tr>${d.columns.map((c) => `<th${c.key === 'salary' ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${d.rows.map((r) => `<tr class="click" data-id="${r.graduate_id}">${d.columns.map((c) => `<td${c.key === 'salary' ? ' class="num"' : ''}>${fmtCell(c, r[c.key])}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="${d.columns.length}" class="muted">No graduates match.</td></tr>`}</tbody></table></div>
      <div class="pager"><button id="pPrev" ${d.page <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${d.page} of ${d.pages}</span><button id="pNext" ${d.page >= d.pages ? 'disabled' : ''}>Next</button></div>`;
    $('#pPrev').addEventListener('click', () => { page--; load().catch((e) => toast(e.message, true)); });
    $('#pNext').addEventListener('click', () => { page++; load().catch((e) => toast(e.message, true)); });
    $$('#rOut tr.click').forEach((tr) => tr.addEventListener('click', () => openGraduate(Number(tr.dataset.id))));
  }
  const go = () => { page = 1; load().catch((e) => toast(e.message, true)); };
  $('#rGo').addEventListener('click', go);
  $('#rKey').addEventListener('change', go);
  $$('#rOfficer,#rTrack,#rCampus,#rFrom,#rTo', el).forEach((x) => x.addEventListener('change', go));
  $$('#rQ,#rCity', el).forEach((x) => x.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }));
  $('#rReset').addEventListener('click', () => { $$('input,select', $('.filters', el)).forEach((x) => { if (x.id !== 'rKey') x.value = ''; }); go(); });
  await load();
};

// ======================= Graduates =======================
const yn = (v) => (v ? 'Yes' : 'No');

async function openGraduate(id) {
  const { graduate: g, records } = await api('/graduates/' + id);
  const isAdmin = me.role === 'admin';
  const rows = [
    ['Full name', `${g.first_name} ${g.father_name} ${g.grandfather_name}`], ['Gender', g.gender], ['Training track', g.track],
    ['Campus', g.campus], ['Cell phone', g.phone], ['Fayda ID', g.fayda_id], ['Kebele ID', g.kebele_id], ['Living address', g.address],
    ['Previous education', g.prev_education], ['Field of study', g.field_of_study], ['TVET field of study', g.tvet_field],
    ['IDP / Disability / Returnee', `${yn(g.idp)} / ${yn(g.disability)} / ${yn(g.returnee)}`], ['Additional certification', g.additional_cert],
    ['Worked as intern during training', yn(g.worked_as_intern)], ['Intern company', g.intern_company], ['Intern description', g.intern_description],
    ['Other info', g.other_info], ['Project officer', g.officer_name],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');
  const hist = records.map((r) => `<div class="hist-row"><strong>${esc(r.status_label)}</strong>
    <span class="muted small">&middot; reported ${esc(r.report_date)}${r.report_date_end ? ' to ' + esc(r.report_date_end) : ''} by ${esc(r.recorded_by_name || '-')}</span>
    <div class="small">${[r.company_name && 'Company: ' + esc(r.company_name), r.company_city && esc(r.company_city), r.position && 'Position: ' + esc(r.position),
      r.salary != null && 'Salary: ' + fmtN(r.salary) + ' ETB', r.application_date && 'Applied: ' + esc(r.application_date),
      r.interview_date && 'Interview/exam: ' + esc(r.interview_date), r.expected_offer_date && 'Expected offer: ' + esc(r.expected_offer_date),
      r.offer_received_date && 'Offer received: ' + esc(r.offer_received_date), r.contact_person && 'Contact: ' + esc(r.contact_person), r.company_tel && 'Company tel: ' + esc(r.company_tel)]
      .filter(Boolean).join(' &middot; ')}</div>
    ${r.status_detail ? `<div class="small">${esc(r.status_detail)}</div>` : ''}
    ${r.has_offer_letter ? `<div class="small"><a href="/api/records/${r.id}/offer-letter" target="_blank" rel="noopener">View offer letter (PDF)</a></div>` : ''}</div>`).join('');
  const m = modal(`${g.first_name} ${g.father_name}`, `
    <dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <h3 style="margin-top:1rem">Employment reports</h3>${hist || '<p class="muted">No employment report yet.</p>'}
    <div class="toolbar" style="margin-top:1rem">
      ${me.role !== 'pm' ? `<a class="btn primary" href="#/record?graduate=${g.id}" id="gRecord">Record employment</a>` : ''}
      <span class="spacer"></span>
      ${isAdmin ? '<button id="gEdit">Edit</button><button class="danger" id="gDel">Delete</button>' : ''}
    </div>`, { wide: true });
  const rec = $('#gRecord', m.el); if (rec) rec.addEventListener('click', () => m.close());
  if (isAdmin) {
    $('#gEdit', m.el).addEventListener('click', () => { m.close(); graduateForm(g); });
    $('#gDel', m.el).addEventListener('click', async () => {
      if (!confirm(`Delete ${g.first_name} ${g.father_name} and all their employment reports? This cannot be undone.`)) return;
      try { await api('/graduates/' + g.id, { method: 'DELETE' }); toast('Graduate deleted'); m.close(); route(); } catch (e) { toast(e.message, true); }
    });
  }
}

function graduateForm(g) {
  const v = g || {};
  const m = modal(g ? 'Edit graduate' : 'Add graduate', `<form id="gForm" class="grid">
    <div><label class="req">First name</label><input name="first_name" value="${esc(v.first_name)}" required maxlength="100"></div>
    <div><label class="req">Father's name</label><input name="father_name" value="${esc(v.father_name)}" required maxlength="100"></div>
    <div><label class="req">Grandfather's name</label><input name="grandfather_name" value="${esc(v.grandfather_name)}" required maxlength="100"></div>
    <div><label class="req">Training track</label><select name="track" required>${opts(meta.tracks, v.track, 'Select track')}</select></div>
    <div><label class="req">Gender</label><select name="gender" required>${opts(['Male', 'Female'], v.gender, 'Select')}</select></div>
    <div><label>Fayda ID (if any)</label><input name="fayda_id" value="${esc(v.fayda_id)}" maxlength="40"></div>
    <div><label>Kebele ID</label><input name="kebele_id" value="${esc(v.kebele_id)}" maxlength="40"></div>
    <div><label class="req">Cell phone</label><input name="phone" value="${esc(v.phone)}" required maxlength="30" inputmode="tel"></div>
    <div><label>Living address</label><input name="address" value="${esc(v.address)}" maxlength="300"></div>
    <div><label class="req">Campus</label><select name="campus" required>${opts(meta.campuses.map((c) => ({ value: c.name, label: `${c.name} (${c.city})` })), v.campus, 'Select campus')}</select></div>
    <div><label class="req">Project officer</label><select name="officer_id" required>${officerOpts(v.officer_id, 'Select officer')}</select></div>
    <div><label class="req">Previous education background</label><select name="prev_education" required>${opts(meta.education, v.prev_education, 'Select')}</select></div>
    <div id="fosBox" hidden><label>Particular field of study</label><input name="field_of_study" value="${esc(v.field_of_study)}" maxlength="200"></div>
    <div id="tvetBox" hidden><label>Particular field of study in TVET</label><input name="tvet_field" value="${esc(v.tvet_field)}" maxlength="200"></div>
    <div class="span-all"><label class="inline"><input type="checkbox" name="idp" ${v.idp ? 'checked' : ''}> IDP</label>
      <label class="inline"><input type="checkbox" name="disability" ${v.disability ? 'checked' : ''}> Disability</label>
      <label class="inline"><input type="checkbox" name="returnee" ${v.returnee ? 'checked' : ''}> Returnee</label></div>
    <div class="span-all"><label>Additional certification (if any)</label><input name="additional_cert" value="${esc(v.additional_cert)}" maxlength="500"></div>
    <div class="span-all"><label class="inline"><input type="checkbox" name="worked_as_intern" ${v.worked_as_intern ? 'checked' : ''}> Worked as intern during training</label></div>
    <div id="internBox" class="span-all grid" hidden>
      <div><label class="req">Intern company</label><input name="intern_company" value="${esc(v.intern_company)}" maxlength="200"></div>
      <div><label>Description of the internship</label><textarea name="intern_description" maxlength="1000">${esc(v.intern_description)}</textarea></div></div>
    <div class="span-all"><label>Other info</label><textarea name="other_info" maxlength="2000">${esc(v.other_info)}</textarea></div>
    <div class="span-all toolbar"><button class="primary">${g ? 'Save changes' : 'Add graduate'}</button><button type="button" data-close>Cancel</button></div>
  </form>`, { wide: true });
  const f = $('#gForm', m.el);
  const sync = () => {
    $('#fosBox', f).hidden = f.prev_education.value !== meta.bachelors;
    $('#tvetBox', f).hidden = !meta.tvet_levels.includes(f.prev_education.value);
    $('#internBox', f).hidden = !f.worked_as_intern.checked;
  };
  f.prev_education.addEventListener('change', sync); f.worked_as_intern.addEventListener('change', sync); sync();
  $('[data-close]', f).addEventListener('click', m.close);
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); showError(f);
    const body = Object.fromEntries(new FormData(f).entries());
    ['idp', 'disability', 'returnee', 'worked_as_intern'].forEach((k) => { body[k] = f[k].checked; });
    await withBusy($('button.primary', f), async () => {
      try {
        if (g) await api('/graduates/' + g.id, { method: 'PUT', body }); else await api('/graduates', { method: 'POST', body });
        toast(g ? 'Graduate updated' : 'Graduate added'); m.close(); route();
      } catch (err) { showError(f, err.message); f.scrollIntoView({ block: 'start' }); }
    });
  });
}

function importDialog() {
  let dirty = false;
  const m = modal('Bulk import graduates from Excel', `
    <p>1. <a href="/api/graduates/import-template">Download the Excel template</a> (it lists the allowed values on its second sheet).<br>
    2. Fill in one graduate per row. Use each officer's <strong>username</strong> (e.g. po01) in the "Project Officer" column.<br>
    3. Upload the file (.xlsx, max 5 MB). Valid rows are imported; problem rows are listed so you can fix and re-upload just those.</p>
    <form id="impForm"><input type="file" name="file" accept=".xlsx" required>
    <p class="toolbar"><button class="primary">Import</button><button type="button" data-close>Close</button></p></form><div id="impOut"></div>`, { wide: true, onClose: () => { if (dirty) route(); } });
  $('[data-close]', m.el).addEventListener('click', m.close);
  const f = $('#impForm', m.el);
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); showError(f);
    await withBusy($('button.primary', f), async () => {
      try {
        const r = await api('/graduates/import', { method: 'POST', form: new FormData(f) });
        $('#impOut', m.el).innerHTML = `<div class="notice"><strong>${fmtN(r.imported)}</strong> graduate(s) imported, <strong>${fmtN(r.skipped)}</strong> row(s) skipped.</div>
          ${r.errors.length ? `<div class="table-wrap"><table><thead><tr><th>Row</th><th>Name</th><th>Problem</th></tr></thead><tbody>
          ${r.errors.map((x) => `<tr><td>${x.row}</td><td>${esc(x.name)}</td><td>${esc(x.message)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
        if (r.imported) dirty = true;
      } catch (err) { showError(f, err.message); }
    });
  });
  return m;
}

PAGES.graduates = async function (el) {
  const isAdmin = me.role === 'admin';
  el.innerHTML = `<h2>${me.role === 'officer' ? 'My graduates' : 'Graduates'}</h2>
    <div class="card"><div class="filters">
      <div><label>Search (name, phone, Fayda ID)</label><input id="gQ" placeholder="Type and press Enter"></div>
      ${me.role !== 'officer' ? `<div><label>Project officer</label><select id="gOfficer">${officerOpts('')}</select></div>` : ''}
      <div><label>Training track</label><select id="gTrack">${opts(meta.tracks, '', 'All tracks')}</select></div>
      <div><label>Campus</label><select id="gCampus">${opts(meta.campuses.map((c) => c.name), '', 'All campuses')}</select></div>
      <div><label>Employment status</label><select id="gStatus">${opts([{ value: 0, label: 'Not yet reported' }, ...meta.statuses.map((s) => ({ value: s.id, label: s.label }))], '', 'Any status')}</select></div>
    </div>
    <div class="toolbar"><span id="gCount" class="muted"></span><span class="spacer"></span>
      ${isAdmin ? '<button id="gImport">Import from Excel</button><button class="primary" id="gAdd">Add graduate</button>' : ''}</div>
    <div id="gOut"></div></div>`;
  let page = 1;
  const filters = () => ({ q: $('#gQ').value.trim(), officer_id: $('#gOfficer')?.value || '', track: $('#gTrack').value, campus: $('#gCampus').value, status: $('#gStatus').value });
  async function load() {
    const d = await api('/graduates?' + qs({ ...filters(), page, page_size: 50 }));
    $('#gCount').textContent = `${fmtN(d.total)} graduate(s)`;
    $('#gOut').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Full name</th><th>Phone</th><th>Track</th><th>Campus</th>${me.role !== 'officer' ? '<th>Officer</th>' : ''}<th>Current status</th><th>Last report</th></tr></thead><tbody>
      ${d.rows.map((r) => `<tr class="click" data-id="${r.graduate_id}"><td>${esc(r.full_name)}</td><td>${esc(r.phone)}</td><td>${esc(r.track)}</td><td>${esc(r.campus)}</td>
        ${me.role !== 'officer' ? `<td>${esc(r.officer)}</td>` : ''}<td><span class="pill">${esc(r.status_label)}</span></td><td>${esc(r.report_date || '')}</td></tr>`).join('')
        || '<tr><td colspan="7" class="muted">No graduates found.</td></tr>'}</tbody></table></div>
      <div class="pager"><button id="gPrev" ${d.page <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${d.page} of ${d.pages}</span><button id="gNext" ${d.page >= d.pages ? 'disabled' : ''}>Next</button></div>`;
    $('#gPrev').addEventListener('click', () => { page--; load().catch((e) => toast(e.message, true)); });
    $('#gNext').addEventListener('click', () => { page++; load().catch((e) => toast(e.message, true)); });
    $$('#gOut tr.click', el).forEach((tr) => tr.addEventListener('click', () => openGraduate(Number(tr.dataset.id)).catch((e) => toast(e.message, true))));
  }
  const go = () => { page = 1; load().catch((e) => toast(e.message, true)); };
  $$('#gOfficer,#gTrack,#gCampus,#gStatus', el).forEach((x) => x && x.addEventListener('change', go));
  $('#gQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  if (isAdmin) {
    $('#gAdd').addEventListener('click', () => graduateForm(null));
    $('#gImport').addEventListener('click', () => importDialog());
  }
  await load();
};

// ======================= Users (admin) =======================
function showTempPassword(user, pw) {
  const m = modal('Temporary password', `<p>Give this to <strong>${esc(user)}</strong>. They must change it at their first sign-in. It will not be shown again.</p>
    <p><input readonly value="${esc(pw)}" id="tmpPw" style="font-family:monospace;font-size:1.1rem"></p>
    <p class="toolbar"><button id="cpy">Copy</button><button class="primary" data-close>Done</button></p>`);
  $('[data-close]', m.el).addEventListener('click', m.close);
  $('#cpy', m.el).addEventListener('click', () => { $('#tmpPw', m.el).select(); navigator.clipboard?.writeText(pw).then(() => toast('Copied')); });
}

PAGES.users = async function (el) {
  el.innerHTML = `<h2>Users</h2><div class="card"><div class="toolbar">
    <select id="uRole" style="width:auto"><option value="">All roles</option><option value="officer">Project officers</option><option value="pm">Project managers</option><option value="admin">Administrators</option></select>
    <span class="spacer"></span><button class="primary" id="uAdd">Add user</button></div><div id="uOut"></div></div>`;
  async function load() {
    const { rows } = await api('/users?' + qs({ role: $('#uRole').value }));
    const RN = { admin: 'Administrator', pm: 'Project manager', officer: 'Project officer' };
    $('#uOut').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Username</th><th>Full name</th><th>Role</th><th class="num">Graduates</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.full_name)}</td><td>${RN[u.role]}</td><td class="num">${u.role === 'officer' ? u.graduate_count : ''}</td>
      <td>${u.active ? '<span class="pill">Active</span>' : '<span class="pill" style="background:#f7d9d6">Disabled</span>'}${u.must_change_password ? ' <span class="muted small">(default password)</span>' : ''}</td>
      <td class="right"><button data-edit="${u.id}">Edit</button> <button data-reset="${u.id}">Reset password</button></td></tr>`).join('')}</tbody></table></div>`;
    $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => userForm(rows.find((u) => u.id === Number(b.dataset.edit)))));
    $$('[data-reset]', el).forEach((b) => b.addEventListener('click', async () => {
      const u = rows.find((x) => x.id === Number(b.dataset.reset));
      if (!confirm(`Reset the password for ${u.username}? They will be signed out and must set a new password.`)) return;
      try { const r = await api(`/users/${u.id}/reset-password`, { method: 'POST', body: {} }); showTempPassword(u.username, r.temp_password); load(); } catch (e) { toast(e.message, true); }
    }));
  }
  function userForm(u) {
    const m = modal(u ? 'Edit user' : 'Add user', `<form id="uForm">
      <p><label class="req">Username</label><input name="username" value="${esc(u?.username)}" ${u ? 'disabled' : ''} required pattern="[A-Za-z0-9._\\-]{3,30}"></p>
      <p><label class="req">Full name</label><input name="full_name" value="${esc(u?.full_name)}" required maxlength="100"></p>
      <p><label>Role</label><select name="role">${opts([{ value: 'officer', label: 'Project officer' }, { value: 'pm', label: 'Project manager' }, { value: 'admin', label: 'Administrator' }], u?.role || 'officer')}</select></p>
      ${u ? `<p><label class="inline"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Account active (untick to block sign-in)</label></p>` : '<p class="muted small">A temporary password is generated; the user must change it at first sign-in.</p>'}
      <p class="toolbar"><button class="primary">Save</button><button type="button" data-close>Cancel</button></p></form>`);
    $('[data-close]', m.el).addEventListener('click', m.close);
    const f = $('#uForm', m.el);
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); showError(f);
      try {
        if (u) await api('/users/' + u.id, { method: 'PUT', body: { full_name: f.full_name.value, role: f.role.value, active: f.active.checked } });
        else { const r = await api('/users', { method: 'POST', body: { username: f.username.value, full_name: f.full_name.value, role: f.role.value } }); m.close(); showTempPassword(r.user.username, r.temp_password); load(); return; }
        toast('Saved'); m.close(); load();
      } catch (err) { showError(f, err.message); }
    });
  }
  $('#uRole').addEventListener('change', () => load().catch((e) => toast(e.message, true)));
  $('#uAdd').addEventListener('click', () => userForm(null));
  await load();
};
