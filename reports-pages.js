// =============================================================
//  Veltrio admin panel - Part 7.7
//  Products, Attendance (today + report + marking by hand) and
//  Sales closing (report, by branch, by product, corrections)
// =============================================================

const ATT = {
  present: ['Present', 'pill-active'], late: ['Late', 'pill-trial'], absent: ['Absent', 'pill-expired'],
  half_day: ['Half day', 'pill-trial'], leave: ['Leave', 'pill-neutral'], holiday: ['Holiday', 'pill-neutral'],
  off: ['Day off', 'pill-neutral'], notin: ['Not in yet', 'pill-trial'],
};
const CL_STATUS = { submitted: 'Submitted', correction_requested: 'Correction asked', corrected: 'Corrected', approved: 'Approved' };

export function initReportPages(ctx) {
  const { sb, state, shell, bindShell, esc, busy, friendlyError, today, can } = ctx;
  const cid = () => state.profile.company_id;
  const app = () => document.getElementById('app');
  const money = (n) => new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));
  const fmt = (d) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(d + 'T00:00:00'));
  const fmtY = (d) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d + 'T00:00:00'));
  const tz = () => state.tz || 'Asia/Karachi';
  const clock = (ts) => (ts ? new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz() }).format(new Date(ts)) : '');
  const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const monthStart = () => today().slice(0, 8) + '01';
  const hm = (min) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`;

  const msg = (err) => {
    const m = (err && err.message) || String(err);
    if (err && err.code === '23505') return 'This already exists. Use a different name or code.';
    if (/row-level security|permission denied/i.test(m)) return 'You do not have permission to make this change.';
    if (/function .* does not exist|schema cache|column .* does not exist/i.test(m)) return 'Run the Part 7.7 database update in Supabase first.';
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
  function csv(name, head, rows) {
    const q = (v) => { const x = String(v ?? ''); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const blob = new Blob(['﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function page(key, title, tabs, tab, actions, body, sub) {
    app().innerHTML = shell(key, `
      <div class="topbar">
        <div>
          <button class="btn btn-ghost menu-btn" data-menu type="button" aria-label="Open menu">Menu</button>
          <h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}
        </div>
        ${actions ? `<div class="actions">${actions}</div>` : ''}
      </div>
      ${tabs ? `<nav class="tabs" aria-label="${esc(title)} sections">${tabs.map(([k, l]) => `<a href="#/${key}?tab=${k}" class="${k === tab ? 'on' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>` : ''}
      <div id="body">${body}</div>
      <dialog id="dlg" class="dlg"></dialog>`);
    bindShell();
  }
  const loading = '<div class="panel"><p class="sub">Loading…</p></div>';
  const errBody = (e) => `<div class="alert alert-error" role="alert">${esc(msg(e))}</div>`;

  async function lookups() {
    const [e, b, s, h] = await Promise.all([
      sb.from('employees').select('id, full_name, employee_code, home_branch_id, status, work_mode, weekly_off_days, joining_date').eq('company_id', cid()).order('full_name'),
      sb.from('branches').select('id, name, is_active').eq('company_id', cid()).order('name'),
      sb.from('company_settings').select('*').eq('company_id', cid()).maybeSingle(),
      sb.from('holidays').select('holiday_date, name').eq('company_id', cid()),
    ]);
    for (const r of [e, b, s]) if (r.error) throw r.error;
    state.tz = s.data?.timezone || 'Asia/Karachi';
    return { emps: e.data || [], branches: b.data || [], settings: s.data || {}, holidays: h.data || [] };
  }
  const isOff = (L, e, d) => {
    const dow = new Date(d + 'T00:00:00').getDay();
    return (e.weekly_off_days || L.settings.weekly_off_days || []).includes(dow) || L.holidays.some((h) => h.holiday_date === d);
  };

  // =============================================================
  // PRODUCTS
  // =============================================================
  async function viewProducts() {
    page('products', 'Products', null, null, '', loading);
    const edit = can('products.manage');
    let products, cats;
    try {
      const [p, c] = await Promise.all([
        sb.from('products').select('*').eq('company_id', cid()).order('name'),
        sb.from('product_categories').select('id, name').eq('company_id', cid()).order('name'),
      ]);
      if (p.error) throw p.error;
      products = p.data || []; cats = c.data || [];
    } catch (err) { return page('products', 'Products', null, null, '', errBody(err)); }
    const catName = (id) => cats.find((c) => c.id === id)?.name || '';
    const active = products.filter((p) => p.is_active).length;
    const actions = edit ? '<button class="btn btn-ghost" type="button" id="imp">Import from Excel</button><button class="btn" type="button" id="addP">Add product</button>' : '';

    page('products', 'Products', null, null, actions, products.length ? `
      <div class="filters">
        <input id="q" type="search" placeholder="Search name or code" aria-label="Search products">
        <select id="fc" aria-label="Filter by category"><option value="">All categories</option>${cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        <select id="fa" aria-label="Filter by status"><option value="1">In use</option><option value="">All</option><option value="0">Not in use</option></select>
      </div>
      <section class="panel flush"><div class="table-wrap"><table class="list">
        <thead><tr><th>Product</th><th>Code</th><th>Category</th><th class="r">Price (Rs)</th><th>Status</th>${edit ? '<th><span class="sr-only">Actions</span></th>' : ''}</tr></thead>
        <tbody id="rows"></tbody></table></div>
        <p class="empty small" id="none" hidden>No products match.</p></section>` : `
      <section class="panel"><div class="empty"><h2>Add your products</h2>
        <p>Employees pick these in their daily closing. You can add them one by one or import a list from Excel.</p></div></section>`,
      `${active} product${active === 1 ? '' : 's'} in use.`);

    const draw = () => {
      const q = document.getElementById('q')?.value.trim().toLowerCase() || '', fc = document.getElementById('fc')?.value || '', fa = document.getElementById('fa')?.value ?? '1';
      const list = products.filter((p) => (!fc || p.category_id === fc) && (fa === '' || String(Number(p.is_active)) === fa)
        && (!q || [p.name, p.sku].some((v) => String(v || '').toLowerCase().includes(q))));
      const rows = document.getElementById('rows'); if (!rows) return;
      document.getElementById('none').hidden = list.length > 0;
      rows.innerHTML = list.map((p) => `<tr class="${p.is_active ? '' : 'muted-row'}">
        <td><b>${esc(p.name)}</b></td><td>${esc(p.sku || '')}</td><td>${esc(catName(p.category_id))}</td>
        <td class="num r">${money(p.default_price)}</td><td>${p.is_active ? '<span class="pill pill-active">In use</span>' : '<span class="pill pill-expired">Off</span>'}</td>
        ${edit ? `<td class="right"><button class="btn btn-ghost btn-sm" data-p="${p.id}">Edit</button></td>` : ''}</tr>`).join('');
      rows.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => openP(products.find((p) => p.id === b.dataset.p)));
    };
    ['q', 'fc', 'fa'].forEach((id) => document.getElementById(id)?.addEventListener('input', draw));
    draw();

    async function categoryId(f) {
      const sel = f.querySelector('#d_cat').value;
      if (sel !== '__new') return sel || null;
      const name = f.querySelector('#d_newcat').value.trim();
      if (!name) throw new Error('Enter the new category name.');
      const { data, error } = await sb.from('product_categories').insert({ company_id: cid(), name }).select('id').single();
      if (error) throw error;
      return data.id;
    }
    function openP(p) {
      const isNew = !p; p = p || { is_active: true, default_price: 0 };
      const f = dialog(isNew ? 'Add product' : `Edit ${p.name}`, `
        <div class="field"><label for="d_name">Product name</label><input id="d_name" value="${esc(p.name)}" placeholder="Matte Lipstick 05"></div>
        <div class="row-2">
          <div class="field"><label for="d_sku">Code / barcode <span class="opt">optional</span></label><input id="d_sku" value="${esc(p.sku)}"></div>
          <div class="field"><label for="d_price">Price (Rs)</label><input id="d_price" type="number" min="0" step="1" value="${Number(p.default_price)}"></div>
        </div>
        <div class="field"><label for="d_cat">Category</label><select id="d_cat"><option value="">None</option>${cats.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="__new">+ New category</option></select></div>
        <div class="field" id="newCatWrap" hidden><label for="d_newcat">New category name</label><input id="d_newcat" placeholder="Skin care"></div>
        ${isNew ? '' : `<label class="check"><input type="checkbox" id="d_active" ${p.is_active ? 'checked' : ''}> In use</label><p class="hint">Products not in use are hidden in the app but stay in old closings.</p>`}`,
        isNew ? 'Add product' : 'Save product', async (form) => {
          const v = { name: form.querySelector('#d_name').value.trim(), sku: form.querySelector('#d_sku').value.trim() || null,
            default_price: Number(form.querySelector('#d_price').value) };
          if (!v.name) { alertIn(form, 'Enter the product name.'); return false; }
          if (!(v.default_price >= 0)) { alertIn(form, 'Enter a valid price.'); return false; }
          v.category_id = await categoryId(form);
          if (!isNew) v.is_active = form.querySelector('#d_active').checked;
          const r = isNew ? await sb.from('products').insert({ ...v, company_id: cid() }) : await sb.from('products').update(v).eq('id', p.id);
          if (r.error) throw r.error;
          toast(isNew ? `${v.name} added` : 'Product saved'); viewProducts();
        });
      f.querySelector('#d_cat').onchange = (e) => { f.querySelector('#newCatWrap').hidden = e.target.value !== '__new'; };
    }
    document.getElementById('addP')?.addEventListener('click', () => openP(null));
    document.getElementById('imp')?.addEventListener('click', () => {
      dialog('Import products', `
        <p>In Excel, keep four columns in this order: <b>Name, Code, Category, Price</b>. Select the rows, copy, and paste them below.</p>
        <div class="field"><label for="d_paste">Rows from Excel</label><textarea id="d_paste" rows="8" placeholder="Matte Lipstick 05	LP05	Makeup	2000"></textarea></div>
        <p class="hint">Products whose code or name already exists are skipped. New categories are created.</p>`, 'Import', async (form) => {
        const lines = form.querySelector('#d_paste').value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (!lines.length) { alertIn(form, 'Paste at least one row.'); return false; }
        const rows = lines.map((l) => (l.includes('\t') ? l.split('\t') : l.split(','))).map((c) => c.map((x) => x.trim()));
        if (/^name$/i.test(rows[0][0])) rows.shift();
        const bad = rows.findIndex((r) => !r[0] || !(Number(String(r[3] || '').replace(/,/g, '')) >= 0));
        if (bad >= 0) { alertIn(form, `Row ${bad + 1} needs a name and a price.`); return false; }
        const known = new Set(products.map((p) => p.name.toLowerCase())), knownSku = new Set(products.map((p) => (p.sku || '').toLowerCase()).filter(Boolean));
        const catMap = Object.fromEntries(cats.map((c) => [c.name.toLowerCase(), c.id]));
        let added = 0, skipped = 0;
        const toAdd = [];
        for (const r of rows) {
          const [name, sku, cat, price] = r;
          if (known.has(name.toLowerCase()) || (sku && knownSku.has(sku.toLowerCase()))) { skipped++; continue; }
          let catId = null;
          if (cat) {
            if (!catMap[cat.toLowerCase()]) {
              const { data, error } = await sb.from('product_categories').insert({ company_id: cid(), name: cat }).select('id').single();
              if (error) throw error;
              catMap[cat.toLowerCase()] = data.id;
            }
            catId = catMap[cat.toLowerCase()];
          }
          known.add(name.toLowerCase()); if (sku) knownSku.add(sku.toLowerCase());
          toAdd.push({ company_id: cid(), name, sku: sku || null, category_id: catId, default_price: Number(String(price).replace(/,/g, '')) });
        }
        if (toAdd.length) { const { error } = await sb.from('products').insert(toAdd); if (error) throw error; added = toAdd.length; }
        toast(`${added} added${skipped ? `, ${skipped} skipped` : ''}`); viewProducts();
      }, true);
    });
  }

  // =============================================================
  // ATTENDANCE
  // =============================================================
  async function viewAttendance(tab) {
    tab = tab === 'report' ? 'report' : 'day';
    const tabs = [['day', 'Daily'], ['report', 'Report']];
    page('attendance', 'Attendance', tabs, tab, '', loading);
    let L;
    try { L = await lookups(); } catch (err) { return page('attendance', 'Attendance', tabs, tab, '', errBody(err)); }
    return tab === 'day' ? attDay(L, tabs) : attReport(L, tabs);
  }

  async function attDay(L, tabs, day) {
    day = day || state.attDay || today();
    state.attDay = day;
    const isToday = day === today();
    const [a, v] = await Promise.all([
      sb.from('attendance').select('*').eq('company_id', cid()).eq('attendance_date', day),
      sb.from('store_visits').select('*').eq('company_id', cid()).eq('visit_date', day),
    ]);
    if (a.error) return page('attendance', 'Attendance', tabs, 'day', '', errBody(a.error));
    const rows = a.data || [], visits = v.data || [];
    // selfies are private: get short-lived links for the photos of this day
    const paths = [...new Set(rows.flatMap((r) => [r.check_in_selfie_url, r.check_out_selfie_url]).concat(visits.map((x) => x.check_in_selfie_url))
      .filter((x) => x && !/^https?:/i.test(x)))];
    const signed = {};
    if (paths.length) {
      const { data: urls } = await sb.storage.from('selfies').createSignedUrls(paths, 3600);
      (urls || []).forEach((u) => { if (u.signedUrl) signed[u.path] = u.signedUrl; });
    }
    const thumb = (pth, label) => (pth && signed[pth] ? `<button type="button" class="thumb" data-img="${esc(signed[pth])}" data-cap="${esc(label)}" aria-label="View selfie: ${esc(label)}"><img src="${esc(signed[pth])}" alt="" loading="lazy"></button>` : '');
    const bName = (id) => L.branches.find((b) => b.id === id)?.name || '';
    const edit = can('attendance.edit');
    const emps = L.emps.filter((e) => (e.status === 'active' || rows.some((r) => r.employee_id === e.id)) && (!e.joining_date || e.joining_date <= day));

    const list = emps.map((e) => {
      const r = rows.find((x) => x.employee_id === e.id);
      let st;
      if (r) st = r.status;
      else if (isOff(L, e, day)) st = 'off';
      else if (day < today()) st = 'absent';
      else st = 'notin';
      return { e, r, st, visits: visits.filter((x) => x.employee_id === e.id) };
    });
    const count = (k) => list.filter((x) => x.st === k).length;
    const present = count('present') + count('late') + count('half_day');

    page('attendance', 'Attendance', tabs, 'day', `<input type="date" id="day" value="${day}" max="${today()}" aria-label="Date">`, `
      <section class="stats" aria-label="Summary">
        <div class="stat"><div class="label">Present</div><div class="value">${present}<small> / ${list.filter((x) => x.st !== 'off').length}</small></div><div class="foot">${count('late')} late</div></div>
        <div class="stat"><div class="label">${isToday ? 'Not in yet' : 'Absent'}</div><div class="value">${isToday ? count('notin') + count('absent') : count('absent')}</div></div>
        <div class="stat"><div class="label">On leave</div><div class="value">${count('leave')}</div></div>
        <div class="stat"><div class="label">Day off</div><div class="value">${count('off') + count('holiday')}</div></div>
      </section>
      <div class="filters">
        <select id="fb" aria-label="Filter by branch"><option value="">All branches</option>${L.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>
        <select id="fs" aria-label="Filter by status"><option value="">Everyone</option>${Object.entries(ATT).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select>
        <input id="q" type="search" placeholder="Search employee" aria-label="Search employee">
      </div>
      <section class="panel flush"><div class="table-wrap"><table class="list">
        <thead><tr><th>Employee</th><th>Branch</th><th>Status</th><th>Check in</th><th>Check out</th><th>Worked</th>${edit ? '<th><span class="sr-only">Actions</span></th>' : ''}</tr></thead>
        <tbody id="rows"></tbody></table></div><p class="empty small" id="none" hidden>Nobody matches.</p></section>
      <p class="note">Times are in ${esc(tz())}. A red distance means the check-in was far from the branch pin.</p>`,
      fmtY(day) + (isToday ? ', today' : ''));

    const draw = () => {
      const fb = document.getElementById('fb').value, fs = document.getElementById('fs').value, q = document.getElementById('q').value.trim().toLowerCase();
      const shown = list.filter((x) => (!fb || (x.r?.branch_id || x.e.home_branch_id) === fb) && (!fs || x.st === fs) && (!q || x.e.full_name.toLowerCase().includes(q)));
      document.getElementById('none').hidden = shown.length > 0;
      document.getElementById('rows').innerHTML = shown.map(({ e, r, st, visits: vs }) => {
        const [lbl, cls] = ATT[st] || [st, ''];
        const worked = r?.check_in_at && r?.check_out_at ? hm((new Date(r.check_out_at) - new Date(r.check_in_at)) / 60000) : '';
        const far = (m) => (m != null ? `<span class="hint ${m > 150 ? 'neg' : ''}">${m} m</span>` : '');
        return `<tr>
          <td><b>${esc(e.full_name)}</b> <span class="code">${esc(e.employee_code)}</span>${r?.notes ? `<div class="hint">${esc(r.notes)}</div>` : ''}</td>
          <td>${esc(bName(r?.branch_id || e.home_branch_id))}${vs.length ? `<div class="hint">${vs.length} store visit${vs.length === 1 ? '' : 's'}:</div><div class="visits">${vs.map((x) => `<span>${thumb(x.check_in_selfie_url, `${e.full_name}, visit at ${bName(x.branch_id)} ${clock(x.check_in_at)}`)}${esc(bName(x.branch_id))} ${clock(x.check_in_at)}${x.check_out_at ? `–${clock(x.check_out_at)}` : ''}</span>`).join('')}</div>` : ''}</td>
          <td><span class="pill ${cls}">${lbl}${st === 'late' && r?.late_minutes ? ` ${r.late_minutes} min` : ''}</span>${r?.edited_by ? '<div class="hint">Marked by hand</div>' : ''}</td>
          <td class="num"><div class="tcell">${thumb(r?.check_in_selfie_url, `${e.full_name}, check in ${clock(r?.check_in_at)}`)}<div>${clock(r?.check_in_at)} ${far(r?.check_in_distance_m)}</div></div></td>
          <td class="num"><div class="tcell">${thumb(r?.check_out_selfie_url, `${e.full_name}, check out ${clock(r?.check_out_at)}`)}<div>${clock(r?.check_out_at)} ${far(r?.check_out_distance_m)}</div></div>${r?.early_leave_minutes ? `<div class="hint">left ${r.early_leave_minutes} min early</div>` : ''}</td>
          <td class="num">${worked}</td>
          ${edit ? `<td class="right"><button class="btn btn-ghost btn-sm" data-mark="${e.id}">Mark</button></td>` : ''}</tr>`;
      }).join('');
      document.querySelectorAll('[data-mark]').forEach((b) => b.onclick = () => mark(list.find((x) => x.e.id === b.dataset.mark)));
      document.querySelectorAll('[data-img]').forEach((b) => b.onclick = () => dialog(b.dataset.cap, `<img class="selfie-big" src="${esc(b.dataset.img)}" alt="Selfie">`, '', null));
    };
    ['fb', 'fs', 'q'].forEach((id) => document.getElementById(id).addEventListener('input', draw));
    draw();
    document.getElementById('day').addEventListener('change', (e) => { if (e.target.value) attDay(L, tabs, e.target.value); });

    function mark({ e, r }) {
      if (r?.leave_request_id) return toast('This day comes from an approved leave. Change it on the Leave page.', 'error');
      const opts = ['present', 'late', 'half_day', 'absent', 'leave', 'holiday'];
      dialog(`Mark ${e.full_name}, ${fmt(day)}`, `
        <div class="field"><label for="d_st">Status</label><select id="d_st">${opts.map((k) => `<option value="${k}" ${k === (r?.status || 'present') ? 'selected' : ''}>${ATT[k][0]}</option>`).join('')}</select></div>
        <div class="field"><label for="d_note">Reason</label><input id="d_note" value="${esc(r?.notes || '')}" placeholder="Phone was not working"></div>
        <p class="hint">Marking by hand is saved with your name. Check-in times and location from the app are kept.</p>
        ${r && !r.check_in_at ? '<p><button type="button" class="btn btn-ghost btn-sm danger" id="d_clear">Remove this mark</button></p>' : ''}`, 'Save', async (f) => {
        const status = f.querySelector('#d_st').value, notes = f.querySelector('#d_note').value.trim();
        if (!notes) { alertIn(f, 'Write a reason, so the change is clear later.'); return false; }
        const stamp = { status, notes, edited_by: state.session.user.id, edited_at: new Date().toISOString() };
        const res = r ? await sb.from('attendance').update(stamp).eq('id', r.id)
          : await sb.from('attendance').insert({ ...stamp, company_id: cid(), employee_id: e.id, branch_id: e.home_branch_id, attendance_date: day });
        if (res.error) throw res.error;
        toast('Attendance saved'); attDay(L, tabs, day);
      });
      document.getElementById('d_clear')?.addEventListener('click', async () => {
        const { error } = await sb.from('attendance').delete().eq('id', r.id);
        if (error) return toast(msg(error), 'error');
        document.getElementById('dlg').close(); toast('Mark removed'); attDay(L, tabs, day);
      });
    }
  }

  async function attReport(L, tabs) {
    const from = state.attFrom || monthStart(), to = state.attTo || today();
    page('attendance', 'Attendance', tabs, 'report', '', `
      <div class="filters">
        <label class="inline">From <input type="date" id="from" value="${from}" max="${today()}"></label>
        <label class="inline">To <input type="date" id="to" value="${to}" max="${today()}"></label>
        <select id="fb" aria-label="Filter by branch"><option value="">All branches</option>${L.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>
        <button class="btn btn-ghost" type="button" id="csv">Download for Excel</button>
      </div>
      <div id="rep">${loading}</div>`);
    let data = [];
    const load = async () => {
      const f = document.getElementById('from').value, t = document.getElementById('to').value;
      if (!f || !t || t < f) return (document.getElementById('rep').innerHTML = '<p class="note">Choose a start date before the end date.</p>');
      if ((new Date(t) - new Date(f)) / 864e5 > 92) return (document.getElementById('rep').innerHTML = '<p class="note">Choose at most 3 months at a time.</p>');
      state.attFrom = f; state.attTo = t;
      const { data: rows, error } = await sb.from('attendance').select('employee_id, branch_id, attendance_date, status, late_minutes, check_in_at, check_out_at, early_leave_minutes').eq('company_id', cid()).gte('attendance_date', f).lte('attendance_date', t);
      if (error) return (document.getElementById('rep').innerHTML = errBody(error));
      const days = []; for (let d = f; d <= t; d = addDays(d, 1)) days.push(d);
      const fb = document.getElementById('fb').value;
      data = L.emps.filter((e) => e.status === 'active' || rows.some((r) => r.employee_id === e.id)).filter((e) => !fb || e.home_branch_id === fb).map((e) => {
        const mine = rows.filter((r) => r.employee_id === e.id);
        const s = { e, working: 0, present: 0, late: 0, lateMin: 0, absent: 0, leave: 0, half: 0, early: 0, worked: 0 };
        for (const d of days) {
          if (e.joining_date && d < e.joining_date) continue;
          const off = isOff(L, e, d); if (!off) s.working++;
          const r = mine.find((x) => x.attendance_date === d);
          if (!r) { if (!off && d < today()) s.absent++; continue; }
          if (r.status === 'present' || r.status === 'late') s.present++;
          if (r.status === 'late') { s.late++; s.lateMin += r.late_minutes || 0; }
          if (r.status === 'absent') s.absent++;
          if (r.status === 'leave') s.leave++;
          if (r.status === 'half_day') { s.half++; s.present += 0.5; }
          if (r.early_leave_minutes) s.early++;
          if (r.check_in_at && r.check_out_at) s.worked += (new Date(r.check_out_at) - new Date(r.check_in_at)) / 60000;
        }
        return s;
      });
      document.getElementById('rep').innerHTML = data.length ? `
        <section class="panel flush"><div class="table-wrap"><table class="list">
          <thead><tr><th>Employee</th><th class="r">Working days</th><th class="r">Present</th><th class="r">Late</th><th class="r">Absent</th><th class="r">Leave</th><th class="r">Left early</th><th class="r">Hours worked</th></tr></thead>
          <tbody>${data.map((s) => `<tr><td><b>${esc(s.e.full_name)}</b> <span class="code">${esc(s.e.employee_code)}</span></td>
            <td class="num r">${s.working}</td><td class="num r">${s.present}</td><td class="num r">${s.late}${s.lateMin ? `<div class="hint">${s.lateMin} min</div>` : ''}</td>
            <td class="num r ${s.absent ? 'neg' : ''}">${s.absent}</td><td class="num r">${s.leave + s.half * 0.5}</td><td class="num r">${s.early}</td><td class="num r">${hm(s.worked)}</td></tr>`).join('')}</tbody>
        </table></div></section><p class="note">${fmtY(f)} to ${fmtY(t)}. Days off and holidays are not working days.</p>` : '<section class="panel"><div class="empty"><p>No employees to show.</p></div></section>';
    };
    ['from', 'to', 'fb'].forEach((id) => document.getElementById(id).addEventListener('change', load));
    document.getElementById('csv').onclick = () => csv(`attendance-${state.attFrom}-to-${state.attTo}.csv`,
      ['Code', 'Name', 'Working days', 'Present', 'Late days', 'Late minutes', 'Absent', 'Leave', 'Left early', 'Hours worked'],
      data.map((s) => [s.e.employee_code, s.e.full_name, s.working, s.present, s.late, s.lateMin, s.absent, s.leave + s.half * 0.5, s.early, (s.worked / 60).toFixed(1)]));
    load();
  }

  // =============================================================
  // SALES CLOSING
  // =============================================================
  async function viewClosings(tab) {
    tab = tab === 'corrections' ? 'corrections' : 'report';
    const tabs = [['report', 'Closings'], ['corrections', 'Corrections']];
    page('closings', 'Sales closing', tabs, tab, '', loading);
    let L, products;
    try {
      L = await lookups();
      const p = await sb.from('products').select('id, name, default_price, is_active').eq('company_id', cid()).order('name');
      products = p.data || [];
    } catch (err) { return page('closings', 'Sales closing', tabs, tab, '', errBody(err)); }
    return tab === 'report' ? clReport(L, tabs, products) : clCorrections(L, tabs, products);
  }

  async function clReport(L, tabs, products) {
    const from = state.clFrom || monthStart(), to = state.clTo || today();
    const emp = (id) => L.emps.find((e) => e.id === id) || {};
    const bName = (id) => L.branches.find((b) => b.id === id)?.name || '';
    page('closings', 'Sales closing', tabs, 'report', '', `
      <div class="filters">
        <label class="inline">From <input type="date" id="from" value="${from}" max="${today()}"></label>
        <label class="inline">To <input type="date" id="to" value="${to}" max="${today()}"></label>
        <select id="fb" aria-label="Filter by branch"><option value="">All branches</option>${L.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>
        <select id="fe" aria-label="Filter by employee"><option value="">All employees</option>${L.emps.map((e) => `<option value="${e.id}">${esc(e.full_name)}</option>`).join('')}</select>
        <select id="ft" aria-label="Filter by type"><option value="">Both types</option><option value="product_wise">Product-wise</option><option value="simple_amount">Simple amount</option></select>
        <button class="btn btn-ghost" type="button" id="csv">Download for Excel</button>
      </div>
      <div id="rep">${loading}</div>`);
    let list = [], items = [];
    const load = async () => {
      const f = document.getElementById('from').value, t = document.getElementById('to').value;
      if (!f || !t || t < f) return (document.getElementById('rep').innerHTML = '<p class="note">Choose a start date before the end date.</p>');
      state.clFrom = f; state.clTo = t;
      let q = sb.from('daily_closings').select('*').eq('company_id', cid()).gte('closing_date', f).lte('closing_date', t);
      const fb = document.getElementById('fb').value, fe = document.getElementById('fe').value, ft = document.getElementById('ft').value;
      if (fb) q = q.eq('branch_id', fb); if (fe) q = q.eq('employee_id', fe); if (ft) q = q.eq('closing_type', ft);
      const { data, error } = await q.order('closing_date', { ascending: false }).limit(2000);
      if (error) return (document.getElementById('rep').innerHTML = errBody(error));
      list = data || [];
      const ids = list.filter((c) => c.closing_type === 'product_wise').map((c) => c.id);
      items = [];
      for (let i = 0; i < ids.length; i += 200) {
        const r = await sb.from('closing_items').select('closing_id, product_id, product_name_snapshot, quantity, return_quantity, line_total').in('closing_id', ids.slice(i, i + 200));
        items = items.concat(r.data || []);
      }
      const total = list.reduce((s, c) => s + Number(c.total_amount), 0);
      const byBranch = {}; list.forEach((c) => { const k = c.branch_id || '-'; byBranch[k] = byBranch[k] || { n: 0, t: 0 }; byBranch[k].n++; byBranch[k].t += Number(c.total_amount); });
      const byProd = {}; items.forEach((i) => { const k = i.product_name_snapshot; byProd[k] = byProd[k] || { q: 0, t: 0 }; byProd[k].q += Number(i.quantity) - Number(i.return_quantity); byProd[k].t += Number(i.line_total); });
      const prodRows = Object.entries(byProd).sort((a, b) => b[1].t - a[1].t);
      const pending = list.filter((c) => c.status === 'correction_requested').length;

      document.getElementById('rep').innerHTML = `
        <section class="stats three" aria-label="Totals">
          <div class="stat"><div class="label">Total sales</div><div class="value">Rs ${money(total)}</div><div class="foot">${fmt(f)} to ${fmt(t)}</div></div>
          <div class="stat"><div class="label">Closings</div><div class="value">${list.length}</div><div class="foot">${list.filter((c) => c.closing_type === 'product_wise').length} product-wise</div></div>
          <div class="stat"><div class="label">Corrections waiting</div><div class="value">${pending}</div>${pending ? '<div class="foot"><a href="#/closings?tab=corrections">Review</a></div>' : ''}</div>
        </section>
        ${list.length ? `
        <div class="two-col">
          <section class="panel"><h2>By branch</h2><table class="list compact"><tbody>${Object.entries(byBranch).sort((a, b) => b[1].t - a[1].t).map(([k, v]) => `<tr><td>${esc(bName(k) || 'No branch')}</td><td class="num r">${v.n}</td><td class="num r"><b>${money(v.t)}</b></td></tr>`).join('')}</tbody></table></section>
          <section class="panel"><h2>Top products</h2>${prodRows.length ? `<table class="list compact"><tbody>${prodRows.slice(0, 10).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num r">${v.q} sold</td><td class="num r"><b>${money(v.t)}</b></td></tr>`).join('')}</tbody></table>` : '<p class="hint">No product-wise closings in this period.</p>'}</section>
        </div>
        <section class="panel flush"><div class="table-wrap"><table class="list">
          <thead><tr><th>Date</th><th>Employee</th><th>Branch</th><th>Type</th><th class="r">Amount (Rs)</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>${list.map((c) => `<tr>
            <td class="num">${fmt(c.closing_date)}</td><td><b>${esc(emp(c.employee_id).full_name || '')}</b></td><td>${esc(bName(c.branch_id))}</td>
            <td>${c.closing_type === 'product_wise' ? `Product-wise <span class="hint">(${items.filter((i) => i.closing_id === c.id).length})</span>` : 'Simple amount'}</td>
            <td class="num r"><b>${money(c.total_amount)}</b></td>
            <td><span class="pill ${c.status === 'correction_requested' ? 'pill-trial' : c.status === 'corrected' ? 'pill-neutral' : 'pill-active'}">${CL_STATUS[c.status] || c.status}</span></td>
            <td class="right"><button class="btn btn-ghost btn-sm" data-cl="${c.id}">View</button></td></tr>`).join('')}</tbody>
        </table></div></section>` : '<section class="panel"><div class="empty"><h2>No closings</h2><p>Closings that employees submit from the app show up here.</p></div></section>'}`;
      document.querySelectorAll('[data-cl]').forEach((b) => b.onclick = () => clDetail(list.find((c) => c.id === b.dataset.cl), L, products, () => load()));
    };
    ['from', 'to', 'fb', 'fe', 'ft'].forEach((id) => document.getElementById(id).addEventListener('change', load));
    document.getElementById('csv').onclick = () => csv(`closings-${state.clFrom}-to-${state.clTo}.csv`,
      ['Date', 'Code', 'Employee', 'Branch', 'Type', 'Gross', 'Discount', 'Returns', 'Total', 'Status'],
      list.map((c) => [c.closing_date, emp(c.employee_id).employee_code, emp(c.employee_id).full_name, bName(c.branch_id), c.closing_type === 'product_wise' ? 'Product-wise' : 'Simple amount',
        c.gross_amount, c.discount_amount, c.return_amount, c.total_amount, CL_STATUS[c.status] || c.status]));
    load();
  }

  async function clDetail(c, L, products, reload) {
    const e = L.emps.find((x) => x.id === c.employee_id) || {};
    const [it, cr] = await Promise.all([
      sb.from('closing_items').select('*').eq('closing_id', c.id).order('created_at'),
      sb.from('closing_corrections').select('*').eq('closing_id', c.id).order('created_at', { ascending: false }),
    ]);
    const items = it.data || [], corr = cr.data || [];
    const canFix = can('closings.correct') && c.employee_id !== state.employeeId;
    const f = dialog(`${e.full_name || ''}, ${fmtY(c.closing_date)}`, `
      ${c.closing_type === 'product_wise' ? `<table class="list compact"><thead><tr><th>Product</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Disc.</th><th class="r">Ret.</th><th class="r">Total</th></tr></thead>
        <tbody>${items.map((i) => `<tr><td>${esc(i.product_name_snapshot)}</td><td class="num r">${Number(i.quantity)}</td><td class="num r">${money(i.unit_price)}</td><td class="num r">${money(i.discount_amount)}</td><td class="num r">${Number(i.return_quantity)}</td><td class="num r">${money(i.line_total)}</td></tr>`).join('')}</tbody></table>` : ''}
      <table class="slip"><tbody>
        ${c.closing_type === 'product_wise' ? `<tr><td>Gross</td><td class="num r">${money(c.gross_amount)}</td></tr><tr><td>Discount</td><td class="num r">−${money(c.discount_amount)}</td></tr><tr><td>Returns</td><td class="num r">−${money(c.return_amount)}</td></tr>` : ''}
        <tr class="tot"><td>Closing total</td><td class="num r">Rs ${money(c.total_amount)}</td></tr></tbody></table>
      ${c.notes ? `<p class="hint">Note: ${esc(c.notes)}</p>` : ''}
      ${corr.length ? `<h3 class="mini">Changes</h3><ul class="duties">${corr.map((x) => `<li><div><b>${x.kind === 'direct' ? 'Corrected by manager' : 'Employee asked'}: ${esc(x.reason)}</b>
        <span class="hint">${fmtY(x.created_at.slice(0, 10))}, ${x.status}${x.old_values ? `, was Rs ${money(x.old_values.total_amount)}` : ''}${x.review_note ? `, ${esc(x.review_note)}` : ''}</span></div></li>`).join('')}</ul>` : ''}
      ${canFix ? '<p><button type="button" class="btn btn-ghost btn-sm" id="d_fix">Correct this closing</button></p>' : ''}`, '', null, true);
    f.querySelector('#d_fix')?.addEventListener('click', () => clEdit(c, items, products, reload));
  }

  function itemEditor(lines, products) {
    const opts = (sel) => products.filter((p) => p.is_active || p.id === sel).map((p) => `<option value="${p.id}" data-price="${p.default_price}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    const row = (l) => `<tr><td><select class="i_p" aria-label="Product">${opts(l.product_id)}</select></td>
      <td><input class="i_q" type="number" min="1" step="1" value="${Number(l.quantity || 1)}" aria-label="Quantity"></td>
      <td><input class="i_u" type="number" min="0" value="${Number(l.unit_price ?? products.find((p) => p.id === l.product_id)?.default_price ?? 0)}" aria-label="Price"></td>
      <td><input class="i_d" type="number" min="0" value="${Number(l.discount_amount || 0)}" aria-label="Discount"></td>
      <td><input class="i_r" type="number" min="0" value="${Number(l.return_quantity || 0)}" aria-label="Returned"></td>
      <td><button type="button" class="btn btn-ghost btn-sm i_x" aria-label="Remove line">×</button></td></tr>`;
    return { html: `<div class="table-wrap"><table class="list compact edit-lines"><thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Disc.</th><th>Ret.</th><th></th></tr></thead>
      <tbody id="lines">${lines.map(row).join('')}</tbody></table></div><p><button type="button" class="btn btn-ghost btn-sm" id="addLine">Add product</button> <span class="hint" id="lineTotal"></span></p>`, row };
  }

  function clEdit(c, items, products, reload) {
    const ed = itemEditor(items.length ? items : [{ product_id: products[0]?.id }], products);
    const f = dialog('Correct closing', `
      ${c.closing_type === 'simple_amount'
        ? `<div class="field"><label for="d_amt">Correct amount (Rs)</label><input id="d_amt" type="number" min="0" value="${Number(c.total_amount)}"></div>`
        : ed.html}
      <div class="field"><label for="d_reason">Reason</label><input id="d_reason" placeholder="Wrong quantity entered"></div>
      <p class="hint">The old values are kept in the history.</p>`, 'Save correction', async (form) => {
      const reason = form.querySelector('#d_reason').value.trim();
      if (!reason) { alertIn(form, 'Write the reason for the correction.'); return false; }
      let changes;
      if (c.closing_type === 'simple_amount') {
        const amt = Number(form.querySelector('#d_amt').value);
        if (!(amt >= 0)) { alertIn(form, 'Enter a valid amount.'); return false; }
        changes = { total_amount: amt };
      } else {
        const lines = [...form.querySelectorAll('#lines tr')].map((tr) => ({ product_id: tr.querySelector('.i_p').value, quantity: Number(tr.querySelector('.i_q').value),
          unit_price: Number(tr.querySelector('.i_u').value), discount: Number(tr.querySelector('.i_d').value || 0), return_quantity: Number(tr.querySelector('.i_r').value || 0) }));
        if (!lines.length) { alertIn(form, 'Add at least one product.'); return false; }
        if (lines.some((l) => !(l.quantity > 0))) { alertIn(form, 'Every quantity must be more than 0.'); return false; }
        changes = { items: lines };
      }
      const { error } = await sb.rpc('correct_closing', { p_closing: c.id, p_changes: changes, p_reason: reason });
      if (error) throw error;
      toast('Closing corrected'); reload();
    }, true);
    if (c.closing_type === 'product_wise') {
      const tb = f.querySelector('#lines');
      const total = () => {
        const t = [...tb.querySelectorAll('tr')].reduce((s, tr) => s + (Number(tr.querySelector('.i_q').value) - Number(tr.querySelector('.i_r').value || 0)) * Number(tr.querySelector('.i_u').value) - Number(tr.querySelector('.i_d').value || 0), 0);
        f.querySelector('#lineTotal').textContent = `New total: Rs ${money(t)}`;
      };
      const bind = () => {
        tb.querySelectorAll('.i_x').forEach((b) => b.onclick = () => { b.closest('tr').remove(); total(); });
        tb.querySelectorAll('.i_p').forEach((s) => s.onchange = () => { s.closest('tr').querySelector('.i_u').value = s.selectedOptions[0].dataset.price; total(); });
        tb.querySelectorAll('input').forEach((i) => i.oninput = total);
      };
      f.querySelector('#addLine').onclick = () => { tb.insertAdjacentHTML('beforeend', ed.row({ product_id: products.find((p) => p.is_active)?.id })); bind(); total(); };
      bind(); total();
    }
  }

  async function clCorrections(L, tabs, products) {
    const { data, error } = await sb.from('closing_corrections').select('*').eq('company_id', cid()).order('created_at', { ascending: false }).limit(300);
    if (error) return page('closings', 'Sales closing', tabs, 'corrections', '', errBody(error));
    const reqs = (data || []).filter((x) => x.kind !== 'direct');
    const ids = [...new Set(reqs.map((r) => r.closing_id))];
    const cl = ids.length ? (await sb.from('daily_closings').select('*').in('id', ids)).data || [] : [];
    const emp = (id) => L.emps.find((e) => e.id === id) || {};
    const pName = (id) => products.find((p) => p.id === id)?.name || 'Product';
    const describe = (ch) => (ch.items ? ch.items.map((i) => `${pName(i.product_id)} × ${i.quantity}`).join(', ') : `Rs ${money(ch.total_amount)}`);
    const canReview = can('closings.correct');
    const pend = reqs.filter((r) => r.status === 'pending');

    page('closings', 'Sales closing', tabs, 'corrections', '', reqs.length ? `
      <p class="sub">${pend.length} waiting. Employees ask for a correction from the app when their closing was wrong.</p>
      <section class="panel flush"><div class="table-wrap"><table class="list">
        <thead><tr><th>Closing</th><th>Was</th><th>Asked for</th><th>Reason</th><th>Status</th>${canReview ? '<th><span class="sr-only">Actions</span></th>' : ''}</tr></thead>
        <tbody>${reqs.map((r) => { const c = cl.find((x) => x.id === r.closing_id) || {}; return `<tr>
          <td><b>${esc(emp(c.employee_id).full_name || '')}</b><div class="hint">${c.closing_date ? fmtY(c.closing_date) : ''}</div></td>
          <td class="num">Rs ${money(r.old_values?.total_amount ?? c.total_amount)}</td>
          <td>${esc(describe(r.proposed_changes || {}))}</td>
          <td>${esc(r.reason)}${r.review_note ? `<div class="hint">Reply: ${esc(r.review_note)}</div>` : ''}</td>
          <td><span class="pill ${r.status === 'pending' ? 'pill-trial' : r.status === 'approved' ? 'pill-active' : 'pill-expired'}">${r.status === 'pending' ? 'Waiting' : r.status === 'approved' ? 'Approved' : 'Rejected'}</span></td>
          ${canReview ? `<td class="right nowrap">${r.status === 'pending' ? `<button class="btn btn-sm" data-ok="${r.id}">Approve</button> <button class="btn btn-ghost btn-sm" data-no="${r.id}">Reject</button>` : ''}</td>` : ''}</tr>`; }).join('')}</tbody>
      </table></div></section>` : '<section class="panel"><div class="empty"><h2>No correction requests</h2><p>When an employee asks to fix a closing from the app, it shows up here for approval.</p></div></section>');

    const review = (id, approve) => dialog(approve ? 'Approve correction' : 'Reject correction', `
      <div class="field"><label for="d_note">Note ${approve ? '<span class="opt">optional</span>' : ''}</label><input id="d_note" placeholder="${approve ? '' : 'Why it is rejected'}"></div>
      ${approve ? '<p class="hint">The closing changes to the values the employee asked for. Prices follow your price rule.</p>' : ''}`, approve ? 'Approve' : 'Reject', async (f) => {
      const note = f.querySelector('#d_note').value.trim() || null;
      if (!approve && !note) { alertIn(f, 'Write a short reason for the employee.'); return false; }
      const { error: er } = await sb.rpc('review_closing_correction', { p_correction: id, p_approve: approve, p_note: note });
      if (er) throw er;
      toast(approve ? 'Correction approved' : 'Correction rejected'); viewClosings('corrections');
    });
    document.querySelectorAll('[data-ok]').forEach((b) => b.onclick = () => review(b.dataset.ok, true));
    document.querySelectorAll('[data-no]').forEach((b) => b.onclick = () => review(b.dataset.no, false));
  }

  return { viewProducts, viewAttendance, viewClosings };
}
