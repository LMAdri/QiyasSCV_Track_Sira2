'use strict';
/* Employment reporting form (officers; admin may report on anyone's behalf), report history and notifications. */

PAGES.record = async function (el, params) {
  const isAdmin = me.role === 'admin';
  const editing = params.edit ? (await api('/records/' + params.edit)).record : null;
  let currentGrad = editing ? editing.graduate_id : Number(params.graduate) || '';
  const R = meta.rules;
  const v = editing || {};

  el.innerHTML = `<h2>${editing ? 'Edit employment report' : 'Record employment status'}</h2>
  <div class="grid2">
  <form id="rForm" class="card" enctype="multipart/form-data" novalidate>
    <h3>1. Reporting date</h3>
    <p><label class="inline"><input type="radio" name="dmode" value="single" ${v.report_date_end ? '' : 'checked'}> Single date</label>
       <label class="inline"><input type="radio" name="dmode" value="range" ${v.report_date_end ? 'checked' : ''}> Date range</label></p>
    <div class="grid">
      <div><label class="req" id="lblDate">Date of reporting</label><input type="date" name="report_date" value="${esc(v.report_date || todayStr())}" required></div>
      <div id="endBox" hidden><label class="req">To date</label><input type="date" name="report_date_end" value="${esc(v.report_date_end || '')}"></div>
    </div>

    <h3 style="margin-top:1rem">2. Graduate</h3>
    ${isAdmin ? `<p><label>Filter by project officer</label><select id="rOfficer">${officerOpts('')}</select></p>` : ''}
    <p><label class="req">Select graduate</label>
       <input id="gFilter" placeholder="Type to filter the list by name" style="margin-bottom:.3rem" ${editing ? 'disabled' : ''}>
       <select name="graduate_id" id="gSel" required ${editing ? 'disabled' : ''}></select>
       ${editing ? `<input type="hidden" name="graduate_id" value="${editing.graduate_id}">` : ''}</p>

    <h3 style="margin-top:1rem">3. Employment status</h3>
    <p><label class="req">Employment status</label><select name="status" id="sSel" required>${opts(meta.statuses.map((s) => ({ value: s.id, label: `${s.id}. ${s.label}` })), v.status, 'Select status')}</select></p>
    <div id="statusFields" hidden>
      <p><label>Details / description for this status</label><textarea name="status_detail" maxlength="4000">${esc(v.status_detail)}</textarea></p>
      <div class="grid">
        <div data-st="2"><label>Date of application / CV sent</label><input type="date" name="application_date" value="${esc(v.application_date)}"></div>
        <div data-st="3"><label class="req">Expected date of interview / exam</label><input type="date" name="interview_date" value="${esc(v.interview_date)}"></div>
        <div data-st="4,5,6"><label>Date of interview / exam</label><input type="date" name="interview_date" value="${esc(v.interview_date)}"></div>
        <div data-st="6"><label class="req">Expected date of offer</label><input type="date" name="expected_offer_date" value="${esc(v.expected_offer_date)}"></div>
        <div data-st="7,8"><label>Date offer letter was received</label><input type="date" name="offer_received_date" value="${esc(v.offer_received_date)}"></div>
        <div data-st="7,9"><label>Salary (ETB / month)</label><input name="salary" inputmode="decimal" value="${esc(v.salary ?? '')}" placeholder="e.g. 12000"></div>
      </div>
      <div id="notifyHint" class="notice small" hidden></div>
      <div id="companyBox" class="grid" style="margin-top:.6rem">
        <div><label class="req" id="lblCompany">Company name</label><input name="company_name" value="${esc(v.company_name)}" maxlength="200"></div>
        <div><label>Position</label><input name="position" value="${esc(v.position)}" maxlength="200"></div>
        <div><label>City the company is located in</label><input name="company_city" value="${esc(v.company_city)}" maxlength="100"></div>
        <div><label>Company location</label><input name="company_location" value="${esc(v.company_location)}" maxlength="300"></div>
        <div><label>Company contact person</label><input name="contact_person" value="${esc(v.contact_person)}" maxlength="150"></div>
        <div><label>Company tel no</label><input name="company_tel" value="${esc(v.company_tel)}" maxlength="40" inputmode="tel"></div>
        <div class="span-all"><label>Company description</label><textarea name="company_description" maxlength="3000">${esc(v.company_description)}</textarea></div>
      </div>
      <div data-st="7" id="pdfBox" style="margin-top:.6rem">
        <label>Offer letter (PDF, max 5 MB)</label><input type="file" name="offer_letter" accept="application/pdf,.pdf">
        ${editing?.has_offer_letter ? `<p class="small">Current file: <a target="_blank" rel="noopener" href="/api/records/${editing.id}/offer-letter">view offer letter</a>
          &middot; <label class="inline"><input type="checkbox" name="remove_offer_letter" value="1"> remove it</label></p>` : ''}
      </div>
    </div>
    <p class="toolbar" style="margin-top:1rem"><button class="primary" id="saveBtn">${editing ? 'Save changes' : 'Save report'}</button>
      ${editing ? '<a class="btn" href="#/submissions">Cancel</a>' : ''}</p>
  </form>
  <div class="card" id="gInfo"><p class="muted">Select a graduate to see their details and previous reports.</p></div>
  </div>`;

  const f = $('#rForm', el);
  const gSel = $('#gSel', el);
  let allGrads = [];

  // ---- reporting date vs range ----
  const syncMode = () => {
    const range = f.dmode.value === 'range';
    $('#endBox', el).hidden = !range;
    f.report_date_end.disabled = !range;
    $('#lblDate', el).textContent = range ? 'From date' : 'Date of reporting';
  };
  $$('input[name=dmode]', f).forEach((r) => r.addEventListener('change', syncMode));
  syncMode();

  // ---- graduate drop-down (fetched from the server: officers only ever receive their own graduates) ----
  const fillGrads = () => {
    const t = $('#gFilter', el).value.trim().toLowerCase();
    const list = allGrads.filter((g) => !t || g.full_name.toLowerCase().includes(t));
    gSel.innerHTML = `<option value="">${allGrads.length ? `Select graduate (${list.length} of ${allGrads.length})` : 'No graduates assigned'}</option>` +
      list.map((g) => `<option value="${g.graduate_id}"${g.graduate_id === Number(currentGrad) ? ' selected' : ''}>${esc(g.full_name)} - ${esc(g.phone)}</option>`).join('');
  };
  async function loadGrads() {
    const d = await api('/graduates?' + qs({ page_size: 2000, officer_id: $('#rOfficer')?.value || '' }));
    allGrads = d.rows;
    if (editing && !allGrads.find((g) => g.graduate_id === editing.graduate_id)) {
      try { const x = await api('/graduates/' + editing.graduate_id); allGrads.push({ graduate_id: x.graduate.id, full_name: `${x.graduate.first_name} ${x.graduate.father_name} ${x.graduate.grandfather_name}`, phone: x.graduate.phone }); } catch (_) { /* ignore */ }
    }
    fillGrads();
    showGradInfo();
  }
  $('#gFilter', el).addEventListener('input', fillGrads);
  if ($('#rOfficer', el)) $('#rOfficer', el).addEventListener('change', () => { currentGrad = ''; loadGrads(); });
  gSel.addEventListener('change', () => { currentGrad = gSel.value; showGradInfo(); });

  async function showGradInfo() {
    const box = $('#gInfo', el);
    if (!currentGrad) { box.innerHTML = '<p class="muted">Select a graduate to see their details and previous reports.</p>'; return; }
    try {
      const { graduate: g, records } = await api('/graduates/' + currentGrad);
      box.innerHTML = `<h3>${esc(g.first_name)} ${esc(g.father_name)} ${esc(g.grandfather_name)}</h3>
        <p class="small muted">${esc(g.track)} &middot; ${esc(g.campus)} &middot; ${esc(g.phone)}</p>
        <p><strong>Current status:</strong> ${records[0] ? `<span class="pill">${esc(records[0].status_label)}</span> <span class="muted small">(${esc(records[0].report_date)})</span>` : '<span class="muted">Not yet reported</span>'}</p>
        <h3 style="margin-top:1rem">Previous reports</h3>
        ${records.map((r) => `<div class="hist-row"><strong>${esc(r.status_label)}</strong> <span class="muted small">&middot; ${esc(r.report_date)}${r.report_date_end ? ' to ' + esc(r.report_date_end) : ''}</span>
          <div class="small">${[r.company_name && esc(r.company_name), r.position && esc(r.position), r.salary != null && fmtN(r.salary) + ' ETB'].filter(Boolean).join(' &middot; ')}</div>
          ${r.status_detail ? `<div class="small">${esc(r.status_detail)}</div>` : ''}
          <div class="small"><a href="#/record?edit=${r.id}">Edit</a>${r.has_offer_letter ? ` &middot; <a target="_blank" rel="noopener" href="/api/records/${r.id}/offer-letter">Offer letter (PDF)</a>` : ''}</div></div>`).join('') || '<p class="muted">No reports yet.</p>'}`;
    } catch (e) { box.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  }

  // ---- status-dependent fields ----
  const applyStatus = () => {
    const s = Number(f.status.value) || 0;
    $('#statusFields', el).hidden = !s;
    $$('[data-st]', f).forEach((d) => {
      const on = d.dataset.st.split(',').map(Number).includes(s);
      d.hidden = !on;
      $$('input,select,textarea', d).forEach((i) => { i.disabled = !on; });
    });
    const hasCompany = R.company.includes(s);
    $('#companyBox', el).hidden = !hasCompany;
    $$('input,textarea', $('#companyBox', el)).forEach((i) => { i.disabled = !hasCompany; });
    $('#lblCompany', el).textContent = s === 2 ? 'Company applied to' : s === 10 ? 'Name of your company' : 'Company name';
    const hint = $('#notifyHint', el);
    hint.hidden = !(s === 3 || s === 6);
    hint.textContent = s === 3 ? 'You and the administrator will get in-app reminders 3 days and 1 day before the interview / exam.'
      : s === 6 ? 'You and the administrator will get an in-app reminder 3 days before the expected offer date.' : '';
  };
  f.status.addEventListener('change', applyStatus);
  applyStatus();

  // ---- submit ----
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); showError(f);
    if (!(f.graduate_id.value || $('input[type=hidden][name=graduate_id]', f))) return showError(f, 'Please select a graduate');
    if (!f.status.value) return showError(f, 'Please select the employment status');
    const fd = new FormData(f);
    if (editing) fd.set('graduate_id', editing.graduate_id);
    fd.delete('dmode');
    const file = f.offer_letter && f.offer_letter.files[0];
    if (file && file.size > 5 * 1024 * 1024) return showError(f, 'The PDF must be 5 MB or smaller');
    await withBusy($('#saveBtn', f), async () => {
      try {
        if (editing) await api('/records/' + editing.id, { method: 'PUT', form: fd });
        else await api('/records', { method: 'POST', form: fd });
        toast('Report saved');
        if (editing) { location.hash = '#/submissions'; return; }
        const keepDate = f.report_date.value; const keepGrad = currentGrad;
        f.status.value = ''; f.status_detail.value = '';
        $$('#statusFields input:not([type=radio]):not([type=checkbox]),#statusFields textarea', f).forEach((i) => { i.value = ''; });
        applyStatus(); f.report_date.value = keepDate; currentGrad = keepGrad;
        showGradInfo();
      } catch (err) { showError(f, err.message); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    });
  });

  await loadGrads();
};

// ======================= Reports history =======================
PAGES.submissions = async function (el) {
  el.innerHTML = `<h2>${me.role === 'officer' ? 'My reports' : 'All reports'}</h2><div class="card">
    <div class="filters"><div><label>From</label><input type="date" id="sFrom"></div><div><label>To</label><input type="date" id="sTo"></div>
    ${me.role !== 'officer' ? `<div><label>Project officer</label><select id="sOff">${officerOpts('')}</select></div>` : ''}
    <div><button class="primary" id="sGo">Apply</button></div></div><div id="sOut"></div></div>`;
  let page = 1;
  async function load() {
    const d = await api('/records?' + qs({ date_from: $('#sFrom').value, date_to: $('#sTo').value, officer_id: $('#sOff')?.value || '', page, page_size: 25 }));
    $('#sOut').innerHTML = `<p class="muted">${fmtN(d.total)} report(s)</p><div class="table-wrap"><table><thead><tr><th>Reported</th><th>Graduate</th><th>Status</th><th>Company</th><th>Key dates</th><th></th></tr></thead><tbody>
      ${d.rows.map((r) => `<tr><td>${esc(r.report_date)}${r.report_date_end ? ' &rarr; ' + esc(r.report_date_end) : ''}</td><td>${esc(r.graduate_name)}</td><td><span class="pill">${esc(r.status_label)}</span></td>
      <td>${esc(r.company_name || '')}</td><td class="small">${[r.interview_date && 'Interview: ' + esc(r.interview_date), r.expected_offer_date && 'Offer expected: ' + esc(r.expected_offer_date)].filter(Boolean).join('<br>')}</td>
      <td class="right">${me.role !== 'pm' ? `<a href="#/record?edit=${r.id}">Edit</a>` : ''}${r.has_offer_letter ? ` &middot; <a target="_blank" rel="noopener" href="/api/records/${r.id}/offer-letter">PDF</a>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="6" class="muted">No reports yet.</td></tr>'}</tbody></table></div>
      <div class="pager"><button id="sPrev" ${d.page <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${d.page} of ${d.pages}</span><button id="sNext" ${d.page >= d.pages ? 'disabled' : ''}>Next</button></div>`;
    $('#sPrev').addEventListener('click', () => { page--; load().catch((e) => toast(e.message, true)); });
    $('#sNext').addEventListener('click', () => { page++; load().catch((e) => toast(e.message, true)); });
  }
  $('#sGo').addEventListener('click', () => { page = 1; load().catch((e) => toast(e.message, true)); });
  await load();
};

// ======================= Notifications =======================
PAGES.notifications = async function (el) {
  async function load() {
    const d = await api('/notifications');
    el.innerHTML = `<h2>Notifications</h2><div class="card"><div class="toolbar"><span class="muted">${d.unread} unread</span><span class="spacer"></span>
      <button id="nAll" ${d.unread ? '' : 'disabled'}>Mark all as read</button></div>
      ${d.rows.map((n) => `<div class="notif${n.is_read ? '' : ' unread'}" data-id="${n.id}"><span>${n.kind === 'interview' ? '&#128197;' : '&#128188;'}</span><span>${esc(n.message)}</span>
        <span class="when">${esc(n.created_at.slice(0, 16))}</span></div>`).join('') || '<p class="muted">No notifications yet. Reminders for upcoming interviews / exams and expected job offers appear here.</p>'}</div>`;
    $('#nAll', el).addEventListener('click', async () => { await api('/notifications/read-all', { method: 'POST' }); load(); refreshBell(); });
    $$('.notif.unread', el).forEach((n) => n.addEventListener('click', async () => { await api(`/notifications/${n.dataset.id}/read`, { method: 'POST' }); load(); refreshBell(); }));
  }
  await load();
  refreshBell();
};
