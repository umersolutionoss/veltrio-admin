// =============================================================
//  Veltrio admin panel - Part 7.5
//  Leave: requests and approvals, balances and adjustments,
//  and the company's own leave rules, leave types and holidays
// =============================================================

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const FLOW = {
  manager_then_hr: ['Branch manager, then HR', 'The branch manager approves first, then HR gives the final approval. If a branch has no manager, HR approves directly.'],
  hr_only: ['HR only', 'Only HR (or the company admin) approves leave.'],
  any_approver: ['Any one approver', 'Anyone with the “Approve leave” permission can approve in one step.'],
};
const STATUS = {
  pending: ['Waiting', 'pill-trial'], manager_approved: ['Waiting for HR', 'pill-trial'],
  approved: ['Approved', 'pill-active'], rejected: ['Rejected', 'pill-expired'], cancelled: ['Cancelled', 'pill-expired'],
};

export function initLeavePage(ctx) {
  const { sb, state, shell, bindShell, esc, busy, friendlyError, today, can } = ctx;
  const cid = () => state.profile.company_id;
  const isAdmin = () => state.profile.role === 'company_admin';
  const app = () => document.getElementById('app');
  const fmt = (d) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(d + 'T00:00:00'));
  const fmtY = (d) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d + 'T00:00:00'));
  const nd = (n) => (Number(n) % 1 ? Number(n).toFixed(1) : String(Number(n)));
  const range = (r) => r.start_date === r.end_date ? fmt(r.start_date) + (r.half_day ? ', half day' : '') : `${fmt(r.start_date)} to ${fmt(r.end_date)}`;

  const msg = (err) => {
    const m = (err && err.message) || String(err);
    if (err && err.code === '23505') return 'This name or date already exists.';
    if (/row-level security|permission denied/i.test(m)) return 'You do not have permission to make this change.';
    if (/function .* does not exist|relation .* does not exist|schema cache/i.test(m)) return 'Run the Part 7.5 database update in Supabase first.';
    return friendlyError(err);
  };
  function alertIn(el, text, kind = 'error') {
    let box = el.querySelector(':scope > .alert');
    if (!box) { box = document.createElement('div'); el.prepend(box); }
    box.className = 'alert alert-' + kind; box.setAttribute('role', kind === 'error' ? 'alert' : 'status'); box.textContent = text;
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function toast(text, kind = 'ok') {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.className = 'toast toast-' + kind; t.textContent = text;
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hide'), 2800);
  }
  function dialog(title, html, okLabel, onOk) {
    const dlg = document.getElementById('dlg');
    dlg.innerHTML = `<form method="dialog" novalidate><h2>${esc(title)}</h2>${html}
      <div class="dlg-bar"><button class="btn btn-ghost" value="cancel" formnovalidate>Cancel</button><button class="btn" value="ok" id="d_ok">${esc(okLabel)}</button></div></form>`;
    dlg.onclose = null;
    const form = dlg.querySelector('form');
    dlg.querySelector('#d_ok').onclick = async (e) => {
      e.preventDefault();
      const btn = e.currentTarget;
      const label = btn.textContent;
      btn.disabled = true; btn.textContent = 'Saving…';
      try { const ok = await onOk(form); if (ok !== false) dlg.close(); }
      catch (err) { alertIn(form, msg(err)); }
      finally { btn.disabled = false; btn.textContent = label; }
    };
    if (!dlg.open) dlg.showModal();
    return form;
  }

  function page(tab, actions, body) {
    const tabs = [['requests', 'Requests'], ['balances', 'Balances'], ['setup', 'Rules and types']];
    app().innerHTML = shell('leave', `
      <div class="topbar">
        <div>
          <button class="btn btn-ghost menu-btn" data-menu type="button" aria-label="Open menu">Menu</button>
          <h1>Leave</h1>
        </div>
        ${actions ? `<div class="actions">${actions}</div>` : ''}
      </div>
      <nav class="tabs" aria-label="Leave sections">${tabs.map(([k, l]) => `<a href="#/leave?tab=${k}" class="${k === tab ? 'on' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
      <div id="body">${body}</div>
      <dialog id="dlg" class="dlg"></dialog>`);
    bindShell();
  }
  const loading = '<div class="panel"><p class="sub">Loading…</p></div>';

  async function common() {
    const [e, t, s] = await Promise.all([
      sb.from('employees').select('id, full_name, employee_code, home_branch_id, status').eq('company_id', cid()).order('full_name'),
      sb.from('leave_types').select('*').eq('company_id', cid()).order('sort').order('name'),
      sb.from('company_settings').select('*').eq('company_id', cid()).maybeSingle(),
    ]);
    for (const r of [e, t, s]) if (r.error) throw r.error;
    return { emps: e.data || [], types: t.data || [], settings: s.data || {} };
  }

  async function viewLeave(tab) {
    tab = ['requests', 'balances', 'setup'].includes(tab) ? tab : 'requests';
    page(tab, '', loading);
    let c;
    try { c = await common(); }
    catch (err) { return page(tab, '', `<div class="alert alert-error" role="alert">${esc(msg(err))}</div>`); }
    if (tab === 'requests') return requests(c);
    if (tab === 'balances') return balances(c);
    return setup(c);
  }

  // =============================================================
  // REQUESTS
  // =============================================================
  async function requests(c) {
    const approver = can('leave.approve');
    const addBtn = approver ? '<button class="btn" type="button" id="addLeave">Add leave</button>' : '';
    const { data, error } = await sb.from('leave_requests').select('*').eq('company_id', cid()).order('start_date', { ascending: false }).limit(500);
    if (error) return page('requests', addBtn, `<div class="alert alert-error" role="alert">${esc(msg(error))}</div>`);
    const rows = data || [];
    const emp = (id) => c.emps.find((e) => e.id === id);
    const type = (id) => c.types.find((t) => t.id === id);
    const waiting = rows.filter((r) => r.status === 'pending' || r.status === 'manager_approved').length;
    const flowNote = FLOW[c.settings.leave_approval_flow || 'manager_then_hr'][0];

    page('requests', addBtn, `
      <div class="filters">
        <select id="fs" aria-label="Filter by status">
          <option value="waiting">Waiting (${waiting})</option><option value="approved">Approved</option>
          <option value="rejected">Rejected</option><option value="cancelled">Cancelled</option><option value="">All</option>
        </select>
        <input id="q" type="search" placeholder="Search employee" aria-label="Search employee">
        <span class="hint flow-note">Approval: ${esc(flowNote)}</span>
      </div>
      <section class="panel flush">
        <div class="table-wrap"><table class="list">
          <thead><tr><th>Employee</th><th>Leave</th><th>Dates</th><th>Days</th><th>Reason</th><th>Status</th>${approver ? '<th><span class="sr-only">Actions</span></th>' : ''}</tr></thead>
          <tbody id="rows"></tbody>
        </table></div>
        <p class="empty small" id="none" hidden></p>
      </section>`);

    const draw = () => {
      const fs = document.getElementById('fs').value, q = document.getElementById('q').value.trim().toLowerCase();
      const list = rows.filter((r) => (fs === '' || (fs === 'waiting' ? ['pending', 'manager_approved'].includes(r.status) : r.status === fs))
        && (!q || (emp(r.employee_id)?.full_name || '').toLowerCase().includes(q)));
      const none = document.getElementById('none');
      none.hidden = list.length > 0;
      none.textContent = fs === 'waiting' ? 'No leave is waiting for approval.' : 'No leave requests match.';
      document.getElementById('rows').innerHTML = list.map((r) => {
        const e = emp(r.employee_id), t = type(r.leave_type_id);
        const [label, cls] = STATUS[r.status];
        const open = r.status === 'pending' || r.status === 'manager_approved';
        const note = r.final_note || r.manager_note;
        return `<tr>
          <td><b>${esc(e?.full_name || 'Removed employee')}</b> <span class="code">${esc(e?.employee_code || '')}</span></td>
          <td>${esc(t?.name || '')}${t && !t.is_paid ? ' <span class="hint">(unpaid)</span>' : ''}</td>
          <td class="num">${range(r)}</td>
          <td class="num">${nd(r.days)}</td>
          <td>${esc(r.reason || '')}${note ? `<div class="hint">Note: ${esc(note)}</div>` : ''}</td>
          <td><span class="pill ${cls}">${label}</span></td>
          ${approver ? `<td class="right nowrap">${open
            ? `<button class="btn btn-sm" data-act="approve" data-id="${r.id}">Approve</button> <button class="btn btn-ghost btn-sm" data-act="reject" data-id="${r.id}">Reject</button>`
            : r.status === 'approved' ? `<button class="btn btn-ghost btn-sm" data-act="cancel" data-id="${r.id}">Cancel</button>` : ''}</td>` : ''}
        </tr>`;
      }).join('');
      document.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => act(b.dataset.act, rows.find((r) => r.id === b.dataset.id)));
    };
    ['fs', 'q'].forEach((id) => document.getElementById(id).addEventListener('input', draw));
    draw();

    async function act(kind, r) {
      const e = emp(r.employee_id), t = type(r.leave_type_id);
      const who = `${esc(e?.full_name || '')}: ${esc(t?.name || '')}, ${range(r)} (${nd(r.days)} day${Number(r.days) === 1 ? '' : 's'})`;
      const title = kind === 'approve' ? 'Approve leave' : kind === 'reject' ? 'Reject leave' : 'Cancel approved leave';
      dialog(title, `<p>${who}</p>
        <div class="field"><label for="d_note">Note ${kind === 'approve' ? '<span class="opt">optional</span>' : ''}</label><input id="d_note" placeholder="${kind === 'reject' ? 'Reason for rejecting' : ''}"></div>
        ${kind === 'cancel' ? '<p class="hint">The leave days are removed from attendance and the balance comes back.</p>' : ''}`,
        kind === 'approve' ? 'Approve' : kind === 'reject' ? 'Reject' : 'Cancel leave', async (form) => {
          const note = form.querySelector('#d_note').value.trim() || null;
          if (kind === 'reject' && !note) { alertIn(form, 'Write a short reason, so the employee knows why.'); return false; }
          const res = kind === 'cancel'
            ? await sb.rpc('cancel_leave', { p_request: r.id, p_note: note })
            : await sb.rpc('review_leave', { p_request: r.id, p_approve: kind === 'approve', p_note: note });
          if (res.error) throw res.error;
          toast(kind === 'cancel' ? 'Leave cancelled' : res.data === 'manager_approved' ? 'Approved. Now waiting for HR.' : res.data === 'approved' ? 'Leave approved' : 'Leave rejected');
          viewLeave('requests');
        });
    }

    document.getElementById('addLeave')?.addEventListener('click', () => {
      const active = c.emps.filter((e) => e.status === 'active');
      const types = c.types.filter((t) => t.is_active);
      const form = dialog('Add leave', `
        <p class="hint">Leave you add here is approved at once.</p>
        <div class="field"><label for="d_emp">Employee</label><select id="d_emp"><option value="">Choose</option>${active.map((e) => `<option value="${e.id}">${esc(e.full_name)} (${esc(e.employee_code)})</option>`).join('')}</select></div>
        <div class="field"><label for="d_type">Leave type</label><select id="d_type">${types.map((t) => `<option value="${t.id}" data-half="${t.allow_half_day}">${esc(t.name)}</option>`).join('')}</select></div>
        <div class="row-2">
          <div class="field"><label for="d_from">From</label><input id="d_from" type="date" value="${today()}"></div>
          <div class="field"><label for="d_to">To</label><input id="d_to" type="date" value="${today()}"></div>
        </div>
        <label class="check"><input type="checkbox" id="d_half"> Half day</label>
        <div class="field"><label for="d_reason">Reason <span class="opt">optional</span></label><input id="d_reason"></div>`, 'Add leave', async (f) => {
          const v = { p_employee: f.querySelector('#d_emp').value, p_leave_type: f.querySelector('#d_type').value, p_start: f.querySelector('#d_from').value,
            p_end: f.querySelector('#d_half').checked ? f.querySelector('#d_from').value : f.querySelector('#d_to').value,
            p_half_day: f.querySelector('#d_half').checked, p_reason: f.querySelector('#d_reason').value.trim() || null };
          if (!v.p_employee || !v.p_leave_type || !v.p_start || !v.p_end) { alertIn(f, 'Choose the employee, leave type and dates.'); return false; }
          const { error } = await sb.rpc('submit_leave', v);
          if (error) throw error;
          toast('Leave added'); viewLeave('requests');
        });
      const half = form.querySelector('#d_half'), to = form.querySelector('#d_to'), ty = form.querySelector('#d_type');
      const sync = () => { const ok = ty.selectedOptions[0]?.dataset.half === 'true'; half.disabled = !ok; if (!ok) half.checked = false; to.disabled = half.checked; };
      half.onchange = sync; ty.onchange = sync; sync();
    });
  }

  // =============================================================
  // BALANCES
  // =============================================================
  async function balances(c) {
    const { data, error } = await sb.rpc('leave_balance_sheet', { p_on: today() });
    if (error) return page('balances', '', `<div class="alert alert-error" role="alert">${esc(msg(error))}</div>`);
    const types = c.types.filter((t) => t.is_active);
    const byEmp = {};
    for (const r of data || []) (byEmp[r.employee_id] = byEmp[r.employee_id] || {})[r.leave_type_id] = r;
    const emps = c.emps.filter((e) => byEmp[e.id]);
    const m = c.settings.leave_year_start_month || 1;
    const t0 = new Date(today() + 'T00:00:00');
    const y0 = t0.getMonth() + 1 >= m ? t0.getFullYear() : t0.getFullYear() - 1;
    const yearLabel = m === 1 ? `${y0}` : `${MONTHS[m - 1]} ${y0} to ${MONTHS[(m + 10) % 12]} ${y0 + 1}`;
    const yearStart = `${y0}-${String(m).padStart(2, '0')}-01`;
    const approver = can('leave.approve');

    page('balances', '', emps.length && types.length ? `
      <p class="sub">Leave year ${esc(yearLabel)}. Each cell shows days left, out of the yearly quota plus any adjustment.</p>
      <div class="filters"><input id="q" type="search" placeholder="Search employee" aria-label="Search employee"></div>
      <section class="panel flush">
        <div class="table-wrap"><table class="list bal">
          <thead><tr><th>Employee</th>${types.map((t) => `<th class="c">${esc(t.name)}${t.is_paid ? '' : ' <span class="hint">(unpaid)</span>'}</th>`).join('')}${approver ? '<th><span class="sr-only">Actions</span></th>' : ''}</tr></thead>
          <tbody id="rows">${emps.map((e) => `<tr data-name="${esc(e.full_name.toLowerCase())}">
            <td><b>${esc(e.full_name)}</b> <span class="code">${esc(e.employee_code)}</span></td>
            ${types.map((t) => {
              const b = byEmp[e.id][t.id];
              if (!b) return '<td class="c">–</td>';
              const total = Number(b.quota) + Number(b.adjusted);
              if (!t.is_paid) return `<td class="c num">${nd(b.used)} <span class="hint">used</span></td>`;
              const low = Number(b.remaining) <= 0;
              return `<td class="c num"><b class="${low ? 'neg' : ''}">${nd(b.remaining)}</b><span class="hint"> / ${nd(total)}</span>${Number(b.pending) ? `<div class="hint">${nd(b.pending)} waiting</div>` : ''}</td>`;
            }).join('')}
            ${approver ? `<td class="right"><button class="btn btn-ghost btn-sm" data-adj="${e.id}">Adjust</button></td>` : ''}
          </tr>`).join('')}</tbody>
        </table></div>
      </section>` : `<section class="panel"><div class="empty"><h2>No balances yet</h2><p>${types.length ? 'Add active employees to see their leave balance.' : 'Add leave types in “Rules and types”.'}</p></div></section>`);

    document.getElementById('q')?.addEventListener('input', (ev) => {
      const q = ev.target.value.trim().toLowerCase();
      document.querySelectorAll('#rows tr').forEach((tr) => { tr.hidden = q && !tr.dataset.name.includes(q); });
    });
    document.querySelectorAll('[data-adj]').forEach((b) => b.onclick = () => {
      const e = c.emps.find((x) => x.id === b.dataset.adj);
      dialog(`Adjust leave for ${e.full_name}`, `
        <p class="hint">Use this for carry forward from last year, extra days given, or a correction. Applies to leave year ${esc(yearLabel)}.</p>
        <div class="field"><label for="d_type">Leave type</label><select id="d_type">${types.filter((t) => t.is_paid).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="d_days">Days</label><input id="d_days" type="number" step="0.5" placeholder="5 to add, -2 to remove"></div>
        <div class="field"><label for="d_reason">Reason</label><input id="d_reason" placeholder="Carry forward from last year"></div>`, 'Save adjustment', async (f) => {
        const days = Number(f.querySelector('#d_days').value), reason = f.querySelector('#d_reason').value.trim();
        if (!days || Math.abs(days) > 365 || (days * 2) % 1) { alertIn(f, 'Enter days like 5, 1.5 or -2.'); return false; }
        if (!reason) { alertIn(f, 'Write a reason, so the change is clear later.'); return false; }
        const { error } = await sb.from('leave_adjustments').insert({ company_id: cid(), employee_id: e.id, leave_type_id: f.querySelector('#d_type').value,
          year_start: yearStart, days, reason, created_by: state.session.user.id });
        if (error) throw error;
        toast('Balance adjusted'); viewLeave('balances');
      });
    });
  }

  // =============================================================
  // RULES, TYPES AND HOLIDAYS
  // =============================================================
  async function setup(c) {
    const s = c.settings;
    const rulesEditable = isAdmin();
    const setupEditable = can('setup.manage');
    const y = new Date().getFullYear();
    const { data: hol } = await sb.from('holidays').select('*').eq('company_id', cid()).gte('holiday_date', `${y}-01-01`).order('holiday_date');
    const holidays = hol || [];

    page('setup', '', `
      <section class="panel">
        <h2>Leave rules</h2>
        <p class="sub">How leave works in your company. The mobile app and approvals follow these rules.</p>
        <form id="rf" novalidate>
          ${rulesEditable ? '' : '<p class="note">Only the company admin can change leave rules.</p>'}
          <fieldset ${rulesEditable ? '' : 'disabled'}>
            <div class="field"><span class="label">Who approves leave</span>
              <div class="choices">${Object.entries(FLOW).map(([k, [l, d]]) => `
                <label class="choice"><input type="radio" name="flow" value="${k}" ${k === s.leave_approval_flow ? 'checked' : ''}><span><b>${l}</b><span class="hint">${d}</span></span></label>`).join('')}</div>
            </div>
            <div class="row-2">
              <div class="field"><label for="r_month">Leave year starts in</label><select id="r_month">${MONTHS.map((mn, i) => `<option value="${i + 1}" ${i + 1 === s.leave_year_start_month ? 'selected' : ''}>${mn}</option>`).join('')}</select><span class="hint">Balances reset at the start of the leave year.</span></div>
              <div class="field"><label for="r_mode">Count leave days as</label>
                <select id="r_mode"><option value="working" ${s.leave_count_mode === 'working' ? 'selected' : ''}>Working days only</option><option value="calendar" ${s.leave_count_mode === 'calendar' ? 'selected' : ''}>All calendar days</option></select>
                <span class="hint">Working days skip weekly off days and holidays.</span></div>
            </div>
            <div class="field"><span class="label">Weekly off day for everyone</span>
              <div class="daypick">${DAYS.map((d, i) => `<label><input type="checkbox" name="off" value="${i}" ${(s.weekly_off_days || []).includes(i) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div>
              <span class="hint">You can give an employee a different off day on their profile.</span></div>
            <label class="check"><input type="checkbox" id="r_exceed" ${s.leave_allow_exceed ? 'checked' : ''}> Allow leave beyond the balance</label>
            <p class="hint">When this is off, the app stops a request if the employee has no days left.</p>
            <div class="form-end"><button class="btn" type="submit">Save rules</button></div>
          </fieldset>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head"><div><h2>Leave types</h2><p class="sub">Yearly quota for each type. Unpaid leave is cut from salary.</p></div>
          ${setupEditable ? '<button class="btn btn-ghost btn-sm" type="button" id="addType">Add leave type</button>' : ''}</div>
        ${c.types.length ? `<div class="table-wrap"><table class="list">
          <thead><tr><th>Type</th><th>Days per year</th><th>Paid</th><th>Half day</th><th>Status</th>${setupEditable ? '<th><span class="sr-only">Actions</span></th>' : ''}</tr></thead>
          <tbody>${c.types.map((t) => `<tr class="${t.is_active ? '' : 'muted-row'}">
            <td><b>${esc(t.name)}</b></td><td class="num">${t.is_paid ? nd(t.yearly_quota) : '<span class="hint">No limit</span>'}</td>
            <td>${t.is_paid ? 'Paid' : 'Unpaid'}</td><td>${t.allow_half_day ? 'Allowed' : 'No'}</td>
            <td>${t.is_active ? '<span class="pill pill-active">In use</span>' : '<span class="pill pill-expired">Off</span>'}</td>
            ${setupEditable ? `<td class="right"><button class="btn btn-ghost btn-sm" data-type="${t.id}">Edit</button></td>` : ''}</tr>`).join('')}</tbody>
        </table></div>` : '<p class="hint">No leave types yet.</p>'}
      </section>

      <section class="panel">
        <div class="panel-head"><div><h2>Holidays ${y}</h2><p class="sub">Public and company holidays. They are not counted as leave and are paid in payroll.</p></div></div>
        ${holidays.length ? `<ul class="duties">${holidays.map((h) => `<li><div><b>${esc(h.name)}</b><span class="hint">${fmtY(h.holiday_date)}, ${DAYS[new Date(h.holiday_date + 'T00:00:00').getDay()]}</span></div>
          ${setupEditable ? `<button type="button" class="btn btn-ghost btn-sm" data-delhol="${h.id}" data-name="${esc(h.name)}">Remove</button>` : ''}</li>`).join('')}</ul>` : '<p class="hint">No holidays added for this year.</p>'}
        ${setupEditable ? `<form class="hol-add" id="hf" novalidate>
          <div class="field"><label for="h_date">Date</label><input id="h_date" type="date"></div>
          <div class="field"><label for="h_name">Holiday</label><input id="h_name" placeholder="Pakistan Day"></div>
          <button class="btn btn-ghost" type="submit">Add holiday</button>
        </form>` : ''}
      </section>`);

    // rules
    const rf = document.getElementById('rf');
    rf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = {
        leave_approval_flow: rf.querySelector('input[name=flow]:checked')?.value || 'manager_then_hr',
        leave_year_start_month: Number(rf.querySelector('#r_month').value),
        leave_count_mode: rf.querySelector('#r_mode').value,
        weekly_off_days: [...rf.querySelectorAll('input[name=off]:checked')].map((x) => Number(x.value)),
        leave_allow_exceed: rf.querySelector('#r_exceed').checked,
      };
      if (v.weekly_off_days.length > 3) return alertIn(rf, 'Choose at most 3 weekly off days.');
      const btn = rf.querySelector('button[type=submit]'); busy(btn, true, 'Saving…');
      const { error } = await sb.from('company_settings').update(v).eq('company_id', cid());
      busy(btn, false);
      if (error) return alertIn(rf, msg(error));
      alertIn(rf, 'Leave rules saved.', 'ok');
    });

    // types
    const openType = (t) => {
      const isNew = !t; t = t || { yearly_quota: 0, is_paid: true, allow_half_day: true, is_active: true };
      dialog(isNew ? 'Add leave type' : `Edit ${t.name}`, `
        <div class="field"><label for="d_name">Name</label><input id="d_name" value="${esc(t.name)}" placeholder="Maternity"></div>
        <label class="check"><input type="checkbox" id="d_paid" ${t.is_paid ? 'checked' : ''}> Paid leave</label>
        <div class="field" id="quotaWrap"><label for="d_quota">Days per year</label><input id="d_quota" type="number" min="0" max="365" step="0.5" value="${nd(t.yearly_quota)}"></div>
        <label class="check"><input type="checkbox" id="d_half" ${t.allow_half_day ? 'checked' : ''}> Can be taken as a half day</label>
        ${isNew ? '' : `<label class="check"><input type="checkbox" id="d_active" ${t.is_active ? 'checked' : ''}> In use</label>`}`, isNew ? 'Add type' : 'Save type', async (f) => {
        const v = { name: f.querySelector('#d_name').value.trim(), is_paid: f.querySelector('#d_paid').checked,
          yearly_quota: f.querySelector('#d_paid').checked ? Number(f.querySelector('#d_quota').value || 0) : 0,
          allow_half_day: f.querySelector('#d_half').checked };
        if (!isNew) v.is_active = f.querySelector('#d_active').checked;
        if (!v.name) { alertIn(f, 'Enter a name.'); return false; }
        if (v.yearly_quota < 0 || v.yearly_quota > 365) { alertIn(f, 'Days per year must be between 0 and 365.'); return false; }
        const res = isNew ? await sb.from('leave_types').insert({ ...v, company_id: cid(), sort: c.types.length + 1 }) : await sb.from('leave_types').update(v).eq('id', t.id);
        if (res.error) throw res.error;
        toast(isNew ? `${v.name} added` : 'Leave type saved'); viewLeave('setup');
      });
      const paid = document.querySelector('#dlg #d_paid'), wrap = document.querySelector('#dlg #quotaWrap');
      const sync = () => { wrap.hidden = !paid.checked; }; paid.onchange = sync; sync();
    };
    document.getElementById('addType')?.addEventListener('click', () => openType(null));
    document.querySelectorAll('[data-type]').forEach((b) => b.onclick = () => openType(c.types.find((t) => t.id === b.dataset.type)));

    // holidays
    const hf = document.getElementById('hf');
    hf?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = hf.querySelector('#h_date').value, n = hf.querySelector('#h_name').value.trim();
      if (!d || !n) return alertIn(hf, 'Enter the date and the holiday name.');
      const btn = hf.querySelector('button'); busy(btn, true, 'Adding…');
      const { error } = await sb.from('holidays').insert({ company_id: cid(), holiday_date: d, name: n });
      busy(btn, false);
      if (error) return alertIn(hf, msg(error));
      toast(`${n} added`); viewLeave('setup');
    });
    document.querySelectorAll('[data-delhol]').forEach((b) => b.onclick = async () => {
      if (!confirm(`Remove the holiday "${b.dataset.name}"?`)) return;
      const { error } = await sb.from('holidays').delete().eq('id', b.dataset.delhol);
      if (error) return toast(msg(error), 'error');
      toast('Holiday removed'); viewLeave('setup');
    });
  }

  return { viewLeave };
}
