// =============================================================
//  Veltrio admin panel - Part 9
//  Veltrio (super admin): overview, companies, payments, plans and
//  payment details. Company side: plan and payments in Settings.
// =============================================================

const SUB = { trial: ['Free trial', 'pill-trial'], active: ['Paid', 'pill-active'], expired: ['Expired', 'pill-expired'], cancelled: ['Cancelled', 'pill-expired'], suspended: ['Suspended', 'pill-expired'] };
const METHOD = { bank_transfer: 'Bank transfer', jazzcash: 'JazzCash', easypaisa: 'Easypaisa', card: 'Card', other: 'Other' };

export function initAdminPages(ctx) {
  const { sb, state, shell, bindShell, esc, busy, friendlyError, today } = ctx;
  const app = () => document.getElementById('app');
  const money = (n) => new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));
  const fmtY = (d) => (d ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(String(d).slice(0, 10) + 'T00:00:00')) : '');
  const daysTo = (d) => Math.round((Date.parse(d) - Date.parse(today())) / 864e5);
  const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const msg = (err) => {
    const m = (err && err.message) || String(err);
    if (/function .* does not exist|schema cache|relation .* does not exist|column .* does not exist/i.test(m)) return 'Run the Part 9 database update in Supabase first.';
    if (/row-level security|permission denied/i.test(m)) return 'You do not have permission to do this.';
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
  function page(key, title, sub, actions, body) {
    app().innerHTML = shell(key, `
      <div class="topbar"><div>
        <button class="btn btn-ghost menu-btn" data-menu type="button" aria-label="Open menu">Menu</button>
        <h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
        ${actions ? `<div class="actions">${actions}</div>` : ''}</div>
      <div id="body">${body}</div><dialog id="dlg" class="dlg"></dialog>`);
    bindShell();
  }
  const loading = '<div class="panel"><p class="sub">Loading…</p></div>';
  const errBody = (e) => `<div class="alert alert-error" role="alert">${esc(msg(e))}</div>`;
  const subPill = (c) => {
    const k = c.status === 'suspended' ? 'suspended' : (c.sub_status === 'trial' || c.sub_status === 'active') && c.end_date && daysTo(c.end_date) < 0 ? 'expired' : (c.sub_status || 'expired');
    const [l, cls] = SUB[k] || [k, ''];
    return `<span class="pill ${cls}">${l}</span>`;
  };
  async function proofLink(path) {
    if (!path) return '';
    const { data } = await sb.storage.from('payment-proofs').createSignedUrl(path, 3600);
    return data?.signedUrl || '';
  }

  // =============================================================
  // OVERVIEW
  // =============================================================
  async function viewOverview() {
    page('dashboard', 'Overview', 'All companies on Veltrio.', '', loading);
    const [c, r, cl] = await Promise.all([sb.rpc('admin_companies'), sb.rpc('admin_revenue', { p_months: 6 }),
      sb.from('cleanup_runs').select('*').order('ran_at', { ascending: false }).limit(1)]);
    if (c.error) return page('dashboard', 'Overview', '', '', errBody(c.error));
    const list = c.data || [], rev = r.data || [];
    const live = (x) => x.status !== 'suspended' && x.end_date && daysTo(x.end_date) >= 0;
    const paying = list.filter((x) => live(x) && x.sub_status === 'active').length;
    const trial = list.filter((x) => live(x) && x.sub_status === 'trial').length;
    const soon = list.filter((x) => live(x) && daysTo(x.end_date) <= 7).sort((a, b) => a.end_date.localeCompare(b.end_date));
    const pend = list.reduce((t, x) => t + Number(x.pending_payments), 0);
    const thisMonth = rev.find((x) => x.month.slice(0, 7) === today().slice(0, 7));
    const staff = list.reduce((t, x) => t + Number(x.employees), 0);
    const maxRev = Math.max(1, ...rev.map((x) => Number(x.amount)));

    page('dashboard', 'Overview', 'All companies on Veltrio.', pend ? `<a class="btn" href="#/payments">Review ${pend} payment${pend === 1 ? '' : 's'}</a>` : '', `
      <section class="stats" aria-label="Summary">
        <div class="stat"><div class="label">Paying companies</div><div class="value">${paying}</div><div class="foot">${trial} on free trial</div></div>
        <div class="stat"><div class="label">Received this month</div><div class="value">Rs ${money(thisMonth?.amount)}</div><div class="foot">${thisMonth?.payments || 0} payment${Number(thisMonth?.payments) === 1 ? '' : 's'}</div></div>
        <div class="stat"><div class="label">Employees using Veltrio</div><div class="value">${staff}</div><div class="foot">in ${list.length} compan${list.length === 1 ? 'y' : 'ies'}</div></div>
        <div class="stat"><div class="label">Payments to review</div><div class="value">${pend}</div>${pend ? '<div class="foot"><a href="#/payments">Open payments</a></div>' : ''}</div>
      </section>
      <div class="two-col">
        <section class="panel"><h2>Ending in the next 7 days</h2>
          ${soon.length ? `<ul class="duties">${soon.map((x) => `<li><div><b>${esc(x.name)}</b><span class="hint">${esc(x.plan_name || '')}, ${x.sub_status === 'trial' ? 'trial' : 'paid'} until ${fmtY(x.end_date)}</span></div><span class="pill pill-trial">${daysTo(x.end_date)} day${daysTo(x.end_date) === 1 ? '' : 's'}</span></li>`).join('')}</ul>` : '<p class="hint">No plan ends this week.</p>'}
        </section>
        <section class="panel"><h2>Money received</h2>
          ${rev.length ? `<div class="bars" role="img" aria-label="Money received per month">${rev.map((x) => `<div class="bar"><span class="bv">${money(x.amount)}</span><span class="bf" style="height:${Math.max(4, Math.round((Number(x.amount) / maxRev) * 100))}%"></span><span class="bl">${new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(new Date(x.month + 'T00:00:00'))}</span></div>`).join('')}</div>` : '<p class="hint">Approved payments show here.</p>'}
        </section>
      </div>
      <section class="panel" id="cleanup"><div class="panel-head"><div><h2>Selfie clean-up</h2><p class="sub">Every night, selfies older than each company's limit (default 60 days) are deleted.</p></div>
        <button class="btn btn-ghost btn-sm" type="button" id="runClean">Run now</button></div>
        ${cl.error ? '<p class="hint">Run the Part 10 database update to turn on automatic selfie clean-up.</p>' : cl.data?.[0] ? `<p>Last run ${esc(new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(cl.data[0].ran_at)))}: <b>${money(cl.data[0].files_deleted)}</b> old selfie${cl.data[0].files_deleted === 1 ? '' : 's'} deleted.</p>${cl.data[0].error ? `<p class="alert alert-error">${esc(cl.data[0].error)}</p>` : ''}` : '<p class="hint">Has not run yet. It runs every night at 2:00 AM.</p>'}
      </section>
      <section class="panel"><h2>Latest signups</h2>
        ${list.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Company</th><th>Plan</th><th>Status</th><th>Joined</th></tr></thead><tbody>
          ${list.slice(0, 8).map((x) => `<tr><td><b>${esc(x.name)}</b><div class="hint">${esc(x.owner_email || x.email)}</div></td><td>${esc(x.plan_name || '')}</td><td>${subPill(x)}</td><td class="num">${fmtY(x.created_at)}</td></tr>`).join('')}
        </tbody></table></div><p><a href="#/companies">All companies</a></p>` : '<div class="empty"><p>No companies yet. Share your sign-up link to get the first one.</p></div>'}
      </section>`);
    document.getElementById('runClean').onclick = (e) => runCleanup(e.currentTarget);
  }

  async function runCleanup(btn) {
    busy(btn, true, 'Cleaning…');
    const { data, error } = await sb.functions.invoke('daily-cleanup', { body: {} });
    busy(btn, false);
    if (error) {
      let m = '';
      try { m = (await error.context.json()).error || ''; } catch { /* no JSON body */ }
      if (!m && (error.context?.status === 404 || /FunctionsFetchError|Failed to send/i.test(error.name + error.message))) m = 'Deploy the "daily-cleanup" function in Supabase first (see the Part 10 steps).';
      return toast(m || error.message, 'error');
    }
    toast(`${money(data?.deleted)} old selfie${data?.deleted === 1 ? '' : 's'} deleted`);
    viewOverview();
  }

  // =============================================================
  // COMPANIES
  // =============================================================
  async function viewCompanies() {
    page('companies', 'Companies', '', '', loading);
    const [c, p] = await Promise.all([sb.rpc('admin_companies'), sb.from('plans').select('*').order('price_monthly')]);
    if (c.error) return page('companies', 'Companies', '', '', errBody(c.error));
    const list = c.data || [], plans = p.data || [];
    page('companies', 'Companies', `${list.length} compan${list.length === 1 ? 'y' : 'ies'}.`, '', `
      <div class="filters">
        <input id="q" type="search" placeholder="Search name, email or code" aria-label="Search companies">
        <select id="fs" aria-label="Filter by status"><option value="">All</option><option value="active">Paid</option><option value="trial">Free trial</option><option value="expired">Expired</option><option value="suspended">Suspended</option></select>
      </div>
      <section class="panel flush"><div class="table-wrap"><table class="list">
        <thead><tr><th>Company</th><th>Plan</th><th>Status</th><th>Until</th><th class="r">Branches</th><th class="r">Staff</th><th>Last used</th><th class="r">Paid (Rs)</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody id="rows"></tbody></table></div><p class="empty small" id="none" hidden>No companies match.</p></section>`);
    const statusOf = (x) => (x.status === 'suspended' ? 'suspended' : x.end_date && daysTo(x.end_date) < 0 ? 'expired' : x.sub_status === 'trial' ? 'trial' : x.sub_status === 'active' ? 'active' : 'expired');
    const draw = () => {
      const q = document.getElementById('q').value.trim().toLowerCase(), fs = document.getElementById('fs').value;
      const shown = list.filter((x) => (!fs || statusOf(x) === fs) && (!q || [x.name, x.email, x.owner_email, x.login_code].some((v) => String(v || '').toLowerCase().includes(q))));
      document.getElementById('none').hidden = shown.length > 0;
      document.getElementById('rows').innerHTML = shown.map((x) => `<tr>
        <td><b>${esc(x.name)}</b> <span class="code">${esc(x.login_code)}</span><div class="hint">${esc(x.owner_email || x.email)}${x.phone ? ` · ${esc(x.phone)}` : ''}</div></td>
        <td>${esc(x.plan_name || '')}${x.billing_cycle && x.billing_cycle !== 'trial' ? `<div class="hint">${x.billing_cycle}</div>` : ''}</td>
        <td>${subPill(x)}${Number(x.pending_payments) ? '<div class="hint"><a href="#/payments">Payment waiting</a></div>' : ''}</td>
        <td class="num">${fmtY(x.end_date)}${x.end_date ? `<div class="hint">${daysTo(x.end_date) >= 0 ? `${daysTo(x.end_date)} days left` : `${-daysTo(x.end_date)} days ago`}</div>` : ''}</td>
        <td class="num r">${x.branches}${x.max_branches ? ` / ${x.max_branches}` : ''}</td>
        <td class="num r">${x.employees}${x.max_employees ? ` / ${x.max_employees}` : ''}</td>
        <td class="num">${x.last_activity ? fmtY(x.last_activity) : '<span class="hint">Never</span>'}</td>
        <td class="num r">${money(x.paid_total)}</td>
        <td class="right"><button class="btn btn-ghost btn-sm" data-c="${x.id}">Manage</button></td></tr>`).join('');
      document.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => manage(list.find((x) => x.id === b.dataset.c)));
    };
    ['q', 'fs'].forEach((id) => document.getElementById(id).addEventListener('input', draw));
    draw();

    function manage(x) {
      const end = x.end_date || today();
      const f = dialog(x.name, `
        <dl class="facts two"><div><dt>Owner</dt><dd>${esc(x.owner_email || '')}</dd></div><div><dt>Company code</dt><dd>${esc(x.login_code)}</dd></div><div><dt>Joined</dt><dd>${fmtY(x.created_at)}</dd></div></dl>
        <h3 class="mini">Plan</h3>
        <div class="row-2">
          <div class="field"><label for="d_plan">Plan</label><select id="d_plan">${plans.map((p) => `<option value="${p.id}" ${p.id === x.plan_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="d_cycle">Billing</label><select id="d_cycle">${['trial', 'monthly', 'yearly'].map((k) => `<option ${k === (x.billing_cycle || 'trial') ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
        </div>
        <div class="row-2">
          <div class="field"><label for="d_end">Paid until</label><input id="d_end" type="date" value="${end}"></div>
          <div class="field"><label for="d_st">Subscription</label><select id="d_st">${['trial', 'active', 'expired', 'cancelled'].map((k) => `<option value="${k}" ${k === (x.sub_status || 'trial') ? 'selected' : ''}>${SUB[k][0]}</option>`).join('')}</select></div>
        </div>
        <p class="quick"><span class="hint">Add:</span> <button type="button" class="btn btn-ghost btn-sm" data-add="7">7 days</button> <button type="button" class="btn btn-ghost btn-sm" data-add="30">1 month</button> <button type="button" class="btn btn-ghost btn-sm" data-add="365">1 year</button></p>
        <p class="hint">Use this for cash payments, discounts or a longer trial. Online payments are approved on the Payments page.</p>
        <h3 class="mini">Access</h3>
        <p>${x.status === 'suspended' ? 'This company is <b>suspended</b>. Its staff cannot use the app.' : 'This company can use Veltrio.'}
          <button type="button" class="btn btn-ghost btn-sm ${x.status === 'suspended' ? '' : 'danger'}" id="d_susp">${x.status === 'suspended' ? 'Activate company' : 'Suspend company'}</button></p>`,
      'Save plan', async (form) => {
        const v = { p_company: x.id, p_plan: form.querySelector('#d_plan').value, p_end: form.querySelector('#d_end').value, p_cycle: form.querySelector('#d_cycle').value, p_status: form.querySelector('#d_st').value };
        if (!v.p_end) { alertIn(form, 'Choose the date.'); return false; }
        const { error } = await sb.rpc('admin_set_subscription', v);
        if (error) throw error;
        toast('Plan saved'); viewCompanies();
      }, true);
      f.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => {
        const base = f.querySelector('#d_end').value || today();
        f.querySelector('#d_end').value = addDays(base < today() ? today() : base, Number(b.dataset.add));
        if (f.querySelector('#d_st').value === 'expired') f.querySelector('#d_st').value = 'active';
      });
      f.querySelector('#d_susp').onclick = async () => {
        const to = x.status === 'suspended' ? 'active' : 'suspended';
        if (to === 'suspended' && !confirm(`Suspend ${x.name}? Their staff will not be able to use the app until you activate it.`)) return;
        const { error } = await sb.rpc('admin_set_company_status', { p_company: x.id, p_status: to });
        if (error) return alertIn(f, msg(error));
        document.getElementById('dlg').close(); toast(to === 'suspended' ? 'Company suspended' : 'Company activated'); viewCompanies();
      };
    }
  }

  // =============================================================
  // PAYMENTS
  // =============================================================
  async function viewPayments() {
    page('payments', 'Payments', '', '', loading);
    const [p, c, pl] = await Promise.all([
      sb.from('payments').select('*').order('created_at', { ascending: false }).limit(300),
      sb.from('companies').select('id, name, login_code'),
      sb.from('plans').select('id, name'),
    ]);
    if (p.error) return page('payments', 'Payments', '', '', errBody(p.error));
    const list = p.data || [], cos = c.data || [], plans = pl.data || [];
    const co = (id) => cos.find((x) => x.id === id) || {};
    const plan = (id) => plans.find((x) => x.id === id)?.name || '';
    const pend = list.filter((x) => x.status === 'pending');
    page('payments', 'Payments', `${pend.length} waiting for review.`, '', list.length ? `
      <div class="filters"><select id="fs" aria-label="Filter by status"><option value="pending">Waiting (${pend.length})</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All</option></select></div>
      <section class="panel flush"><div class="table-wrap"><table class="list">
        <thead><tr><th>Company</th><th>Paying for</th><th class="r">Amount (Rs)</th><th>Method</th><th>Reference</th><th>Sent</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody id="rows"></tbody></table></div><p class="empty small" id="none" hidden>Nothing here.</p></section>`
      : '<section class="panel"><div class="empty"><h2>No payments yet</h2><p>When a company pays and sends the details from its Settings, it shows up here for you to approve.</p></div></section>');
    const draw = () => {
      const fs = document.getElementById('fs').value;
      const shown = list.filter((x) => !fs || x.status === fs);
      document.getElementById('none').hidden = shown.length > 0;
      document.getElementById('rows').innerHTML = shown.map((x) => `<tr>
        <td><b>${esc(co(x.company_id).name || '')}</b> <span class="code">${esc(co(x.company_id).login_code || '')}</span></td>
        <td>${esc(plan(x.plan_id))}${x.billing_cycle ? `<div class="hint">${x.billing_cycle === 'yearly' ? '1 year' : '1 month'}</div>` : ''}</td>
        <td class="num r"><b>${money(x.amount)}</b></td><td>${METHOD[x.method] || x.method}</td><td>${esc(x.reference_no || '')}</td>
        <td class="num">${fmtY(x.paid_at || x.created_at)}</td>
        <td><span class="pill ${x.status === 'approved' ? 'pill-active' : x.status === 'rejected' ? 'pill-expired' : 'pill-trial'}">${x.status === 'pending' ? 'Waiting' : x.status === 'approved' ? 'Approved' : 'Rejected'}</span>${x.review_note ? `<div class="hint">${esc(x.review_note)}</div>` : ''}</td>
        <td class="right nowrap"><button class="btn btn-ghost btn-sm" data-p="${x.id}">${x.status === 'pending' ? 'Review' : 'View'}</button></td></tr>`).join('');
      document.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => review(list.find((x) => x.id === b.dataset.p)));
    };
    document.getElementById('fs')?.addEventListener('input', draw);
    if (list.length) draw();

    async function review(x) {
      const url = await proofLink(x.proof_url);
      const isPdf = /\.pdf$/i.test(x.proof_url || '');
      const pending = x.status === 'pending';
      const f = dialog(`${co(x.company_id).name || ''}: Rs ${money(x.amount)}`, `
        <dl class="facts two"><div><dt>Paying for</dt><dd>${esc(plan(x.plan_id))}, ${x.billing_cycle === 'yearly' ? '1 year' : '1 month'}</dd></div>
          <div><dt>Method</dt><dd>${METHOD[x.method] || x.method}</dd></div><div><dt>Reference</dt><dd>${esc(x.reference_no || '–')}</dd></div><div><dt>Paid on</dt><dd>${fmtY(x.paid_at || x.created_at)}</dd></div></dl>
        ${url ? (isPdf ? `<p><a href="${esc(url)}" target="_blank" rel="noopener">Open the receipt (PDF)</a></p>` : `<a href="${esc(url)}" target="_blank" rel="noopener"><img class="proof" src="${esc(url)}" alt="Payment screenshot"></a>`) : '<p class="hint">No screenshot attached.</p>'}
        ${pending ? `<p class="hint">Check that the money reached your account before approving. Approving adds ${x.billing_cycle === 'yearly' ? '1 year' : '1 month'} after the current end date.</p>
          <div class="field"><label for="d_note">Note to the company <span class="opt">needed when rejecting</span></label><input id="d_note" placeholder="Amount not received"></div>
          <p><button type="button" class="btn btn-ghost danger" id="d_rej">Reject</button></p>` : `${x.review_note ? `<p>Note: ${esc(x.review_note)}</p>` : ''}`}`,
        pending ? 'Approve payment' : '', async (form) => {
          const { data, error } = await sb.rpc('admin_review_payment', { p_payment: x.id, p_approve: true, p_note: form.querySelector('#d_note').value.trim() || null });
          if (error) throw error;
          toast(`Approved. Paid until ${fmtY(data)}`); viewPayments();
        }, true);
      f.querySelector('#d_rej')?.addEventListener('click', async () => {
        const note = f.querySelector('#d_note').value.trim();
        if (!note) return alertIn(f, 'Write why the payment is rejected, so the company knows.');
        const { error } = await sb.rpc('admin_review_payment', { p_payment: x.id, p_approve: false, p_note: note });
        if (error) return alertIn(f, msg(error));
        document.getElementById('dlg').close(); toast('Payment rejected'); viewPayments();
      });
    }
  }

  // =============================================================
  // PLANS + PAYMENT DETAILS
  // =============================================================
  async function viewPlans() {
    page('plans', 'Plans', '', '', loading);
    const [p, s] = await Promise.all([sb.from('plans').select('*').order('price_monthly'), sb.from('platform_settings').select('*').eq('id', 1).maybeSingle()]);
    if (p.error) return page('plans', 'Plans', '', '', errBody(p.error));
    const plans = p.data || [], ps = s.data || {};
    page('plans', 'Plans', 'Prices and limits companies see when they sign up and pay.', '<button class="btn" type="button" id="addPlan">Add plan</button>', `
      <section class="panel flush"><div class="table-wrap"><table class="list">
        <thead><tr><th>Plan</th><th class="r">Monthly (Rs)</th><th class="r">Yearly (Rs)</th><th class="r">Branches</th><th class="r">Employees</th><th class="r">Trial days</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${plans.map((x) => `<tr class="${x.is_active ? '' : 'muted-row'}"><td><b>${esc(x.name)}</b></td><td class="num r">${money(x.price_monthly)}</td><td class="num r">${money(x.price_yearly)}</td>
          <td class="num r">${x.max_branches ?? 'Unlimited'}</td><td class="num r">${x.max_employees ?? 'Unlimited'}</td><td class="num r">${x.trial_days}</td>
          <td>${x.is_active ? '<span class="pill pill-active">On sale</span>' : '<span class="pill pill-expired">Hidden</span>'}</td>
          <td class="right"><button class="btn btn-ghost btn-sm" data-plan="${x.id}">Edit</button></td></tr>`).join('')}</tbody></table></div></section>
      ${plans.some((x) => !Number(x.price_monthly)) ? '<p class="note">Some plans have no price yet. Set the prices before companies start paying.</p>' : ''}
      <section class="panel"><h2>How companies pay you</h2><p class="sub">Shown to companies on their Settings page when they pay or renew.</p>
        <form id="pf" novalidate>
          <div class="field"><label for="p_bank">Bank account</label><textarea id="p_bank" rows="3" placeholder="Meezan Bank&#10;Account title: Umer Ashraf&#10;IBAN: PK00 MEZN ...">${esc(ps.bank_details)}</textarea></div>
          <div class="row-2"><div class="field"><label for="p_jc">JazzCash number</label><input id="p_jc" value="${esc(ps.jazzcash)}" placeholder="0300 1234567 (name)"></div>
            <div class="field"><label for="p_ep">Easypaisa number</label><input id="p_ep" value="${esc(ps.easypaisa)}"></div></div>
          <div class="row-2"><div class="field"><label for="p_ph">Support WhatsApp / phone</label><input id="p_ph" value="${esc(ps.support_phone)}"></div>
            <div class="field"><label for="p_em">Support email</label><input id="p_em" type="email" value="${esc(ps.support_email)}"></div></div>
          <div class="field"><label for="p_note">Note</label><input id="p_note" value="${esc(ps.payment_note)}"></div>
          <div class="form-end"><button class="btn" type="submit">Save payment details</button></div>
        </form></section>`);

    const openPlan = (x) => {
      const isNew = !x; x = x || { price_monthly: 0, price_yearly: 0, trial_days: 14, is_active: true, max_branches: 5, max_employees: 50 };
      const f = dialog(isNew ? 'Add plan' : `Edit ${x.name}`, `
        <div class="field"><label for="d_name">Name</label><input id="d_name" value="${esc(x.name)}"></div>
        <div class="row-2"><div class="field"><label for="d_m">Monthly price (Rs)</label><input id="d_m" type="number" min="0" step="100" value="${Number(x.price_monthly)}"></div>
          <div class="field"><label for="d_y">Yearly price (Rs)</label><input id="d_y" type="number" min="0" step="100" value="${Number(x.price_yearly)}"><span class="hint" id="d_save"></span></div></div>
        <div class="row-2"><div class="field"><label for="d_b">Branches</label><input id="d_b" type="number" min="1" value="${x.max_branches ?? ''}" placeholder="Unlimited"></div>
          <div class="field"><label for="d_e">Employees</label><input id="d_e" type="number" min="1" value="${x.max_employees ?? ''}" placeholder="Unlimited"></div></div>
        <span class="hint">Leave empty for unlimited.</span>
        <div class="field" style="margin-top:12px"><label for="d_t">Free trial days</label><input id="d_t" type="number" min="0" max="90" value="${x.trial_days}"></div>
        <label class="check"><input type="checkbox" id="d_on" ${x.is_active ? 'checked' : ''}> On sale (shown at sign-up)</label>
        ${isNew ? '' : '<p class="hint">Companies already on this plan keep it. Lower limits stop them adding more, nothing is deleted.</p>'}`,
        isNew ? 'Add plan' : 'Save plan', async (form) => {
          const n = (id) => (form.querySelector(id).value === '' ? null : Number(form.querySelector(id).value));
          const v = { name: form.querySelector('#d_name').value.trim(), price_monthly: n('#d_m') ?? 0, price_yearly: n('#d_y') ?? 0,
            max_branches: n('#d_b'), max_employees: n('#d_e'), trial_days: n('#d_t') ?? 0, is_active: form.querySelector('#d_on').checked };
          if (!v.name) { alertIn(form, 'Enter the plan name.'); return false; }
          if (v.price_monthly < 0 || v.price_yearly < 0) { alertIn(form, 'Prices cannot be negative.'); return false; }
          const r = isNew ? await sb.from('plans').insert(v) : await sb.from('plans').update(v).eq('id', x.id);
          if (r.error) throw r.error;
          toast('Plan saved'); viewPlans();
        });
      const sync = () => { const m = Number(f.querySelector('#d_m').value), y = Number(f.querySelector('#d_y').value); f.querySelector('#d_save').textContent = m && y && y < m * 12 ? `Saves ${Math.round(100 - (y / (m * 12)) * 100)}% against monthly` : ''; };
      f.querySelector('#d_m').oninput = sync; f.querySelector('#d_y').oninput = sync; sync();
    };
    document.getElementById('addPlan').onclick = () => openPlan(null);
    document.querySelectorAll('[data-plan]').forEach((b) => b.onclick = () => openPlan(plans.find((x) => x.id === b.dataset.plan)));
    const pf = document.getElementById('pf');
    pf.onsubmit = async (e) => {
      e.preventDefault();
      const v = { bank_details: pf.querySelector('#p_bank').value.trim() || null, jazzcash: pf.querySelector('#p_jc').value.trim() || null,
        easypaisa: pf.querySelector('#p_ep').value.trim() || null, support_phone: pf.querySelector('#p_ph').value.trim() || null,
        support_email: pf.querySelector('#p_em').value.trim() || null, payment_note: pf.querySelector('#p_note').value.trim() || null, updated_at: new Date().toISOString() };
      const btn = pf.querySelector('button[type=submit]'); busy(btn, true, 'Saving…');
      const { error } = await sb.from('platform_settings').update(v).eq('id', 1);
      busy(btn, false);
      if (error) return alertIn(pf, msg(error));
      alertIn(pf, 'Payment details saved.', 'ok');
    };
  }

  // =============================================================
  // COMPANY SIDE: plan and payments (inside Settings)
  // =============================================================
  async function billingPanel() {
    const cid = state.profile.company_id;
    const [pl, py, ps] = await Promise.all([
      sb.from('plans').select('*').eq('is_active', true).order('price_monthly'),
      sb.from('payments').select('*').eq('company_id', cid).order('created_at', { ascending: false }).limit(20),
      sb.from('platform_settings').select('*').eq('id', 1).maybeSingle(),
    ]);
    if (pl.error || py.error) return `<section class="panel" id="s-plan"><h2>Plan</h2>${errBody(pl.error || py.error)}</section>`;
    const plans = pl.data || [], pays = py.data || [], how = ps.data || {};
    const sub = state.sub, cur = sub?.plans;
    const left = sub ? daysTo(sub.end_date) : null;
    const pending = pays.find((x) => x.status === 'pending');
    const admin = state.profile.role === 'company_admin';
    const status = state.company?.status === 'suspended' ? 'Suspended' : left < 0 ? 'Expired' : sub?.status === 'trial' ? 'Free trial' : 'Paid';
    return `
      <section class="panel" id="s-plan">
        <h2>Plan and payments</h2>
        <dl class="facts">
          <div><dt>Current plan</dt><dd>${esc(cur?.name || '')}</dd></div>
          <div><dt>Status</dt><dd>${status}</dd></div>
          <div><dt>${left < 0 ? 'Ended on' : 'Until'}</dt><dd>${sub ? fmtY(sub.end_date) : ''}${left >= 0 ? ` <span class="hint">(${left} days)</span>` : ''}</dd></div>
          <div><dt>Limits</dt><dd>${cur?.max_branches ? `${cur.max_branches} branches, ${cur.max_employees} employees` : 'Unlimited'}</dd></div>
        </dl>
        ${!admin ? '<p class="note">Only the company admin can pay or change the plan.</p>' : pending ? `<p class="alert alert-info">Your payment of Rs ${money(pending.amount)} sent on ${fmtY(pending.paid_at || pending.created_at)} is waiting for Veltrio to check it. Your plan is extended once it is approved.</p>` : `
        <div class="pay-how">
          <h3 class="mini">How to pay</h3>
          ${how.bank_details ? `<p><b>Bank transfer</b><br>${esc(how.bank_details).replace(/\n/g, '<br>')}</p>` : ''}
          ${how.jazzcash ? `<p><b>JazzCash:</b> ${esc(how.jazzcash)}</p>` : ''}${how.easypaisa ? `<p><b>Easypaisa:</b> ${esc(how.easypaisa)}</p>` : ''}
          ${!how.bank_details && !how.jazzcash && !how.easypaisa ? `<p class="hint">Contact Veltrio for payment details${how.support_phone ? `: ${esc(how.support_phone)}` : ''}.</p>` : ''}
          ${how.payment_note ? `<p class="hint">${esc(how.payment_note)}</p>` : ''}
        </div>
        <form id="payf" novalidate>
          <h3 class="mini">I have paid</h3>
          <div class="row-2">
            <div class="field"><label for="y_plan">Plan</label><select id="y_plan">${plans.map((p) => `<option value="${p.id}" data-m="${p.price_monthly}" data-y="${p.price_yearly}" ${p.id === sub?.plan_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
            <div class="field"><label for="y_cycle">For</label><select id="y_cycle"><option value="monthly">1 month</option><option value="yearly">1 year</option></select></div>
          </div>
          <div class="row-2">
            <div class="field"><label for="y_amt">Amount paid (Rs)</label><input id="y_amt" type="number" min="1" step="1"></div>
            <div class="field"><label for="y_m">Paid by</label><select id="y_m">${Object.entries(METHOD).filter(([k]) => k !== 'card').map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
          </div>
          <div class="row-2">
            <div class="field"><label for="y_ref">Transaction ID / reference</label><input id="y_ref" placeholder="TRX 1234567"></div>
            <div class="field"><label for="y_on">Paid on</label><input id="y_on" type="date" value="${today()}" max="${today()}"></div>
          </div>
          <div class="field"><label for="y_proof">Screenshot or receipt <span class="opt">recommended</span></label><input id="y_proof" type="file" accept="image/*,application/pdf"></div>
          <div class="form-end"><button class="btn" type="submit">Send payment details</button></div>
        </form>`}
        ${pays.length ? `<h3 class="mini">Payments</h3><ul class="duties">${pays.map((x) => `<li><div><b>Rs ${money(x.amount)}</b> <span class="hint">${METHOD[x.method] || x.method}${x.reference_no ? `, ${esc(x.reference_no)}` : ''}, ${fmtY(x.paid_at || x.created_at)}</span>${x.review_note ? `<span class="hint">Veltrio: ${esc(x.review_note)}</span>` : ''}</div>
          <span class="pill ${x.status === 'approved' ? 'pill-active' : x.status === 'rejected' ? 'pill-expired' : 'pill-trial'}">${x.status === 'pending' ? 'Waiting' : x.status === 'approved' ? 'Approved' : 'Rejected'}</span></li>`).join('')}</ul>` : ''}
        ${how.support_phone || how.support_email ? `<p class="hint">Help: ${esc([how.support_phone, how.support_email].filter(Boolean).join(', '))}</p>` : ''}
      </section>`;
  }

  function bindBilling(reload) {
    const f = document.getElementById('payf');
    if (!f) return;
    const amt = f.querySelector('#y_amt');
    const fill = () => { const o = f.querySelector('#y_plan').selectedOptions[0]; const v = Number(f.querySelector('#y_cycle').value === 'yearly' ? o.dataset.y : o.dataset.m); if (v) amt.value = v; };
    f.querySelector('#y_plan').onchange = fill; f.querySelector('#y_cycle').onchange = fill; fill();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const cid = state.profile.company_id;
      const v = { plan_id: f.querySelector('#y_plan').value, billing_cycle: f.querySelector('#y_cycle').value, amount: Number(amt.value),
        method: f.querySelector('#y_m').value, reference_no: f.querySelector('#y_ref').value.trim() || null, paid_at: f.querySelector('#y_on').value || null };
      if (!(v.amount > 0)) return alertIn(f, 'Enter the amount you paid.');
      if (!v.reference_no && !f.querySelector('#y_proof').files[0]) return alertIn(f, 'Add the transaction ID or a screenshot, so Veltrio can find your payment.');
      const btn = f.querySelector('button[type=submit]'); busy(btn, true, 'Sending…');
      try {
        let proof = null;
        const file = f.querySelector('#y_proof').files[0];
        if (file) {
          if (file.size > 3 * 1024 * 1024) throw new Error('The file is too big. Use a screenshot under 3 MB.');
          const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z]/g, '');
          proof = `${cid}/${Date.now()}.${ext}`;
          const up = await sb.storage.from('payment-proofs').upload(proof, file, { contentType: file.type || 'image/jpeg' });
          if (up.error) throw new Error('The screenshot could not be uploaded. Try a JPG or PNG under 3 MB.');
        }
        const { error } = await sb.from('payments').insert({ ...v, company_id: cid, proof_url: proof, status: 'pending', submitted_by: state.session.user.id });
        if (error) throw error;
        toast('Payment details sent'); reload();
      } catch (err) { busy(btn, false); alertIn(f, msg(err)); }
    };
  }

  return { viewOverview, viewCompanies, viewPayments, viewPlans, billingPanel, bindBilling };
}
