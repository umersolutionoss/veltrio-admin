// =============================================================
//  Veltrio admin panel - Part 7.3 / 7.4
//  Employees: list, add/edit, shift, pay, temporary duty at another
//  branch, and app login (create, reset password, turn off, reset phone)
// =============================================================

const STATUS = { active: 'Active', inactive: 'Inactive', resigned: 'Resigned', terminated: 'Terminated' };
const ROLE_LABEL = { employee: 'Employee (mobile app)', branch_manager: 'Branch manager', hr: 'HR' };
const WORK_MODE = {
  fixed: ['Fixed branch', 'Checks in at the home branch, or at a branch where you give duty below.'],
  floater: ['Floater', 'Can check in at any branch. One branch per day.'],
  field: ['Field staff', 'Visits several branches a day. Each visit is recorded with time and location.'],
};
const COMMISSION = { none: 'No commission', percentage: 'Percentage of sales', fixed: 'Fixed amount per month' };

export function initEmployeesPage(ctx) {
  const { sb, state, shell, bindShell, esc, busy, friendlyError, today, can } = ctx;
  const cid = () => state.profile.company_id;
  const canManage = () => can('employees.manage');
  const canOpen = () => can('employees.manage') || can('logins.manage') || can('pay.view');
  const grantable = () => isAdmin() ? ['employee', 'branch_manager', 'hr'] : state.profile.role === 'hr' ? ['employee', 'branch_manager'] : ['employee'];
  const isAdmin = () => state.profile.role === 'company_admin';
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const money = (n) => 'Rs ' + new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(Number(n) || 0);
  const fmtDate = (d) => (d ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d + 'T00:00:00')) : '');
  const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const app = () => document.getElementById('app');

  function page(title, sub, actions, body) {
    app().innerHTML = shell('employees', `
      <div class="topbar">
        <div>
          <button class="btn btn-ghost menu-btn" data-menu type="button" aria-label="Open menu">Menu</button>
          <h1>${esc(title)}</h1>
          ${sub ? `<p class="sub">${sub}</p>` : ''}
        </div>
        ${actions ? `<div class="actions">${actions}</div>` : ''}
      </div>
      <div id="body">${body}</div>`);
    bindShell();
  }

  function dbError(err) {
    const m = (err && err.message) || String(err);
    if (err && err.code === '23505') {
      if (/user_id/.test(m)) return 'This login is already linked to another employee.';
      return 'Another employee already has this employee code. Use a different code.';
    }
    if (/row-level security|permission denied/i.test(m)) return 'You do not have permission to make this change.';
    return friendlyError(err);
  }

  function formAlert(form, msg, kind = 'error') {
    let box = form.querySelector(':scope > .alert');
    if (!box) { box = document.createElement('div'); form.prepend(box); }
    box.className = 'alert alert-' + kind;
    box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    box.textContent = msg;
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function toast(msg, kind = 'ok') {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.className = 'toast toast-' + kind; t.textContent = msg;
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hide'), 2800);
  }

  async function callStaff(body) {
    const { data, error } = await sb.functions.invoke('staff-login', { body });
    if (!error) return data;
    let msg = '';
    try { msg = (await error.context.json()).error || ''; } catch { /* no JSON body */ }
    const status = error.context?.status;
    if (!msg && (status === 404 || /FunctionsFetchError|Failed to send/i.test(error.name + error.message))) {
      msg = 'The staff login service is not set up yet. Deploy the "staff-login" function in Supabase (see the setup steps).';
    }
    throw new Error(msg || error.message);
  }

  function nextCode(rows) {
    let max = 0;
    for (const r of rows) { const m = /^E(\d+)$/i.exec(r.employee_code || ''); if (m) max = Math.max(max, Number(m[1])); }
    return 'E' + String(max + 1).padStart(2, '0');
  }

  async function loadLookups() {
    const [b, dp, dg, sh, co] = await Promise.all([
      sb.from('branches').select('id, name, is_active').eq('company_id', cid()).order('name'),
      sb.from('departments').select('id, name').eq('company_id', cid()).order('name'),
      sb.from('designations').select('id, name').eq('company_id', cid()).order('name'),
      sb.from('shifts').select('id, name, start_time, end_time, is_active').eq('company_id', cid()).order('start_time'),
      sb.from('companies').select('login_code').eq('id', cid()).maybeSingle(),
    ]);
    for (const r of [b, dp, dg, sh, co]) if (r.error) throw r.error;
    return { branches: b.data || [], departments: dp.data || [], designations: dg.data || [], shifts: sh.data || [], loginCode: co.data?.login_code || '' };
  }

  // =============================================================
  // LIST
  // =============================================================
  async function viewEmployees(editId) {
    page('Employees', '', '', '<div class="panel"><p class="sub">Loading…</p></div>');
    let emps, look, logins;
    try {
      const [e, l, p] = await Promise.all([
        sb.from('employees').select('*').eq('company_id', cid()).order('employee_code'),
        loadLookups(),
        sb.from('users_profile').select('id, role, is_active').eq('company_id', cid()),
      ]);
      if (e.error) throw e.error;
      emps = e.data || []; look = l; logins = p.data || [];
    } catch (err) {
      return page('Employees', '', '', `<div class="alert alert-error" role="alert">Could not load employees: ${esc(friendlyError(err))}</div>`);
    }

    if (editId) {
      if (editId === 'new') { if (!canManage()) { location.hash = '#/employees'; return; } return editor(null, emps, look); }
      const emp = emps.find((x) => x.id === editId);
      if (!emp) { location.hash = '#/employees'; return; }
      return editor(emp, emps, look);
    }

    const active = emps.filter((x) => x.status === 'active').length;
    const max = state.sub?.plans?.max_employees;
    const usage = max ? `${active} of ${max} active employees on your ${esc(state.sub.plans.name)} plan.` : `${active} active employees.`;
    const full = max && active >= max;
    const addBtn = !canManage() ? '' : full
      ? '<span class="hint">Employee limit reached. Upgrade your plan to add more.</span>'
      : '<a class="btn" href="#/employees?edit=new">Add employee</a>';
    const bName = (id) => look.branches.find((b) => b.id === id)?.name || '';
    const dName = (id) => look.designations.find((d) => d.id === id)?.name || '';
    const loginOf = (e) => logins.find((p) => p.id === e.user_id);

    if (!emps.length) {
      return page('Employees', usage, addBtn, `
        <section class="panel"><div class="empty">
          <h2>Add your first employee</h2>
          <p>${look.branches.length ? 'Add staff details, then create their app login so they can check in.' : 'Add a branch first, so you can choose where each employee works.'}</p>
          ${canManage() ? (look.branches.length ? '<a class="btn" href="#/employees?edit=new">Add employee</a>' : '<a class="btn" href="#/branches?edit=new">Add branch</a>') : ''}
        </div></section>`);
    }

    page('Employees', usage, addBtn, `
      <div class="filters">
        <input id="q" type="search" placeholder="Search name, code, phone or CNIC" aria-label="Search employees">
        <select id="fb" aria-label="Filter by branch"><option value="">All branches</option>${look.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>
        <select id="fs" aria-label="Filter by status"><option value="active">Active</option><option value="">All statuses</option>${Object.entries(STATUS).filter(([k]) => k !== 'active').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      </div>
      <section class="panel flush">
        <div class="table-wrap"><table class="list">
          <thead><tr><th>Employee</th><th>Branch</th><th>Designation</th><th>Phone</th><th>App login</th><th>Status</th>${canOpen() ? '<th><span class="sr-only">Actions</span></th>' : ''}</tr></thead>
          <tbody id="rows"></tbody>
        </table></div>
        <p class="empty small" id="none" hidden>No employees match these filters.</p>
      </section>`);

    const draw = () => {
      const q = document.getElementById('q').value.trim().toLowerCase();
      const fb = document.getElementById('fb').value, fs = document.getElementById('fs').value;
      const list = emps.filter((e) => (!fb || e.home_branch_id === fb) && (!fs || e.status === fs) &&
        (!q || [e.full_name, e.employee_code, e.phone, e.cnic].some((v) => String(v || '').toLowerCase().includes(q))));
      document.getElementById('none').hidden = list.length > 0;
      document.getElementById('rows').innerHTML = list.map((e) => {
        const lg = loginOf(e);
        const login = !lg ? '<span class="hint">None</span>'
          : lg.is_active ? `<span class="pill pill-active">${lg.role === 'employee' ? 'Active' : esc(ROLE_LABEL[lg.role] || lg.role)}</span>`
          : '<span class="pill pill-expired">Off</span>';
        return `<tr class="${e.status === 'active' ? '' : 'muted-row'}">
          <td><b>${esc(e.full_name)}</b> <span class="code">${esc(e.employee_code)}</span>${e.work_mode && e.work_mode !== 'fixed' ? ` <span class="pill pill-trial">${WORK_MODE[e.work_mode][0]}</span>` : ''}${e.father_name ? `<div class="hint">s/o ${esc(e.father_name)}</div>` : ''}</td>
          <td>${esc(bName(e.home_branch_id)) || '<span class="hint">None</span>'}</td>
          <td>${esc(dName(e.designation_id))}</td>
          <td class="num">${esc(e.phone)}</td>
          <td>${login}</td>
          <td>${e.status === 'active' ? '<span class="pill pill-active">Active</span>' : `<span class="pill pill-expired">${STATUS[e.status]}</span>`}</td>
          ${canOpen() ? `<td class="right"><a class="btn btn-ghost btn-sm" href="#/employees?edit=${e.id}">Open</a></td>` : ''}
        </tr>`;
      }).join('');
    };
    ['q', 'fb', 'fs'].forEach((id) => document.getElementById(id).addEventListener('input', draw));
    draw();
  }

  // =============================================================
  // EDITOR
  // =============================================================
  async function editor(e, emps, look) {
    const isNew = !e;
    e = e || { status: 'active', work_mode: 'fixed', joining_date: today(), employee_code: nextCode(emps) };
    const t = today();
    const editable = canManage();
    const showPay = can('pay.view'), payEditable = can('pay.view') && can('pay.manage');
    let pay = { basic_salary: 0, commission_type: 'none', commission_value: 0 };

    // current shift, temporary duties, login
    let curShift = null, duties = [], login = null;
    if (!isNew) {
      const [s, a, p, py] = await Promise.all([
        sb.from('employee_shifts').select('*').eq('employee_id', e.id).order('effective_from', { ascending: false }),
        sb.from('employee_branch_assignments').select('*').eq('employee_id', e.id).order('start_date', { ascending: false }),
        e.user_id ? sb.from('users_profile').select('id, role, is_active').eq('id', e.user_id).maybeSingle() : Promise.resolve({ data: null }),
        showPay ? sb.from('employee_pay').select('basic_salary, commission_type, commission_value').eq('employee_id', e.id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (py.data) pay = py.data;
      curShift = (s.data || []).find((x) => x.effective_from <= t && (!x.effective_to || x.effective_to >= t)) || null;
      duties = (a.data || []).filter((x) => !x.end_date || x.end_date >= t);
      login = p.data || null;
    }
    const activeBranches = look.branches.filter((b) => b.is_active || b.id === e.home_branch_id);
    const opt = (rows, sel, empty) => `<option value="">${empty}</option>` + rows.map((r) => `<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
    const staffId = login ? `${look.loginCode}-${e.employee_code}` : '';

    page(isNew ? 'Add employee' : e.full_name, '<a href="#/employees">Back to employees</a>', '', `
      <form id="ef" novalidate>
        ${editable ? '' : '<p class="note">You can view these details. Only people with the “Add and edit employees” permission can change them.</p>'}
        <div class="editor-grid even">
          <section class="panel"><fieldset ${editable ? '' : 'disabled'}>
            <h2>Personal details</h2>
            <div class="field"><label for="full_name">Full name</label><input id="full_name" value="${esc(e.full_name)}" required></div>
            <div class="field"><label for="father_name">Father’s name <span class="opt">optional</span></label><input id="father_name" value="${esc(e.father_name)}"></div>
            <div class="row-2">
              <div class="field"><label for="cnic">CNIC <span class="opt">optional</span></label><input id="cnic" inputmode="numeric" value="${esc(e.cnic)}" placeholder="35202-1234567-1"></div>
              <div class="field"><label for="phone">Phone</label><input id="phone" type="tel" value="${esc(e.phone)}" placeholder="03xx xxxxxxx"></div>
            </div>
            <div class="field"><label for="email">Email <span class="opt">optional</span></label><input id="email" type="email" value="${esc(e.email)}"></div>
            <div class="field"><label for="address">Address <span class="opt">optional</span></label><input id="address" value="${esc(e.address)}"></div>
          </fieldset></section>

          <section class="panel"><fieldset ${editable ? '' : 'disabled'}>
            <h2>Job</h2>
            <div class="row-2">
              <div class="field"><label for="code">Employee code</label><input id="code" value="${esc(e.employee_code)}" ${login ? 'readonly aria-describedby="codeHint"' : ''} required>
                ${login ? '<span class="hint" id="codeHint">Fixed, because it is part of the app login.</span>' : '<span class="hint">Letters, numbers and dashes.</span>'}</div>
              <div class="field"><label for="joining">Joining date</label><input id="joining" type="date" value="${esc(e.joining_date)}"></div>
            </div>
            <div class="field"><label for="mode">Work type</label>
              <select id="mode">${Object.entries(WORK_MODE).map(([k, [lbl]]) => `<option value="${k}" ${k === (e.work_mode || 'fixed') ? 'selected' : ''}>${lbl}</option>`).join('')}</select>
              <span class="hint" id="modeHint"></span></div>
            <div class="field"><label for="branch">Home branch</label><select id="branch">${opt(activeBranches, e.home_branch_id, 'Choose a branch')}</select>
              <span class="hint">Used for reports and the branch manager’s view.</span></div>
            <div class="row-2">
              <div class="field"><label for="dept">Department</label><select id="dept">${opt(look.departments, e.department_id, 'None')}</select></div>
              <div class="field"><label for="desig">Designation</label><select id="desig">${opt(look.designations, e.designation_id, 'None')}</select></div>
            </div>
            <div class="field"><label for="shift">Shift</label>
              <select id="shift"><option value="">No shift</option>${look.shifts.filter((s) => s.is_active || s.id === curShift?.shift_id).map((s) => `<option value="${s.id}" ${s.id === curShift?.shift_id ? 'selected' : ''}>${esc(s.name)} (${s.start_time.slice(0, 5)} to ${s.end_time.slice(0, 5)})</option>`).join('')}</select>
              <span class="hint">${look.shifts.length ? 'Late and early leaving are worked out from this shift.' : 'Add shifts in Settings to track late arrivals.'}</span></div>
            ${(!look.departments.length || !look.designations.length) ? '<p class="hint">Add departments and designations in Settings.</p>' : ''}
            <div class="field"><label for="status">Status</label>
              <select id="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === e.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
              ${login ? '<span class="hint">If the employee leaves, set Resigned and also turn off the app login below.</span>' : ''}</div>
          </fieldset></section>

          ${showPay ? `
          <section class="panel"><fieldset ${payEditable ? '' : 'disabled'}>
            <h2>Pay</h2>
            ${payEditable ? '' : '<p class="note">You can see pay but not change it.</p>'}
            <div class="field"><label for="salary">Basic salary per month (Rs)</label><input id="salary" type="number" min="0" step="100" value="${pay.basic_salary ?? 0}"></div>
            <div class="row-2">
              <div class="field"><label for="ctype">Commission</label>
                <select id="ctype">${Object.entries(COMMISSION).concat(pay.commission_type === 'slab' ? [['slab', 'Slab (set later)']] : []).map(([k, v]) => `<option value="${k}" ${k === pay.commission_type ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
              <div class="field" id="cvalWrap"><label for="cval" id="cvalLabel">Commission</label><input id="cval" type="number" min="0" step="0.01" value="${pay.commission_value ?? 0}"></div>
            </div>
            <p class="hint" id="cHint"></p>
          </fieldset></section>` : ''}

          ${isNew || !can('logins.manage') ? '' : loginPanel(e, login, staffId, look.loginCode)}
          ${isNew ? '' : dutyPanel(duties, look.branches)}
        </div>
        <div class="form-bar">
          <a class="btn btn-ghost" href="#/employees">${editable || payEditable ? 'Cancel' : 'Back'}</a>
          ${editable || payEditable ? `<button class="btn" type="submit" id="saveEmp">${isNew ? 'Add employee' : 'Save changes'}</button>` : ''}
        </div>
      </form>
      <dialog id="dlg" class="dlg"></dialog>`);

    const f = document.getElementById('ef');
    const $ = (id) => f.querySelector('#' + id);

    // work type hint
    const syncM = () => { $('modeHint').textContent = WORK_MODE[$('mode').value][1]; };
    $('mode').addEventListener('change', syncM); syncM();

    // commission field
    if (showPay) {
      const syncC = () => {
        const tp = $('ctype').value;
        $('cvalWrap').hidden = tp === 'none' || tp === 'slab';
        $('cvalLabel').textContent = tp === 'percentage' ? 'Percent of sales (%)' : 'Amount per month (Rs)';
        $('cHint').textContent = tp === 'percentage' ? `Example: 2% of Rs 500,000 monthly sales = ${money(10000)}.` : '';
      };
      $('ctype').addEventListener('change', syncC); syncC();
    }

    // ---- Save employee
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const v = {
        full_name: $('full_name').value.trim(),
        father_name: $('father_name').value.trim() || null,
        cnic: $('cnic').value.trim() || null,
        phone: $('phone').value.trim() || null,
        email: $('email').value.trim() || null,
        address: $('address').value.trim() || null,
        employee_code: $('code').value.trim().toUpperCase(),
        joining_date: $('joining').value || null,
        home_branch_id: $('branch').value || null,
        department_id: $('dept').value || null,
        designation_id: $('desig').value || null,
        status: $('status').value,
        work_mode: $('mode').value,
      };
      const pv = payEditable ? {
        basic_salary: num($('salary').value) ?? 0,
        commission_type: $('ctype').value,
        commission_value: $('ctype').value === 'none' ? 0 : (num($('cval').value) ?? 0),
      } : null;
      const shiftId = $('shift').value || null;

      if (!v.full_name) return formAlert(f, 'Enter the employee’s full name.');
      if (!/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(v.employee_code)) return formAlert(f, 'Employee code can use only letters, numbers and dashes, for example E01.');
      if (!v.home_branch_id) return formAlert(f, 'Choose the home branch.');
      if (v.cnic && !/^\d{5}-?\d{7}-?\d$/.test(v.cnic)) return formAlert(f, 'CNIC should look like 35202-1234567-1.');
      if (pv && (pv.basic_salary < 0 || pv.commission_value < 0)) return formAlert(f, 'Salary and commission cannot be negative.');
      if (pv && pv.commission_type === 'percentage' && pv.commission_value > 100) return formAlert(f, 'Commission percent cannot be more than 100.');

      const btn = $('saveEmp');
      busy(btn, true, 'Saving…');
      let empId = e.id;
      if (isNew) {
        const { data, error } = await sb.from('employees').insert({ ...v, company_id: cid() }).select('id').single();
        if (error) { busy(btn, false); return formAlert(f, dbError(error)); }
        empId = data.id;
      } else if (editable) {
        const { error } = await sb.from('employees').update(v).eq('id', e.id);
        if (error) { busy(btn, false); return formAlert(f, dbError(error)); }
      }

      // pay lives in its own table (the row is created automatically)
      if (pv && (isNew || pv.basic_salary !== Number(pay.basic_salary) || pv.commission_type !== pay.commission_type || pv.commission_value !== Number(pay.commission_value))) {
        const { error } = await sb.from('employee_pay').update(pv).eq('employee_id', empId);
        if (error) { busy(btn, false); return formAlert(f, (isNew ? 'Employee added, but the pay could not be saved: ' : 'Pay could not be saved: ') + dbError(error)); }
      }

      // shift change: close the old assignment from today, start the new one today
      const oldShift = curShift?.shift_id || null;
      if (editable && shiftId !== oldShift) {
        let err = null;
        if (curShift) {
          const r = curShift.effective_from >= t
            ? await sb.from('employee_shifts').delete().eq('id', curShift.id)
            : await sb.from('employee_shifts').update({ effective_to: addDays(t, -1) }).eq('id', curShift.id);
          err = r.error;
        }
        if (!err && shiftId) {
          err = (await sb.from('employee_shifts').insert({ company_id: cid(), employee_id: empId, shift_id: shiftId, effective_from: t })).error;
        }
        if (err) { busy(btn, false); return formAlert(f, 'Employee saved, but the shift could not be changed: ' + dbError(err)); }
      }
      busy(btn, false);
      if (isNew) {
        toast(`${v.full_name} added. Now create the app login.`);
        location.hash = '#/employees?edit=' + empId;
      } else {
        toast('Changes saved');
        location.hash = '#/employees';
      }
    });

    if (!isNew) {
      bindLogin(e, login, staffId);
      bindDuties(e, look.branches);
    }
  }

  // ---------------------------------------------------------------
  // App login panel
  // ---------------------------------------------------------------
  function loginPanel(e, login, staffId, loginCode) {
    const roles = grantable();
    if (!login) {
      return `
      <section class="panel" id="loginPanel">
        <h2>App login</h2>
        <p class="sub">Create a login so ${esc(e.full_name.split(' ')[0])} can check in and submit closings from the phone.</p>
        ${e.status !== 'active' ? '<p class="note">Set the status to Active to create a login.</p>' : `
        <div class="staff-id"><span>Staff ID will be</span><strong>${esc(loginCode)}-${esc(e.employee_code)}</strong></div>
        <div class="field"><label for="l_role">Access</label><select id="l_role">${roles.map((r) => `<option value="${r}">${ROLE_LABEL[r]}</option>`).join('')}</select></div>
        <div class="field"><label for="l_pw">Password</label>
          <div class="pw-row"><input id="l_pw" type="text" autocomplete="off" minlength="6"><button type="button" class="btn btn-ghost btn-sm" id="l_gen">Suggest</button></div>
          <span class="hint">At least 6 characters. Give it to the employee privately.</span></div>
        <button type="button" class="btn" id="l_create">Create login</button>`}
      </section>`;
    }
    const canTouch = grantable().includes(login.role) && login.id !== state.session.user.id;
    return `
      <section class="panel" id="loginPanel">
        <h2>App login</h2>
        <div class="staff-id"><span>Staff ID</span><strong id="sid">${esc(staffId)}</strong><button type="button" class="btn btn-ghost btn-sm" id="l_copy">Copy</button></div>
        <dl class="facts two">
          <div><dt>Access</dt><dd>${esc(ROLE_LABEL[login.role] || login.role)}</dd></div>
          <div><dt>Login</dt><dd>${login.is_active ? 'On' : 'Off'}</dd></div>
          <div><dt>Phone</dt><dd>${e.registered_device_id ? 'Locked to one phone' : 'Not used yet'}</dd></div>
        </dl>
        ${login.id === state.session.user.id ? '<p class="note">This is your own login. Change your password from the login page.</p>' : canTouch ? `
        <div class="login-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="l_reset">Set new password</button>
          ${e.registered_device_id ? '<button type="button" class="btn btn-ghost btn-sm" id="l_device">Allow a new phone</button>' : ''}
          ${grantable().length > 1 ? '<button type="button" class="btn btn-ghost btn-sm" id="l_role2">Change access</button>' : ''}
          <button type="button" class="btn btn-ghost btn-sm ${login.is_active ? 'danger' : ''}" id="l_toggle">${login.is_active ? 'Turn off login' : 'Turn on login'}</button>
        </div>` : `<p class="note">${login.role === 'hr' ? 'Only the company admin can change an HR login.' : 'You cannot change this login.'}</p>`}
        <p class="hint">Staff log in with the Staff ID and password. ${e.registered_device_id ? 'The app works only on the phone they first used. If they change phones, click "Allow a new phone".' : 'The first phone they log in on becomes their registered phone.'}</p>
      </section>`;
  }

  function genPassword() {
    const words = ['shop', 'gold', 'star', 'rose', 'moon', 'blue', 'mint', 'sale'];
    const a = new Uint32Array(2); crypto.getRandomValues(a);
    return words[a[0] % words.length] + String(1000 + (a[1] % 9000));
  }

  function bindLogin(e, login, staffId) {
    const panel = document.getElementById('loginPanel');
    if (!panel) return;
    const run = async (btn, label, body, done) => {
      busy(btn, true, label);
      try {
        const res = await callStaff({ employee_id: e.id, ...body });
        busy(btn, false);
        done(res);
      } catch (err) {
        busy(btn, false);
        formAlert(panel, err.message);
      }
    };

    panel.querySelector('#l_gen')?.addEventListener('click', () => { panel.querySelector('#l_pw').value = genPassword(); });
    panel.querySelector('#l_create')?.addEventListener('click', (ev) => {
      const pw = panel.querySelector('#l_pw').value.trim();
      if (pw.length < 6) return formAlert(panel, 'Password must be at least 6 characters.');
      run(ev.currentTarget, 'Creating…', { action: 'create', password: pw, role: panel.querySelector('#l_role').value }, (r) => {
        showDone('Login created', r.staff_id, pw);
      });
    });
    panel.querySelector('#l_copy')?.addEventListener('click', async (ev) => {
      try { await navigator.clipboard.writeText(staffId); ev.currentTarget.textContent = 'Copied'; } catch { /* clipboard blocked */ }
    });
    panel.querySelector('#l_reset')?.addEventListener('click', () => {
      ask('Set new password', `<div class="field"><label for="d_pw">New password for ${esc(e.full_name)}</label><div class="pw-row"><input id="d_pw" type="text" autocomplete="off" value="${genPassword()}"></div><span class="hint">At least 6 characters.</span></div>`, 'Save password',
        async (dlg, btn) => {
          const pw = dlg.querySelector('#d_pw').value.trim();
          if (pw.length < 6) return formAlert(dlg.querySelector('form'), 'Password must be at least 6 characters.');
          busy(btn, true, 'Saving…');
          try { await callStaff({ employee_id: e.id, action: 'reset_password', password: pw }); showDone('Password changed', staffId, pw); }
          catch (err) { busy(btn, false); formAlert(dlg.querySelector('form'), err.message); }
        });
    });
    panel.querySelector('#l_role2')?.addEventListener('click', () => {
      const roles = grantable();
      ask('Change access', `<div class="field"><label for="d_role">Access for ${esc(e.full_name)}</label><select id="d_role">${roles.map((r) => `<option value="${r}" ${r === login.role ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select>
        <span class="hint">Branch managers and HR also log in to this web panel with their Staff ID.</span></div>`, 'Save access',
        async (dlg, btn) => {
          busy(btn, true, 'Saving…');
          try { await callStaff({ employee_id: e.id, action: 'set_role', role: dlg.querySelector('#d_role').value }); dlg.close(); toast('Access changed'); viewEmployees(e.id); }
          catch (err) { busy(btn, false); formAlert(dlg.querySelector('form'), err.message); }
        });
    });
    panel.querySelector('#l_toggle')?.addEventListener('click', (ev) => {
      const turnOn = !login.is_active;
      if (!turnOn && !confirm(`Turn off the login for ${e.full_name}? They will not be able to use the app until you turn it back on.`)) return;
      run(ev.currentTarget, 'Saving…', { action: 'set_active', active: turnOn }, () => { toast(turnOn ? 'Login turned on' : 'Login turned off'); viewEmployees(e.id); });
    });
    panel.querySelector('#l_device')?.addEventListener('click', async (ev) => {
      if (!confirm(`Allow ${e.full_name} to use a new phone? The next phone they log in on becomes their registered phone.`)) return;
      const btn = ev.currentTarget; busy(btn, true, 'Saving…');
      const { error } = await sb.rpc('reset_employee_device', { p_employee: e.id });
      busy(btn, false);
      if (error) return formAlert(panel, dbError(error));
      toast('New phone allowed'); viewEmployees(e.id);
    });

    function showDone(title, sid, pw) {
      ask(title, `
        <p>Give these to ${esc(e.full_name)} privately. The password is shown only now.</p>
        <div class="cred"><span>Staff ID</span><strong>${esc(sid)}</strong></div>
        <div class="cred"><span>Password</span><strong>${esc(pw)}</strong></div>
        <p class="hint">They can log in on the Veltrio app with these.</p>`, 'Copy both', async (dlg, btn) => {
        try { await navigator.clipboard.writeText(`Veltrio login\nStaff ID: ${sid}\nPassword: ${pw}`); btn.textContent = 'Copied'; } catch { /* blocked */ }
      }, () => viewEmployees(e.id), 'Done');
    }
  }

  function ask(title, html, okLabel, onOk, onClose, cancelLabel = 'Cancel') {
    const dlg = document.getElementById('dlg');
    dlg.innerHTML = `<form method="dialog" novalidate><h2>${esc(title)}</h2>${html}
      <div class="dlg-bar"><button class="btn btn-ghost" value="cancel" formnovalidate>${esc(cancelLabel)}</button><button class="btn" value="ok" id="d_ok">${esc(okLabel)}</button></div></form>`;
    dlg.onclose = onClose || null;
    dlg.querySelector('#d_ok').onclick = (ev) => { ev.preventDefault(); onOk(dlg, ev.currentTarget); };
    if (!dlg.open) dlg.showModal();
  }

  // ---------------------------------------------------------------
  // Temporary duty at another branch
  // ---------------------------------------------------------------
  function dutyPanel(duties, branches) {
    const bName = (id) => branches.find((b) => b.id === id)?.name || 'Removed branch';
    return `
      <section class="panel" id="dutyPanel">
        <h2>Duty at another branch</h2>
        <p class="sub">For days the employee works away from the home branch. They can check in at both.</p>
        ${duties.length ? `<ul class="duties">${duties.map((d) => `
          <li><div><b>${esc(bName(d.branch_id))}</b><span class="hint">${d.end_date ? `${fmtDate(d.start_date)} to ${fmtDate(d.end_date)}` : `From ${fmtDate(d.start_date)}, until removed`}${d.reason ? `, ${esc(d.reason)}` : ''}</span></div>
          ${canManage() && d.end_date !== today() ? `<button type="button" class="btn btn-ghost btn-sm" data-endduty="${d.id}" data-start="${d.start_date}">${d.start_date > today() ? 'Remove' : 'End today'}</button>` : ''}</li>`).join('')}</ul>`
          : '<p class="hint">No duty at another branch.</p>'}
        ${canManage() ? `
        <div class="duty-add">
          <div class="field"><label for="d_branch">Branch</label><select id="d_branch"><option value="">Choose</option>${branches.filter((b) => b.is_active).map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="d_from">From</label><input id="d_from" type="date" value="${today()}"></div>
          <div class="field"><label for="d_to">To <span class="opt">optional</span></label><input id="d_to" type="date"></div>
          <div class="field"><label for="d_reason">Reason <span class="opt">optional</span></label><input id="d_reason" placeholder="Staff short"></div>
          <button type="button" class="btn btn-ghost" id="d_add">Add duty</button>
        </div>` : ''}
      </section>`;
  }

  function bindDuties(e, branches) {
    const panel = document.getElementById('dutyPanel');
    if (!panel) return;
    panel.querySelector('#d_add')?.addEventListener('click', async (ev) => {
      const branch = panel.querySelector('#d_branch').value, from = panel.querySelector('#d_from').value, to = panel.querySelector('#d_to').value || null;
      if (!branch || !from) return formAlert(panel, 'Choose the branch and the start date.');
      if (branch === e.home_branch_id) return formAlert(panel, 'This is already the home branch.');
      if (to && to < from) return formAlert(panel, 'The end date must be after the start date.');
      const btn = ev.currentTarget; busy(btn, true, 'Adding…');
      const { error } = await sb.from('employee_branch_assignments').insert({
        company_id: cid(), employee_id: e.id, branch_id: branch, start_date: from, end_date: to,
        reason: panel.querySelector('#d_reason').value.trim() || null, created_by: state.session.user.id,
      });
      busy(btn, false);
      if (error) return formAlert(panel, dbError(error));
      toast(`Duty at ${branches.find((b) => b.id === branch)?.name} added`);
      viewEmployees(e.id);
    });
    panel.querySelectorAll('[data-endduty]').forEach((b) => b.addEventListener('click', async () => {
      const future = b.dataset.start > today();
      const { error } = future
        ? await sb.from('employee_branch_assignments').delete().eq('id', b.dataset.endduty)
        : await sb.from('employee_branch_assignments').update({ end_date: today() }).eq('id', b.dataset.endduty);
      if (error) return formAlert(panel, dbError(error));
      toast(future ? 'Duty removed' : 'Duty ends today');
      viewEmployees(e.id);
    }));
  }

  return { viewEmployees };
}
