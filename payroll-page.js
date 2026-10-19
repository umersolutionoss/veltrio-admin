// =============================================================
//  Veltrio admin panel - Part 7.6
//  Payroll: monthly payroll, payslips (print, CSV), advances and
//  the company's own payroll rules
// =============================================================

const BASIS = {
  fixed_30: 'Salary ÷ 30', fixed_26: 'Salary ÷ 26',
  month_days: 'Salary ÷ days in the pay period', working_days: 'Salary ÷ working days in the pay period',
};
const LATE = {
  none: ['No deduction', 'Late arrivals are only shown in reports.'],
  count: ['Count of late days', 'For example, every 3 late days cut 1 day’s pay.'],
  per_minute: ['Every late minute', 'The exact late minutes are cut from pay.'],
};

export function initPayrollPage(ctx) {
  const { sb, state, shell, bindShell, esc, busy, friendlyError, today, can } = ctx;
  const cid = () => state.profile.company_id;
  const isAdmin = () => state.profile.role === 'company_admin';
  const allowed = () => can('payroll.manage') && can('pay.view');
  const app = () => document.getElementById('app');
  const money = (n) => new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));
  const rs = (n) => 'Rs ' + money(n);
  const nd = (n) => (Number(n) % 1 ? Number(n).toFixed(1) : String(Number(n || 0)));
  const fmtY = (d) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d + 'T00:00:00'));
  const monthName = (ym) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(ym + '-01T00:00:00'));
  const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

  // Same rule as private.pay_period()
  function period(ym, startDay) {
    const [y, m] = ym.split('-').map(Number);
    if (startDay === 1) return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    return [iso(new Date(y, m - 2, startDay)), iso(new Date(y, m - 1, startDay - 1))];
  }

  const msg = (err) => {
    const m = (err && err.message) || String(err);
    if (/row-level security|permission denied/i.test(m)) return 'You do not have permission to make this change.';
    if (/function .* does not exist|relation .* does not exist|schema cache|column .* does not exist/i.test(m)) return 'Run the Part 7.6 database update in Supabase first.';
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
  function dialog(title, html, okLabel, onOk, wide) {
    const dlg = document.getElementById('dlg');
    dlg.className = 'dlg' + (wide ? ' wide' : '');
    dlg.innerHTML = `<form method="dialog" novalidate><h2>${esc(title)}</h2>${html}
      <div class="dlg-bar"><button class="btn btn-ghost" value="cancel" formnovalidate>${okLabel ? 'Cancel' : 'Close'}</button>${okLabel ? `<button class="btn" value="ok" id="d_ok">${esc(okLabel)}</button>` : ''}</div></form>`;
    const form = dlg.querySelector('form');
    dlg.querySelector('#d_ok')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const btn = e.currentTarget, label = btn.textContent;
      btn.disabled = true; btn.textContent = 'Saving…';
      try { const ok = await onOk(form); if (ok !== false) dlg.close(); }
      catch (err) { alertIn(form, msg(err)); }
      finally { btn.disabled = false; btn.textContent = label; }
    });
    if (!dlg.open) dlg.showModal();
    return form;
  }

  function page(tab, actions, body) {
    const tabs = [['run', 'Payroll'], ['advances', 'Advances'], ['rules', 'Payroll rules']];
    app().innerHTML = shell('payroll', `
      <div class="topbar">
        <div>
          <button class="btn btn-ghost menu-btn" data-menu type="button" aria-label="Open menu">Menu</button>
          <h1>Payroll</h1>
        </div>
        ${actions ? `<div class="actions">${actions}</div>` : ''}
      </div>
      <nav class="tabs" aria-label="Payroll sections">${tabs.map(([k, l]) => `<a href="#/payroll?tab=${k}" class="${k === tab ? 'on' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
      <div id="body">${body}</div>
      <dialog id="dlg" class="dlg"></dialog>`);
    bindShell();
  }
  const loading = '<div class="panel"><p class="sub">Loading…</p></div>';

  async function viewPayroll(tab, month) {
    tab = ['run', 'advances', 'rules'].includes(tab) ? tab : 'run';
    if (!allowed() && tab !== 'rules') {
      return page(tab, '', `<section class="panel"><div class="empty"><h2>Payroll is not available for you</h2>
        <p>You need the “Run payroll and payslips” and “See salary and commission” permissions. Ask your company admin.</p></div></section>`);
    }
    page(tab, '', loading);
    let c;
    try {
      const [e, s, co] = await Promise.all([
        sb.from('employees').select('id, full_name, employee_code, home_branch_id, status, cnic, joining_date, designation_id').eq('company_id', cid()).order('employee_code'),
        sb.from('company_settings').select('*').eq('company_id', cid()).maybeSingle(),
        sb.from('companies').select('name, address, city, phone').eq('id', cid()).maybeSingle(),
      ]);
      for (const r of [e, s]) if (r.error) throw r.error;
      c = { emps: e.data || [], settings: s.data || {}, company: co.data || {} };
      if (c.settings.pay_cycle_start_day === undefined) throw new Error('column pay_cycle_start_day does not exist');
    } catch (err) { return page(tab, '', `<div class="alert alert-error" role="alert">${esc(msg(err))}</div>`); }
    if (tab === 'run') return run(c, month);
    if (tab === 'advances') return advances(c);
    return rules(c);
  }

  // =============================================================
  // PAYROLL RUN
  // =============================================================
  async function run(c, month) {
    const now = today().slice(0, 7);
    const lastMonth = (() => { const [y, m] = now.split('-').map(Number); return iso(new Date(y, m - 2, 1)).slice(0, 7); })();
    month = /^\d{4}-\d{2}$/.test(month || '') ? month : lastMonth;
    const startDay = c.settings.pay_cycle_start_day || 1;
    const [ps, pe] = period(month, startDay);

    const { data: runRow, error } = await sb.from('payroll_runs').select('*').eq('company_id', cid()).eq('period_start', ps).maybeSingle();
    if (error) return page('run', '', `<div class="alert alert-error" role="alert">${esc(msg(error))}</div>`);
    let slips = [];
    if (runRow) {
      const r = await sb.from('payslips').select('*').eq('run_id', runRow.id);
      slips = r.data || [];
    }
    const emp = (id) => c.emps.find((e) => e.id === id) || {};
    slips.sort((a, b) => String(emp(a.employee_id).employee_code).localeCompare(String(emp(b.employee_id).employee_code)));
    const draft = runRow?.status === 'draft', final = runRow?.status === 'finalized';
    const totals = slips.reduce((t, s) => ({ gross: t.gross + Number(s.gross), cut: t.cut + Number(s.total_cut), net: t.net + Number(s.net) }), { gross: 0, cut: 0, net: 0 });
    const future = pe > today();

    const actions = `
      <label class="month-pick"><span class="sr-only">Pay month</span><input type="month" id="month" value="${month}" max="${now}"></label>
      ${!final ? `<button class="btn" type="button" id="gen">${runRow ? 'Recalculate' : 'Make payroll'}</button>` : ''}`;

    page('run', actions, `
      <div class="period-bar">
        <div><b>${esc(monthName(month))}</b> <span class="hint">${fmtY(ps)} to ${fmtY(pe)}</span></div>
        ${runRow ? `<span class="pill ${final ? 'pill-active' : 'pill-trial'}">${final ? 'Finalized' : 'Draft'}</span>` : ''}
      </div>
      ${future && !final ? `<p class="note">This pay period has not ended yet. Days after today are not counted as absent; recalculate after ${fmtY(pe)} for the final figures.</p>` : ''}
      ${!runRow ? `<section class="panel"><div class="empty">
          <h2>No payroll for ${esc(monthName(month))} yet</h2>
          <p>Make payroll to work out every employee’s pay from attendance, leave, closings and advances. You can check and change it before you finalize.</p>
        </div></section>` : `
      <section class="stats three" aria-label="Totals">
        <div class="stat"><div class="label">Total pay before deductions</div><div class="value">${rs(totals.gross)}</div><div class="foot">${slips.length} employee${slips.length === 1 ? '' : 's'}</div></div>
        <div class="stat"><div class="label">Total deductions</div><div class="value">${rs(totals.cut)}</div></div>
        <div class="stat"><div class="label">Total to pay</div><div class="value">${rs(totals.net)}</div></div>
      </section>
      <section class="panel flush">
        <div class="table-wrap"><table class="list pay">
          <thead><tr><th>Employee</th><th>Present</th><th>Absent</th><th>Late</th><th class="r">Basic</th><th class="r">Additions</th><th class="r">Deductions</th><th class="r">Net pay</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>${slips.map((s) => {
            const e = emp(s.employee_id), d = s.days || {};
            const add = Number(s.overtime_amount) + Number(s.commission) + Number(s.bonus);
            return `<tr>
              <td><b>${esc(e.full_name || '')}</b> <span class="code">${esc(e.employee_code || '')}</span>${s.note ? `<div class="hint">${esc(s.note)}</div>` : ''}</td>
              <td class="num">${nd(d.present)} / ${nd(Number(d.working) - Number(d.not_joined_working || 0))}</td>
              <td class="num">${nd(d.absent)}${Number(d.unpaid_leave) ? `<div class="hint">+${nd(d.unpaid_leave)} unpaid leave</div>` : ''}</td>
              <td class="num">${nd(d.late)}</td>
              <td class="num r">${money(s.basic_salary)}</td>
              <td class="num r">${add ? '+' + money(add) : '–'}</td>
              <td class="num r">${Number(s.total_cut) ? '−' + money(s.total_cut) : '–'}</td>
              <td class="num r"><b>${money(s.net)}</b></td>
              <td class="right nowrap"><button class="btn btn-ghost btn-sm" data-slip="${s.id}">${draft ? 'Check' : 'View'}</button></td>
            </tr>`;
          }).join('')}</tbody>
          <tfoot><tr><td colspan="7"><b>Total</b></td><td class="num r"><b>${money(totals.net)}</b></td><td></td></tr></tfoot>
        </table></div>
      </section>
      <div class="form-bar split">
        <div class="left-actions">
          <button class="btn btn-ghost" type="button" id="csv">Download for Excel</button>
          <button class="btn btn-ghost" type="button" id="printAll">Print all payslips</button>
        </div>
        <div>
          ${draft ? '<button class="btn btn-ghost danger" type="button" id="del">Delete draft</button> <button class="btn" type="button" id="fin">Finalize payroll</button>' : ''}
          ${final && isAdmin() ? '<button class="btn btn-ghost" type="button" id="reopen">Reopen</button>' : ''}
        </div>
      </div>
      ${final ? `<p class="note">Finalized on ${fmtY(runRow.finalized_at.slice(0, 10))}. Employees can now see their payslip in the app, and advance installments are recorded.</p>` : '<p class="note">Draft: check each payslip, add bonus or other deductions, then finalize. Finalizing locks the payroll and records advance installments.</p>'}`}`);

    document.getElementById('month').addEventListener('change', (e) => { if (e.target.value) location.hash = `#/payroll?tab=run&month=${e.target.value}`; });
    document.getElementById('gen')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget; busy(btn, true, 'Working it out…');
      const { error: er } = await sb.rpc('generate_payroll', { p_month: `${month}-15` });
      busy(btn, false);
      if (er) return toast(msg(er), 'error');
      toast('Payroll worked out'); viewPayroll('run', month);
    });
    document.getElementById('fin')?.addEventListener('click', () => {
      dialog('Finalize payroll', `<p>Finalize ${esc(monthName(month))} for ${slips.length} employee${slips.length === 1 ? '' : 's'}, total <b>${rs(totals.net)}</b>?</p>
        <p class="hint">After this the payroll is locked, employees can see their payslips, and advance installments are taken. Only the company admin can reopen it.</p>`, 'Finalize', async () => {
        const { error: er } = await sb.rpc('finalize_payroll', { p_run: runRow.id });
        if (er) throw er;
        toast('Payroll finalized'); viewPayroll('run', month);
      });
    });
    document.getElementById('del')?.addEventListener('click', async () => {
      if (!confirm('Delete this draft payroll? Bonus and deductions you typed will be lost.')) return;
      const { error: er } = await sb.rpc('delete_payroll', { p_run: runRow.id });
      if (er) return toast(msg(er), 'error');
      toast('Draft deleted'); viewPayroll('run', month);
    });
    document.getElementById('reopen')?.addEventListener('click', async () => {
      if (!confirm('Reopen this payroll? It goes back to draft and the advance installments it took are undone.')) return;
      const { error: er } = await sb.rpc('reopen_payroll', { p_run: runRow.id });
      if (er) return toast(msg(er), 'error');
      toast('Payroll reopened'); viewPayroll('run', month);
    });
    document.getElementById('csv')?.addEventListener('click', () => downloadCsv(c, slips, month, emp));
    document.getElementById('printAll')?.addEventListener('click', () => printSlips(c, slips, runRow, emp));
    document.querySelectorAll('[data-slip]').forEach((b) => b.onclick = () => slipDialog(c, slips.find((s) => s.id === b.dataset.slip), runRow, emp, month));
  }

  function breakdown(s, rules) {
    const d = s.days || {};
    const lateRule = rules?.late_rule || 'count';
    const rows = [
      ['Basic salary', s.basic_salary, '+'],
      ['Overtime', s.overtime_amount, '+', Number(d.overtime_minutes) ? `${Math.floor(d.overtime_minutes / 60)} h ${d.overtime_minutes % 60} min` : ''],
      ['Commission', s.commission, '+', Number(d.sales) ? `on sales of ${rs(d.sales)}` : ''],
      ['Bonus', s.bonus, '+'],
      ['Absent', s.absent_cut, '−', Number(d.absent) ? `${nd(d.absent)} day(s) × ${rs(s.day_rate)}` : ''],
      ['Unpaid leave', s.unpaid_leave_cut, '−', Number(d.unpaid_leave) ? `${nd(d.unpaid_leave)} day(s)` : ''],
      ['Late', s.late_cut, '−', Number(d.late) ? (lateRule === 'per_minute' ? `${d.late_minutes} late minutes` : `${d.late} late day(s)`) : ''],
      ['Before joining', s.not_joined_cut, '−', Number(d.not_joined) ? `${d.not_joined} day(s)` : ''],
      ['Advance installment', s.advance_cut, '−'],
      ['Other deduction', s.other_cut, '−'],
    ];
    return rows.filter((r) => Number(r[1]) || r[0] === 'Basic salary');
  }

  function slipDialog(c, s, runRow, emp, month) {
    const e = emp(s.employee_id), d = s.days || {}, draft = runRow.status === 'draft';
    const rows = breakdown(s, runRow.rules);
    const form = dialog(`${e.full_name}, ${monthName(month)}`, `
      <dl class="facts four">
        <div><dt>Working days</dt><dd>${nd(d.working)}</dd></div><div><dt>Present</dt><dd>${nd(d.present)}</dd></div>
        <div><dt>Paid leave</dt><dd>${nd(d.paid_leave)}</dd></div><div><dt>Day rate</dt><dd>${rs(s.day_rate)}</dd></div>
      </dl>
      <table class="slip"><tbody>${rows.map(([l, v, sign, note]) => `<tr><td>${l}${note ? `<div class="hint">${esc(note)}</div>` : ''}</td><td class="num r">${sign === '−' ? '−' : ''}${money(v)}</td></tr>`).join('')}
        <tr class="tot"><td>Net pay</td><td class="num r">${rs(s.net)}</td></tr></tbody></table>
      ${draft ? `
      <div class="row-2">
        <div class="field"><label for="d_bonus">Bonus (Rs)</label><input id="d_bonus" type="number" min="0" step="100" value="${Number(s.bonus)}"></div>
        <div class="field"><label for="d_other">Other deduction (Rs)</label><input id="d_other" type="number" min="0" step="100" value="${Number(s.other_cut)}"></div>
      </div>
      <div class="field"><label for="d_note">Note on payslip <span class="opt">optional</span></label><input id="d_note" value="${esc(s.note)}" placeholder="Eid bonus"></div>` : ''}
      <p><button type="button" class="btn btn-ghost btn-sm" id="d_print">Print payslip</button></p>`, draft ? 'Save' : '', async (f) => {
      const b = Number(f.querySelector('#d_bonus').value || 0), o = Number(f.querySelector('#d_other').value || 0);
      if (b < 0 || o < 0) { alertIn(f, 'Amounts cannot be negative.'); return false; }
      const { error } = await sb.rpc('set_payslip_extras', { p_payslip: s.id, p_bonus: b, p_other: o, p_note: f.querySelector('#d_note').value.trim() || null });
      if (error) throw error;
      toast('Payslip saved'); viewPayroll('run', month);
    }, true);
    form.querySelector('#d_print').onclick = () => printSlips(c, [s], runRow, emp);
  }

  function downloadCsv(c, slips, month, emp) {
    const head = ['Code', 'Name', 'Working days', 'Present', 'Absent', 'Paid leave', 'Unpaid leave', 'Late days', 'Overtime minutes',
      'Basic', 'Overtime', 'Commission', 'Bonus', 'Absent cut', 'Unpaid leave cut', 'Late cut', 'Before joining cut', 'Advance', 'Other cut', 'Gross', 'Deductions', 'Net', 'Note'];
    const q = (v) => { const x = String(v ?? ''); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const lines = [head.join(',')].concat(slips.map((s) => {
      const e = emp(s.employee_id), d = s.days || {};
      return [e.employee_code, e.full_name, d.working, d.present, d.absent, d.paid_leave, d.unpaid_leave, d.late, d.overtime_minutes,
        s.basic_salary, s.overtime_amount, s.commission, s.bonus, s.absent_cut, s.unpaid_leave_cut, s.late_cut, s.not_joined_cut,
        s.advance_cut, s.other_cut, s.gross, s.total_cut, s.net, s.note].map(q).join(',');
    }));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `payroll-${month}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function printSlips(c, slips, runRow, emp) {
    const co = c.company;
    const html = slips.map((s) => {
      const e = emp(s.employee_id), d = s.days || {};
      const rows = breakdown(s, runRow.rules);
      const earn = rows.filter((r) => r[2] === '+'), cut = rows.filter((r) => r[2] === '−');
      const line = (r) => `<tr><td>${esc(r[0])}${r[3] ? `<small>${esc(r[3])}</small>` : ''}</td><td class="r">${money(r[1])}</td></tr>`;
      return `<section class="slip">
        <header><div><h1>${esc(co.name || '')}</h1><p>${esc([co.address, co.city].filter(Boolean).join(', '))}</p></div>
          <div class="r"><h2>Payslip</h2><p>${fmtY(runRow.period_start)} to ${fmtY(runRow.period_end)}</p>${runRow.status === 'draft' ? '<p class="draft">DRAFT</p>' : ''}</div></header>
        <table class="who"><tr><td>Employee</td><td><b>${esc(e.full_name || '')}</b> (${esc(e.employee_code || '')})</td><td>CNIC</td><td>${esc(e.cnic || '')}</td></tr>
          <tr><td>Working days</td><td>${nd(d.working)}</td><td>Present</td><td>${nd(d.present)}</td></tr>
          <tr><td>Absent</td><td>${nd(d.absent)}</td><td>Leave (paid / unpaid)</td><td>${nd(d.paid_leave)} / ${nd(d.unpaid_leave)}</td></tr></table>
        <div class="cols"><table><thead><tr><th>Earnings</th><th class="r">Rs</th></tr></thead><tbody>${earn.map(line).join('')}</tbody>
            <tfoot><tr><td>Total earnings</td><td class="r">${money(s.gross)}</td></tr></tfoot></table>
          <table><thead><tr><th>Deductions</th><th class="r">Rs</th></tr></thead><tbody>${cut.map(line).join('') || '<tr><td>None</td><td class="r">0</td></tr>'}</tbody>
            <tfoot><tr><td>Total deductions</td><td class="r">${money(s.total_cut)}</td></tr></tfoot></table></div>
        <p class="net">Net pay <b>Rs ${money(s.net)}</b></p>
        ${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}
        <footer><span>Employee signature</span><span>Authorised signature</span></footer>
      </section>`;
    }).join('');
    const w = window.open('', '_blank');
    if (!w) return toast('Allow pop-ups for this site to print payslips.', 'error');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Payslips</title><style>
      body{font-family:Arial,sans-serif;color:#18232A;margin:0;padding:24px;font-size:13px}
      .slip{max-width:760px;margin:0 auto 32px;padding:24px;border:1px solid #ccc;page-break-after:always}
      header{display:flex;justify-content:space-between;border-bottom:2px solid #0B4F55;padding-bottom:10px;margin-bottom:12px}
      h1{font-size:20px;margin:0;color:#0B4F55}h2{font-size:16px;margin:0}p{margin:4px 0}.r{text-align:right}.draft{color:#B83227;font-weight:bold}
      table{width:100%;border-collapse:collapse}td,th{padding:6px 8px;border-bottom:1px solid #e3e3e3;text-align:left;vertical-align:top}
      .who td:nth-child(odd){color:#5B6B73;width:20%}.cols{display:flex;gap:16px;margin-top:14px}.cols table{flex:1}
      th{background:#E3EFEE}tfoot td{font-weight:bold;border-top:2px solid #0B4F55}small{display:block;color:#5B6B73}
      .net{font-size:18px;text-align:right;margin-top:14px}.note{color:#5B6B73}
      footer{display:flex;justify-content:space-between;margin-top:48px}footer span{border-top:1px solid #18232A;padding-top:4px;width:40%;text-align:center}
      @media print{body{padding:0}.slip{border:0}}
    </style></head><body>${html}<script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  }

  // =============================================================
  // ADVANCES
  // =============================================================
  async function advances(c) {
    const { data, error } = await sb.rpc('advance_list');
    if (error) return page('advances', '', `<div class="alert alert-error" role="alert">${esc(msg(error))}</div>`);
    const list = data || [];
    const emp = (id) => c.emps.find((e) => e.id === id) || {};
    const open = list.filter((a) => Number(a.remaining) > 0);
    page('advances', '<button class="btn" type="button" id="addAdv">Give advance</button>', `
      <p class="sub">Advances and loans are paid back from salary in monthly installments${c.settings.deduct_advances ? '' : '. Deduction from salary is off in Payroll rules'}.</p>
      ${list.length ? `<section class="panel flush"><div class="table-wrap"><table class="list">
        <thead><tr><th>Employee</th><th>Given on</th><th class="r">Amount</th><th class="r">Per month</th><th class="r">Paid back</th><th class="r">Left</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${list.map((a) => `<tr class="${Number(a.remaining) > 0 ? '' : 'muted-row'}">
          <td><b>${esc(emp(a.employee_id).full_name || '')}</b>${a.notes ? `<div class="hint">${esc(a.notes)}</div>` : ''}</td>
          <td class="num">${fmtY(a.given_on)}</td><td class="num r">${money(a.amount)}</td><td class="num r">${money(a.installment)}</td>
          <td class="num r">${money(a.repaid)}</td><td class="num r"><b>${Number(a.remaining) > 0 ? money(a.remaining) : 'Paid'}</b></td>
          <td class="right">${Number(a.repaid) === 0 ? `<button class="btn btn-ghost btn-sm" data-deladv="${a.id}">Remove</button>` : ''}</td></tr>`).join('')}</tbody>
      </table></div></section>
      <p class="note">${open.length} open, ${rs(open.reduce((t, a) => t + Number(a.remaining), 0))} still to be paid back. An advance can be removed only before its first installment.</p>`
      : '<section class="panel"><div class="empty"><h2>No advances</h2><p>Record an advance or loan here and its installment is cut from salary each month.</p></div></section>'}`);

    document.getElementById('addAdv').onclick = () => {
      const active = c.emps.filter((e) => e.status === 'active');
      dialog('Give advance', `
        <div class="field"><label for="d_emp">Employee</label><select id="d_emp"><option value="">Choose</option>${active.map((e) => `<option value="${e.id}">${esc(e.full_name)} (${esc(e.employee_code)})</option>`).join('')}</select></div>
        <div class="row-2">
          <div class="field"><label for="d_amt">Amount (Rs)</label><input id="d_amt" type="number" min="1" step="100"></div>
          <div class="field"><label for="d_inst">Cut per month (Rs)</label><input id="d_inst" type="number" min="1" step="100"></div>
        </div>
        <div class="field"><label for="d_on">Given on</label><input id="d_on" type="date" value="${today()}"></div>
        <div class="field"><label for="d_notes">Note <span class="opt">optional</span></label><input id="d_notes" placeholder="Medical emergency"></div>
        <p class="hint" id="d_months"></p>`, 'Save advance', async (f) => {
        const v = { employee_id: f.querySelector('#d_emp').value, amount: Number(f.querySelector('#d_amt').value), installment: Number(f.querySelector('#d_inst').value),
          given_on: f.querySelector('#d_on').value, notes: f.querySelector('#d_notes').value.trim() || null };
        if (!v.employee_id) { alertIn(f, 'Choose the employee.'); return false; }
        if (!(v.amount > 0) || !(v.installment > 0)) { alertIn(f, 'Enter the amount and the monthly cut.'); return false; }
        if (v.installment > v.amount) { alertIn(f, 'The monthly cut cannot be more than the amount.'); return false; }
        const { error: er } = await sb.from('employee_advances').insert({ ...v, company_id: cid(), created_by: state.session.user.id });
        if (er) throw er;
        toast('Advance saved'); viewPayroll('advances');
      });
      const f = document.querySelector('#dlg form');
      const sync = () => { const a = Number(f.querySelector('#d_amt').value), i = Number(f.querySelector('#d_inst').value); f.querySelector('#d_months').textContent = a > 0 && i > 0 ? `Paid back in ${Math.ceil(a / i)} month(s).` : ''; };
      f.querySelector('#d_amt').oninput = sync; f.querySelector('#d_inst').oninput = sync;
    };
    document.querySelectorAll('[data-deladv]').forEach((b) => b.onclick = async () => {
      if (!confirm('Remove this advance?')) return;
      const { error: er } = await sb.from('employee_advances').delete().eq('id', b.dataset.deladv);
      if (er) return toast(msg(er), 'error');
      toast('Advance removed'); viewPayroll('advances');
    });
  }

  // =============================================================
  // RULES
  // =============================================================
  function rules(c) {
    const s = c.settings, ed = isAdmin();
    page('rules', '', `
      <section class="panel">
        <h2>Payroll rules</h2>
        <p class="sub">How pay is worked out for your company. Changes apply the next time you make or recalculate a payroll.</p>
        <form id="pr" novalidate>
          ${ed ? '' : '<p class="note">Only the company admin can change payroll rules.</p>'}
          <fieldset ${ed ? '' : 'disabled'}>
            <div class="row-2">
              <div class="field"><label for="p_start">Pay period starts on day</label>
                <select id="p_start">${Array.from({ length: 28 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${n === s.pay_cycle_start_day ? 'selected' : ''}>${n === 1 ? '1 (calendar month)' : n}</option>`).join('')}</select>
                <span class="hint" id="p_start_hint"></span></div>
              <div class="field"><label for="p_basis">One day’s pay</label>
                <select id="p_basis">${Object.entries(BASIS).map(([k, l]) => `<option value="${k}" ${k === s.day_rate_basis ? 'selected' : ''}>${l}</option>`).join('')}</select>
                <span class="hint">Used for absent, unpaid leave and late deductions.</span></div>
            </div>
            <label class="check"><input type="checkbox" id="p_absent" ${s.deduct_absent ? 'checked' : ''}> Cut pay for absent days</label>
            <p class="hint">Absent means a working day with no check-in and no approved leave.</p>

            <div class="field"><span class="label">Late arrivals</span>
              <div class="choices">${Object.entries(LATE).map(([k, [l, d]]) => `<label class="choice"><input type="radio" name="late" value="${k}" ${k === s.late_rule ? 'checked' : ''}><span><b>${l}</b><span class="hint">${d}</span></span></label>`).join('')}</div></div>
            <div class="row-2" id="lateCount">
              <div class="field"><label for="p_lc">Every this many late days</label><input id="p_lc" type="number" min="1" max="31" value="${s.late_count_per_cut}"></div>
              <div class="field"><label for="p_ld">cut this many days of pay</label><input id="p_ld" type="number" min="0.5" max="5" step="0.5" value="${nd(s.late_cut_days)}"></div>
            </div>

            <div class="row-2">
              <div class="field"><label for="p_hours">Working hours in a day</label><input id="p_hours" type="number" min="1" max="24" step="0.5" value="${nd(s.hours_per_day)}"><span class="hint">Used for the per-minute and overtime rate.</span></div>
              <div class="field"><label for="p_ot">Overtime</label>
                <select id="p_ot"><option value="none" ${s.overtime_mode === 'none' ? 'selected' : ''}>No overtime pay</option><option value="hourly" ${s.overtime_mode === 'hourly' ? 'selected' : ''}>Pay per hour</option></select></div>
            </div>
            <div class="row-2" id="otBox">
              <div class="field"><label for="p_otm">Overtime rate</label>
                <select id="p_otm">${[1, 1.25, 1.5, 2].map((x) => `<option value="${x}" ${Number(s.overtime_multiplier) === x ? 'selected' : ''}>${x}× normal hourly pay</option>`).join('')}</select></div>
              <div class="field"><label for="p_otmin">Count overtime after (minutes)</label><input id="p_otmin" type="number" min="0" max="600" step="5" value="${s.overtime_min_minutes}"><span class="hint">Time worked beyond the shift. Shorter extra time is ignored.</span></div>
            </div>
            <label class="check"><input type="checkbox" id="p_adv" ${s.deduct_advances ? 'checked' : ''}> Cut advance installments from salary</label>
            <p class="hint">Commission is set on each employee’s profile, as a percent of their own sales closing or a fixed amount.</p>
            <div class="form-end"><button class="btn" type="submit">Save payroll rules</button></div>
          </fieldset>
        </form>
      </section>`);

    const f = document.getElementById('pr');
    const sync = () => {
      const late = f.querySelector('input[name=late]:checked')?.value;
      f.querySelector('#lateCount').hidden = late !== 'count';
      f.querySelector('#otBox').hidden = f.querySelector('#p_ot').value !== 'hourly';
      const d = Number(f.querySelector('#p_start').value);
      f.querySelector('#p_start_hint').textContent = d === 1 ? 'October pay covers 1 to 31 October.' : `October pay covers ${d} September to ${d - 1} October.`;
    };
    f.querySelectorAll('input[name=late]').forEach((r) => r.onchange = sync);
    f.querySelector('#p_ot').onchange = sync; f.querySelector('#p_start').onchange = sync; sync();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = {
        pay_cycle_start_day: Number(f.querySelector('#p_start').value), day_rate_basis: f.querySelector('#p_basis').value,
        deduct_absent: f.querySelector('#p_absent').checked, late_rule: f.querySelector('input[name=late]:checked')?.value || 'none',
        late_count_per_cut: Number(f.querySelector('#p_lc').value), late_cut_days: Number(f.querySelector('#p_ld').value),
        hours_per_day: Number(f.querySelector('#p_hours').value), overtime_mode: f.querySelector('#p_ot').value,
        overtime_multiplier: Number(f.querySelector('#p_otm').value), overtime_min_minutes: Number(f.querySelector('#p_otmin').value),
        deduct_advances: f.querySelector('#p_adv').checked,
      };
      if (!(v.late_count_per_cut >= 1 && v.late_count_per_cut <= 31)) return alertIn(f, 'Late days must be between 1 and 31.');
      if (!(v.late_cut_days >= 0.5 && v.late_cut_days <= 5)) return alertIn(f, 'Days cut must be between 0.5 and 5.');
      if (!(v.hours_per_day >= 1 && v.hours_per_day <= 24)) return alertIn(f, 'Working hours must be between 1 and 24.');
      if (!(v.overtime_min_minutes >= 0 && v.overtime_min_minutes <= 600)) return alertIn(f, 'Overtime minutes must be between 0 and 600.');
      const btn = f.querySelector('button[type=submit]'); busy(btn, true, 'Saving…');
      const { error } = await sb.from('company_settings').update(v).eq('company_id', cid());
      busy(btn, false);
      if (error) return alertIn(f, msg(error));
      alertIn(f, 'Payroll rules saved. Recalculate any draft payroll to use them.', 'ok');
    });
  }

  return { viewPayroll };
}
