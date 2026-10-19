// =============================================================
//  Veltrio Staff app (Part 8)
//  Check in / out with GPS and selfie, store visits, daily closing,
//  closing corrections, leave, payslips. Installable web app.
// =============================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storageKey: 'veltrio-staff' } });
const app = document.getElementById('app');
const S = { session: null, me: null, profile: null, settings: {}, branches: [], duties: [], products: [] };

// ---------------------------------------------------------------
// helpers
// ---------------------------------------------------------------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));
const nd = (n) => (Number(n) % 1 ? Number(n).toFixed(1) : String(Number(n || 0)));
const tz = () => S.settings.timezone || 'Asia/Karachi';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: tz() }).format(new Date());
const clock = (ts) => (ts ? new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz() }).format(new Date(ts)) : '–');
const dayLabel = (d, opt = { weekday: 'short', day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat('en-GB', opt).format(new Date(d + 'T00:00:00'));
const route = () => (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
const STAFF_DOMAIN = 'staff.veltrio.app';
const slug = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const loginEmail = (v) => { v = String(v || '').trim(); if (v.includes('@')) return v; const i = v.indexOf('-'); return i < 1 ? v : `${slug(v.slice(i + 1))}.${slug(v.slice(0, i))}@${STAFF_DOMAIN}`; };

function deviceId() {
  let id = null;
  try { id = localStorage.getItem('veltrio_device'); } catch { /* storage blocked */ }
  if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()); try { localStorage.setItem('veltrio_device', id); } catch { /* ignore */ } }
  return id;
}
function errText(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/Invalid login credentials/i.test(m)) return 'Staff ID or password is wrong.';
  if (/banned/i.test(m)) return 'Your login is turned off. Please contact HR.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No internet. Check your connection and try again.';
  if (/JWT|session/i.test(m)) return 'Please log in again.';
  return m;
}
function toast(t, bad) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.className = 'toast' + (bad ? ' bad' : ''); el.textContent = t;
  clearTimeout(el._h); el._h = setTimeout(() => el.classList.add('hide'), 3500);
}
function alertIn(el, text, kind = 'error') {
  let box = el.querySelector(':scope > .alert');
  if (!box) { box = document.createElement('div'); el.prepend(box); }
  box.className = 'alert ' + kind; box.setAttribute('role', kind === 'error' ? 'alert' : 'status'); box.textContent = text;
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function busy(btn, on, label) { btn.disabled = on; if (on) { btn.dataset.l = btn.textContent; btn.textContent = label; } else if (btn.dataset.l) btn.textContent = btn.dataset.l; }
function distance(a, b, c, d) {
  const R = 6371000, r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
const LOGO = `<svg viewBox="0 0 32 32" class="mark" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#13737B"/><path d="M9 10l7 13 7-13" fill="none" stroke="#F2B84B" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  closing: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4"/>',
  leave: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  me: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

function frame(tab, inner) {
  app.innerHTML = `<main class="screen">${inner}</main>
    <nav class="nav" aria-label="Main">${[['home', 'Home'], ['closing', 'Closing'], ['leave', 'Leave'], ['me', 'Me']].map(([k, l]) =>
      `<a href="#/${k}" class="${k === tab ? 'on' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${icon(k)}${l}</a>`).join('')}</nav>`;
}

// ---------------------------------------------------------------
// login
// ---------------------------------------------------------------
function viewLogin(note) {
  app.innerHTML = `<div class="login">
    <div class="login-top">${LOGO}<h1>Veltrio Staff</h1><p>Check in, submit your closing and see your leave and pay.</p></div>
    <form id="f" novalidate>
      ${note ? `<div class="alert info" role="status">${esc(note)}</div>` : ''}
      <div class="field"><label for="sid">Staff ID</label><input id="sid" autocomplete="username" autocapitalize="characters" placeholder="BV7K2-E01"></div>
      <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password"></div>
      <button class="btn" type="submit">Log in</button>
      <p class="hint" style="margin-top:16px">Your Staff ID and password come from your HR. Forgot your password? Ask HR to set a new one.</p>
    </form></div>`;
  const f = document.getElementById('f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const sid = f.sid.value.trim(), pw = f.pw.value;
    if (!sid || !pw) return alertIn(f, 'Enter your Staff ID and password.');
    const btn = f.querySelector('button'); busy(btn, true, 'Logging in…');
    const { error } = await sb.auth.signInWithPassword({ email: loginEmail(sid), password: pw });
    busy(btn, false);
    if (error) return alertIn(f, errText(error));
    await boot();
  };
}

// ---------------------------------------------------------------
// data
// ---------------------------------------------------------------
async function loadBase() {
  const uid = S.session.user.id;
  const [p, e] = await Promise.all([
    sb.from('users_profile').select('id, role, full_name, company_id, is_active').eq('id', uid).maybeSingle(),
    sb.from('employees').select('*').eq('user_id', uid).maybeSingle(),
  ]);
  S.profile = p.data; S.me = e.data;
  if (!S.me) return;
  const [s, b, d, pr] = await Promise.all([
    sb.from('company_settings').select('*').eq('company_id', S.me.company_id).maybeSingle(),
    sb.from('branches').select('id, name, latitude, longitude, geofence_radius_m, is_active').eq('company_id', S.me.company_id),
    sb.from('employee_branch_assignments').select('branch_id, start_date, end_date').eq('employee_id', S.me.id),
    sb.from('products').select('id, name, sku, default_price').eq('company_id', S.me.company_id).eq('is_active', true).order('name'),
  ]);
  S.settings = s.data || {}; S.branches = b.data || []; S.duties = d.data || []; S.products = pr.data || [];
}

async function loadToday() {
  const t = today();
  const since = new Date(Date.now() - 20 * 3600e3).toISOString();
  const [att, open, vis, cl] = await Promise.all([
    sb.from('attendance').select('*').eq('employee_id', S.me.id).eq('attendance_date', t).maybeSingle(),
    sb.from('attendance').select('*').eq('employee_id', S.me.id).is('check_out_at', null).not('check_in_at', 'is', null).gte('check_in_at', since).order('check_in_at', { ascending: false }).limit(1),
    sb.from('store_visits').select('*').eq('employee_id', S.me.id).is('check_out_at', null).order('check_in_at', { ascending: false }).limit(1),
    sb.from('daily_closings').select('*').eq('employee_id', S.me.id).eq('closing_date', t).maybeSingle(),
  ]);
  S.att = att.data || null;
  S.open = (open.data || [])[0] || null;
  S.visit = (vis.data || [])[0] || null;
  S.closing = cl.data || null;
}

// branches this employee may use today, nearest first
function allowedBranches(lat, lng) {
  const t = today();
  const ok = S.branches.filter((b) => b.is_active && b.latitude != null && b.longitude != null && (
    S.me.work_mode !== 'fixed' || b.id === S.me.home_branch_id ||
    S.duties.some((d) => d.branch_id === b.id && d.start_date <= t && (!d.end_date || d.end_date >= t))));
  return ok.map((b) => ({ ...b, dist: distance(lat, lng, Number(b.latitude), Number(b.longitude)), radius: b.geofence_radius_m || S.settings.default_geofence_radius_m || 100 }))
    .sort((a, b) => a.dist - b.dist);
}
const branchName = (id) => S.branches.find((b) => b.id === id)?.name || '';

// ---------------------------------------------------------------
// HOME
// ---------------------------------------------------------------
async function viewHome() {
  frame('home', '<div class="boot">Loading…</div>');
  try { await loadToday(); } catch (e) { return frame('home', `<div class="alert error">${esc(errText(e))}</div>`); }
  const first = S.me.full_name.split(' ')[0];
  const a = S.open || S.att;
  const field = S.me.work_mode === 'field';
  let state, where = '', btns = '';
  if (!a || !a.check_in_at) {
    if (a && ['leave', 'holiday', 'absent', 'half_day'].includes(a.status) && !a.check_in_at) {
      state = a.status === 'leave' ? 'On leave today' : a.status === 'holiday' ? 'Holiday' : a.status === 'half_day' ? 'Half day leave' : 'Marked absent';
      btns = a.status === 'half_day' ? '<button class="btn" id="in">Check in</button>' : '';
    } else {
      state = 'Not checked in'; btns = '<button class="btn" id="in">Check in</button>';
    }
  } else if (!a.check_out_at) {
    state = 'Checked in';
    where = esc(branchName(a.branch_id));
    btns = (field ? (S.visit ? '<button class="btn" id="vend">Finish visit</button>' : '<button class="btn" id="vstart">Start store visit</button>') : '') +
      `<button class="btn ${field ? 'ghost' : ''}" id="out" style="margin-top:10px">Check out</button>`;
  } else {
    state = 'Day finished'; where = esc(branchName(a.check_out_branch_id || a.branch_id));
  }
  const late = a?.status === 'late' && a.late_minutes ? `<span class="tag late">${a.late_minutes} min late</span>` : '';

  frame('home', `
    <div class="head"><div><h1>Hello, ${esc(first)}</h1><p>${dayLabel(today(), { weekday: 'long', day: 'numeric', month: 'long' })}</p></div></div>
    <section class="today" aria-label="Today">
      <div class="when">Today</div>
      <div class="state">${state} ${late}</div>
      ${where ? `<div class="where">${where}</div>` : ''}
      ${a?.check_in_at ? `<div class="times"><div><span>In</span><b>${clock(a.check_in_at)}</b></div><div><span>Out</span><b>${clock(a.check_out_at)}</b></div></div>` : '<div style="height:16px"></div>'}
      ${S.visit ? `<p class="where" style="margin:0 0 12px">Visiting <b>${esc(branchName(S.visit.branch_id))}</b> since ${clock(S.visit.check_in_at)}</p>` : ''}
      ${btns}
    </section>
    <section class="card">
      <h2>Today's closing</h2>
      ${S.closing ? `<p>Submitted: <b class="amount">Rs ${money(S.closing.total_amount)}</b> ${S.closing.status === 'correction_requested' ? '<span class="tag warn">Correction asked</span>' : ''}</p>`
        : '<p>Submit your sales at the end of the day.</p><a class="btn ghost" href="#/closing" style="margin-top:12px">Submit closing</a>'}
    </section>
    ${S.me.work_mode !== 'fixed' ? `<p class="hint">${field ? 'You are field staff: start a visit at each store you go to.' : 'You can check in at any branch.'}</p>` : ''}`);

  document.getElementById('in')?.addEventListener('click', () => attendanceFlow('in'));
  document.getElementById('out')?.addEventListener('click', () => attendanceFlow('out'));
  document.getElementById('vstart')?.addEventListener('click', () => attendanceFlow('visit'));
  document.getElementById('vend')?.addEventListener('click', () => visitEnd());
}

// ---------------------------------------------------------------
// check in / out / visit: location -> selfie -> send
// ---------------------------------------------------------------
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This phone cannot share location.'));
    navigator.geolocation.getCurrentPosition((p) => resolve(p.coords),
      (e) => reject(new Error(e.code === 1 ? 'Location permission is blocked. Allow location for this app in your phone settings.' : 'Could not find your location. Go outside or near a window and try again.')),
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 });
  });
}

async function attendanceFlow(kind) {
  const title = kind === 'in' ? 'Check in' : kind === 'out' ? 'Check out' : 'Start store visit';
  const needSelfie = S.settings.selfie_required !== false;
  const sheet = document.createElement('div');
  sheet.className = 'sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', title);
  sheet.innerHTML = `<div class="inner">
    <div class="sheet-head"><h2>${title}</h2><button class="close" aria-label="Close">×</button></div>
    <div class="steps">
      <div class="step" id="s1"><span class="dot">1</span><div class="txt"><b>Location</b><span>Finding where you are…</span></div></div>
      ${needSelfie ? '<div class="step" id="s2"><span class="dot">2</span><div class="txt"><b>Selfie</b><span>Take a clear photo of your face</span></div></div>' : ''}
    </div>
    <div id="area"></div></div>`;
  document.body.appendChild(sheet);
  let stream = null;
  const close = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); sheet.remove(); };
  sheet.querySelector('.close').onclick = close;
  const area = sheet.querySelector('#area');
  const step = (id, cls, text) => { const s = sheet.querySelector('#' + id); if (!s) return; s.className = 'step ' + cls; s.querySelector('.dot').textContent = cls === 'done' ? '✓' : cls === 'bad' ? '!' : s.querySelector('.dot').textContent; if (text) s.querySelector('span:last-child').textContent = text; };

  // 1. location
  let pos, target;
  const locate = async () => {
    area.innerHTML = '';
    step('s1', '', 'Finding where you are…');
    try { pos = await getPosition(); } catch (e) { step('s1', 'bad', e.message); area.innerHTML = '<button class="btn" id="again">Try again</button>'; area.querySelector('#again').onclick = async () => { if (await locate()) next(); }; return false; }
    if (kind === 'out' && S.me.work_mode !== 'field') {
      const b = S.branches.find((x) => x.id === (S.open || S.att).branch_id);
      target = b ? { ...b, dist: distance(pos.latitude, pos.longitude, Number(b.latitude), Number(b.longitude)), radius: b.geofence_radius_m || S.settings.default_geofence_radius_m || 100 } : null;
    } else {
      target = allowedBranches(pos.latitude, pos.longitude)[0];
    }
    if (!target) { step('s1', 'bad', 'No branch is set up for you. Please contact HR.'); return false; }
    const acc = Math.round(pos.accuracy);
    if (target.dist > target.radius) {
      step('s1', 'bad', `You are ${target.dist} m from ${target.name}. Allowed: ${target.radius} m.`);
      area.innerHTML = `<p class="hint">GPS accuracy is about ${acc} m. Move closer to the shop entrance and try again.</p><button class="btn" id="again">Try again</button>`;
      area.querySelector('#again').onclick = async () => { if (await locate()) next(); };
      return false;
    }
    step('s1', 'done', `${target.name}, ${target.dist} m away`);
    return true;
  };

  // 2. selfie
  let photo = null;
  const takeSelfie = () => new Promise(async (resolve) => {
    step('s2', '', 'Look at the camera and tap Take photo');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } }, audio: false });
    } catch {
      step('s2', 'bad', 'Camera is blocked. Allow the camera for this app in your phone settings.');
      area.innerHTML = '<button class="btn" id="again">Try again</button>';
      area.querySelector('#again').onclick = async () => resolve(await takeSelfie());
      return;
    }
    area.innerHTML = '<div class="cam"><video playsinline autoplay muted></video><div class="ring"></div></div><button class="btn" id="snap">Take photo</button>';
    const video = area.querySelector('video'); video.srcObject = stream;
    area.querySelector('#snap').onclick = () => {
      const w = 480, h = Math.round((video.videoHeight / video.videoWidth) * w) || 640;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.translate(w, 0); g.scale(-1, 1); g.drawImage(video, 0, 0, w, h);
      stream.getTracks().forEach((t) => t.stop()); stream = null;
      c.toBlob((blob) => {
        photo = blob;
        area.innerHTML = `<div class="cam"><img alt="Your selfie" src="${URL.createObjectURL(blob)}"></div><div class="row"><button class="btn ghost" id="retake">Retake</button><button class="btn" id="use">${title}</button></div>`;
        area.querySelector('#retake').onclick = async () => resolve(await takeSelfie());
        area.querySelector('#use').onclick = () => { step('s2', 'done', 'Photo ready'); resolve(true); };
      }, 'image/jpeg', 0.6);
    };
  });

  const send = async () => {
    area.innerHTML = '<button class="btn" disabled>Saving…</button>';
    try {
      let path = null;
      if (photo) {
        const kindName = kind === 'visit' ? 'visit' : kind;
        path = `${S.me.company_id}/${S.me.id}/${today()}/${kindName}-${Date.now()}.jpg`;
        const up = await sb.storage.from('selfies').upload(path, photo, { contentType: 'image/jpeg', upsert: false });
        if (up.error) throw new Error('Could not save the selfie. Check your internet and try again.');
      }
      const fn = kind === 'in' ? 'check_in' : kind === 'out' ? 'check_out' : 'visit_start';
      const { data, error } = await sb.rpc(fn, { p_lat: pos.latitude, p_lng: pos.longitude, p_device_id: deviceId(), p_selfie_url: path, p_is_mock_location: false });
      if (error) throw error;
      const late = kind === 'in' && data?.status === 'late' ? `<p><span class="tag late">${data.late_minutes} min late</span></p>` : '';
      const early = kind === 'out' && data?.early_leave_minutes ? `<p>Left ${data.early_leave_minutes} min before the shift ends.</p>` : '';
      area.innerHTML = `<div class="done-big"><div class="tick">✓</div><h2>${kind === 'in' ? 'Checked in' : kind === 'out' ? 'Checked out' : 'Visit started'}</h2>
        <p>${esc(target.name)} at ${clock(new Date().toISOString())}</p>${late}${early}</div><button class="btn" id="ok">Done</button>`;
      area.querySelector('#ok').onclick = () => { close(); viewHome(); };
    } catch (e) {
      area.innerHTML = `<div class="alert error" role="alert">${esc(errText(e))}</div><button class="btn" id="again">Try again</button>`;
      area.querySelector('#again').onclick = () => send();
    }
  };

  const next = async () => {
    if (needSelfie && !(await takeSelfie())) return;
    send();
  };
  if (await locate()) next();
}

async function visitEnd() {
  const sheet = document.createElement('div');
  sheet.className = 'sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Finish visit');
  sheet.innerHTML = `<div class="inner"><div class="sheet-head"><h2>Finish visit</h2><button class="close" aria-label="Close">×</button></div>
    <p>Visit at <b>${esc(branchName(S.visit.branch_id))}</b>, started ${clock(S.visit.check_in_at)}.</p>
    <form id="vf" novalidate><div class="field"><label for="vn">What did you do? <span class="hint">optional</span></label><textarea id="vn" rows="3" placeholder="Checked stock, trained staff"></textarea></div>
    <button class="btn" type="submit">Finish visit</button></form></div>`;
  document.body.appendChild(sheet);
  sheet.querySelector('.close').onclick = () => sheet.remove();
  const f = sheet.querySelector('#vf');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button'); busy(btn, true, 'Finding your location…');
    try {
      const p = await getPosition();
      busy(btn, true, 'Saving…');
      const { data, error } = await sb.rpc('visit_end', { p_lat: p.latitude, p_lng: p.longitude, p_device_id: deviceId(), p_notes: f.vn.value.trim() || null, p_is_mock_location: false });
      if (error) throw error;
      sheet.remove(); toast(`Visit finished (${data.minutes} min)`); viewHome();
    } catch (err) { busy(btn, false); alertIn(f, errText(err)); }
  };
}

// ---------------------------------------------------------------
// CLOSING
// ---------------------------------------------------------------
async function viewClosing() {
  frame('closing', '<div class="boot">Loading…</div>');
  try { await loadToday(); } catch (e) { return frame('closing', `<div class="alert error">${esc(errText(e))}</div>`); }
  if (S.closing) return closingDone(S.closing);
  const canPrice = !!S.settings.allow_price_edit;
  let mode = S.products.length ? 'products' : 'amount';
  const lines = [];

  const render = () => {
    const total = lines.reduce((t, l) => t + Math.max((l.qty - l.ret) * l.price - l.disc, 0), 0);
    frame('closing', `
      <div class="head"><div><h1>Daily closing</h1><p>${dayLabel(today(), { weekday: 'long', day: 'numeric', month: 'long' })}</p></div></div>
      <div class="seg" role="tablist"><button role="tab" data-m="products" class="${mode === 'products' ? 'on' : ''}" aria-selected="${mode === 'products'}">Product-wise</button><button role="tab" data-m="amount" class="${mode === 'amount' ? 'on' : ''}" aria-selected="${mode === 'amount'}">Total amount</button></div>
      <form id="cf" novalidate>
      ${mode === 'amount' ? `
        <div class="field big-amount"><label for="amt">Today's total sale (Rs)</label><input id="amt" type="number" inputmode="numeric" min="0" placeholder="0"></div>` : `
        ${S.products.length ? '' : '<div class="alert info">No products yet. Ask HR to add products, or use Total amount.</div>'}
        <div class="field search"><label for="ps">Add a product</label><input id="ps" type="search" placeholder="Search name or code" autocomplete="off"></div>
        <div class="results" id="res" hidden></div>
        <div id="lines">${lines.map((l, i) => `<div class="line" data-i="${i}">
          <div class="top"><span class="name">${esc(l.name)}</span><button type="button" class="link rm">Remove</button></div>
          <div class="ctrls">
            <div class="qty"><button type="button" class="dec" aria-label="Less">−</button><input class="q" type="number" inputmode="numeric" min="1" value="${l.qty}" aria-label="Quantity"><button type="button" class="inc" aria-label="More">+</button></div>
            <label class="mini">Price<input class="pr" type="number" inputmode="numeric" min="0" value="${l.price}" ${canPrice ? '' : 'readonly'}></label>
            <span class="amount" style="margin-left:auto">Rs ${money(Math.max((l.qty - l.ret) * l.price - l.disc, 0))}</span>
          </div>
          <details ${l.disc || l.ret ? 'open' : ''}><summary class="hint">Discount or return</summary><div class="ctrls">
            <label class="mini">Discount (Rs)<input class="di" type="number" inputmode="numeric" min="0" value="${l.disc}"></label>
            <label class="mini">Returned qty<input class="re" type="number" inputmode="numeric" min="0" value="${l.ret}"></label></div></details>
        </div>`).join('')}</div>`}
        <div class="field"><label for="notes">Note <span class="hint">optional</span></label><input id="notes" placeholder="Anything HR should know"></div>
        <div class="total-bar">${mode === 'products' ? `<div class="sum"><span>Total</span><span class="num">Rs ${money(total)}</span></div>` : ''}
          <button class="btn" type="submit">Submit closing</button></div>
      </form>`);

    document.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { mode = b.dataset.m; render(); });
    const f = document.getElementById('cf');
    const ps = document.getElementById('ps'), res = document.getElementById('res');
    if (ps) {
      ps.oninput = () => {
        const q = ps.value.trim().toLowerCase();
        const hits = q ? S.products.filter((p) => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)).slice(0, 20) : [];
        res.hidden = !hits.length;
        res.innerHTML = hits.map((p) => `<button type="button" data-p="${p.id}"><span>${esc(p.name)}</span><span class="muted">Rs ${money(p.default_price)}</span></button>`).join('');
        res.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => {
          const p = S.products.find((x) => x.id === b.dataset.p);
          const ex = lines.find((l) => l.id === p.id);
          if (ex) ex.qty += 1; else lines.push({ id: p.id, name: p.name, qty: 1, price: Number(p.default_price), disc: 0, ret: 0 });
          render(); document.getElementById('ps')?.focus();
        });
      };
      document.querySelectorAll('.line').forEach((el) => {
        const l = lines[Number(el.dataset.i)];
        const upd = () => { l.qty = Math.max(1, Number(el.querySelector('.q').value) || 1); l.price = Math.max(0, Number(el.querySelector('.pr').value) || 0); l.disc = Math.max(0, Number(el.querySelector('.di').value) || 0); l.ret = Math.min(l.qty, Math.max(0, Number(el.querySelector('.re').value) || 0)); };
        el.querySelector('.inc').onclick = () => { upd(); l.qty++; render(); };
        el.querySelector('.dec').onclick = () => { upd(); l.qty = Math.max(1, l.qty - 1); render(); };
        el.querySelector('.rm').onclick = () => { lines.splice(Number(el.dataset.i), 1); render(); };
        el.querySelectorAll('input').forEach((i) => i.onchange = () => { upd(); render(); });
      });
    }
    f.onsubmit = async (e) => {
      e.preventDefault();
      const notes = document.getElementById('notes').value.trim() || null;
      let args;
      if (mode === 'amount') {
        const amt = Number(document.getElementById('amt').value);
        if (!(amt >= 0) || document.getElementById('amt').value === '') return alertIn(f, 'Enter today’s total sale.');
        args = { p_closing_type: 'simple_amount', p_total_amount: amt, p_items: null, p_notes: notes };
      } else {
        if (!lines.length) return alertIn(f, 'Add at least one product, or use Total amount.');
        if (lines.some((l) => l.disc > (l.qty - l.ret) * l.price)) return alertIn(f, 'A discount is more than the product amount.');
        args = { p_closing_type: 'product_wise', p_total_amount: null, p_notes: notes,
          p_items: lines.map((l) => ({ product_id: l.id, quantity: l.qty, unit_price: l.price, discount: l.disc, return_quantity: l.ret })) };
      }
      if (!confirm('Submit today’s closing? You cannot change it later, only ask for a correction.')) return;
      const btn = f.querySelector('button[type=submit]'); busy(btn, true, 'Submitting…');
      const { error } = await sb.rpc('submit_closing', args);
      busy(btn, false);
      if (error) return alertIn(f, errText(error));
      toast('Closing submitted'); viewClosing();
    };
  };
  render();
}

async function closingDone(c) {
  const it = c.closing_type === 'product_wise' ? (await sb.from('closing_items').select('*').eq('closing_id', c.id).order('created_at')).data || [] : [];
  const cr = (await sb.from('closing_corrections').select('status, reason, review_note, created_at').eq('closing_id', c.id).order('created_at', { ascending: false })).data || [];
  const pending = cr.some((x) => x.status === 'pending');
  frame('closing', `
    <div class="head"><div><h1>Daily closing</h1><p>${dayLabel(c.closing_date, { weekday: 'long', day: 'numeric', month: 'long' })}</p></div></div>
    <section class="card"><h2>Submitted</h2><p class="amount" style="font-size:28px;color:var(--ink)">Rs ${money(c.total_amount)}</p>
      ${it.length ? `<ul class="list" style="margin-top:10px">${it.map((i) => `<li><div><div class="t">${esc(i.product_name_snapshot)}</div><div class="s">${nd(i.quantity)} × Rs ${money(i.unit_price)}${Number(i.discount_amount) ? `, discount ${money(i.discount_amount)}` : ''}${Number(i.return_quantity) ? `, ${nd(i.return_quantity)} returned` : ''}</div></div><span class="amount">${money(i.line_total)}</span></li>`).join('')}</ul>` : ''}
    </section>
    ${cr.length ? `<p class="section-title">Corrections</p><section class="card"><ul class="list">${cr.map((x) => `<li><div><div class="t">${esc(x.reason)}</div>${x.review_note ? `<div class="s">HR: ${esc(x.review_note)}</div>` : ''}</div><span class="tag ${x.status === 'approved' ? 'ok' : x.status === 'rejected' ? 'bad' : 'warn'}">${x.status === 'pending' ? 'Waiting' : x.status === 'approved' ? 'Approved' : 'Rejected'}</span></li>`).join('')}</ul></section>` : ''}
    ${pending ? '' : '<button class="btn ghost" id="fix">Something is wrong? Ask for a correction</button>'}`);
  document.getElementById('fix')?.addEventListener('click', () => correctionForm(c, it));
}

function correctionForm(c, items) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Ask for a correction');
  const lines = items.map((i) => ({ id: i.product_id, name: i.product_name_snapshot, qty: Number(i.quantity), price: Number(i.unit_price), disc: Number(i.discount_amount), ret: Number(i.return_quantity) }));
  sheet.innerHTML = `<div class="inner"><div class="sheet-head"><h2>Ask for a correction</h2><button class="close" aria-label="Close">×</button></div>
    <p class="hint">Your manager or HR checks and approves it.</p>
    <form id="rf" novalidate>
      ${c.closing_type === 'simple_amount' ? `<div class="field big-amount"><label for="na">Correct total (Rs)</label><input id="na" type="number" inputmode="numeric" min="0" value="${Number(c.total_amount)}"></div>`
        : `<div id="cl">${lines.map((l, i) => `<div class="line"><div class="top"><span class="name">${esc(l.name)}</span></div><div class="ctrls">
            <label class="mini">Correct qty<input data-i="${i}" class="q" type="number" inputmode="numeric" min="0" value="${l.qty}"></label>
            <label class="mini">Returned<input data-i="${i}" class="re" type="number" inputmode="numeric" min="0" value="${l.ret}"></label></div></div>`).join('')}</div>
          <p class="hint">Set a quantity to 0 to remove that product.</p>`}
      <div class="field"><label for="why">What was wrong?</label><input id="why" placeholder="Typed one extra zero"></div>
      <button class="btn" type="submit">Send request</button></form></div>`;
  document.body.appendChild(sheet);
  sheet.querySelector('.close').onclick = () => sheet.remove();
  const f = sheet.querySelector('#rf');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const why = f.querySelector('#why').value.trim();
    if (!why) return alertIn(f, 'Write what was wrong.');
    let changes;
    if (c.closing_type === 'simple_amount') {
      const v = Number(f.querySelector('#na').value);
      if (!(v >= 0)) return alertIn(f, 'Enter the correct total.');
      changes = { total_amount: v };
    } else {
      f.querySelectorAll('.q').forEach((i) => { lines[i.dataset.i].qty = Number(i.value) || 0; });
      f.querySelectorAll('.re').forEach((i) => { lines[i.dataset.i].ret = Number(i.value) || 0; });
      const keep = lines.filter((l) => l.qty > 0);
      if (!keep.length) return alertIn(f, 'At least one product must stay.');
      if (keep.some((l) => l.ret > l.qty)) return alertIn(f, 'Returned quantity cannot be more than the quantity.');
      changes = { items: keep.map((l) => ({ product_id: l.id, quantity: l.qty, unit_price: l.price, discount: l.disc, return_quantity: l.ret })) };
    }
    const btn = f.querySelector('button[type=submit]'); busy(btn, true, 'Sending…');
    const { error } = await sb.rpc('request_closing_correction', { p_closing: c.id, p_reason: why, p_changes: changes });
    busy(btn, false);
    if (error) return alertIn(f, errText(error));
    sheet.remove(); toast('Correction request sent'); route() === 'closing' ? viewClosing() : viewMe();
  };
}

// ---------------------------------------------------------------
// LEAVE
// ---------------------------------------------------------------
async function viewLeave() {
  frame('leave', '<div class="boot">Loading…</div>');
  const [b, t, r] = await Promise.all([
    sb.rpc('leave_balance', { p_employee: S.me.id, p_on: today() }),
    sb.from('leave_types').select('id, name, is_paid, allow_half_day').eq('company_id', S.me.company_id).eq('is_active', true).order('sort'),
    sb.from('leave_requests').select('*').eq('employee_id', S.me.id).order('start_date', { ascending: false }).limit(30),
  ]);
  if (b.error) return frame('leave', `<div class="alert error">${esc(errText(b.error))}</div>`);
  const bal = (b.data || []).filter((x) => x.is_paid), types = t.data || [], reqs = r.data || [];
  const tName = (id) => types.find((x) => x.id === id)?.name || 'Leave';
  const ST = { pending: ['Waiting', 'warn'], manager_approved: ['Waiting for HR', 'warn'], approved: ['Approved', 'ok'], rejected: ['Rejected', 'bad'], cancelled: ['Cancelled', 'neutral'] };

  frame('leave', `
    <div class="head"><div><h1>Leave</h1><p>Days left this leave year</p></div></div>
    <div class="bal">${bal.map((x) => `<div><b class="num">${nd(x.remaining)}</b><span>${esc(x.name)} of ${nd(Number(x.quota) + Number(x.adjusted))}</span></div>`).join('') || '<p class="hint">No paid leave types yet.</p>'}</div>
    <p class="section-title">Apply for leave</p>
    <section class="card"><form id="lf" novalidate>
      <div class="field"><label for="lt">Leave type</label><select id="lt">${types.map((x) => `<option value="${x.id}" data-half="${x.allow_half_day}">${esc(x.name)}${x.is_paid ? '' : ' (unpaid)'}</option>`).join('')}</select></div>
      <div class="row"><div class="field"><label for="lfrom">From</label><input id="lfrom" type="date" value="${today()}" min="${today()}"></div>
        <div class="field"><label for="lto">To</label><input id="lto" type="date" value="${today()}" min="${today()}"></div></div>
      <label class="check"><input type="checkbox" id="lhalf"> Half day</label>
      <div class="field"><label for="lr">Reason</label><input id="lr" placeholder="Family wedding"></div>
      <button class="btn" type="submit">Send request</button></form></section>
    ${reqs.length ? `<p class="section-title">My requests</p><section class="card"><ul class="list">${reqs.map((x) => `<li><div><div class="t">${esc(tName(x.leave_type_id))}, ${nd(x.days)} day${Number(x.days) === 1 ? '' : 's'}</div>
      <div class="s">${x.start_date === x.end_date ? dayLabel(x.start_date) : `${dayLabel(x.start_date)} to ${dayLabel(x.end_date)}`}${x.final_note || x.manager_note ? ` · ${esc(x.final_note || x.manager_note)}` : ''}</div>
      ${['pending', 'manager_approved'].includes(x.status) ? `<button class="link" data-cancel="${x.id}">Cancel request</button>` : ''}</div>
      <span class="tag ${ST[x.status][1]}">${ST[x.status][0]}</span></li>`).join('')}</ul></section>` : ''}`);

  const f = document.getElementById('lf');
  const half = f.querySelector('#lhalf'), lt = f.querySelector('#lt'), to = f.querySelector('#lto');
  const sync = () => { const ok = lt.selectedOptions[0]?.dataset.half === 'true'; half.disabled = !ok; if (!ok) half.checked = false; to.disabled = half.checked; };
  half.onchange = sync; lt.onchange = sync; sync();
  f.querySelector('#lfrom').onchange = (e) => { if (to.value < e.target.value) to.value = e.target.value; to.min = e.target.value; };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const from = f.querySelector('#lfrom').value, end = half.checked ? from : to.value, reason = f.querySelector('#lr').value.trim();
    if (!lt.value || !from || !end) return alertIn(f, 'Choose the leave type and dates.');
    if (end < from) return alertIn(f, 'The end date must be after the start date.');
    if (!reason) return alertIn(f, 'Write a short reason.');
    const btn = f.querySelector('button'); busy(btn, true, 'Sending…');
    const { error } = await sb.rpc('submit_leave', { p_leave_type: lt.value, p_start: from, p_end: end, p_half_day: half.checked, p_reason: reason });
    busy(btn, false);
    if (error) return alertIn(f, errText(error));
    toast('Leave request sent'); viewLeave();
  };
  document.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = async () => {
    if (!confirm('Cancel this leave request?')) return;
    const { error } = await sb.rpc('cancel_leave', { p_request: b.dataset.cancel, p_note: 'Cancelled by employee' });
    if (error) return toast(errText(error), true);
    toast('Request cancelled'); viewLeave();
  });
}

// ---------------------------------------------------------------
// ME: attendance history, closings, payslips, advances, logout
// ---------------------------------------------------------------
async function viewMe() {
  frame('me', '<div class="boot">Loading…</div>');
  const from = today().slice(0, 8) + '01';
  const [a, c, runs, slips, adv, co] = await Promise.all([
    sb.from('attendance').select('attendance_date, status, check_in_at, check_out_at, late_minutes').eq('employee_id', S.me.id).gte('attendance_date', from).order('attendance_date', { ascending: false }),
    sb.from('daily_closings').select('*').eq('employee_id', S.me.id).order('closing_date', { ascending: false }).limit(14),
    sb.from('payroll_runs').select('id, period_start, period_end, status').eq('status', 'finalized').order('period_start', { ascending: false }).limit(12),
    sb.from('payslips').select('*').eq('employee_id', S.me.id),
    sb.rpc('advance_list'),
    sb.from('companies').select('login_code, name').eq('id', S.me.company_id).maybeSingle(),
  ]);
  const att = a.data || [], cls = c.data || [], rs = runs.data || [], sl = slips.data || [], advs = (adv.data || []).filter((x) => Number(x.remaining) > 0);
  const present = att.filter((x) => ['present', 'late'].includes(x.status)).length, late = att.filter((x) => x.status === 'late').length;
  const tag = { present: ['Present', 'ok'], late: ['Late', 'warn'], absent: ['Absent', 'bad'], leave: ['Leave', 'neutral'], half_day: ['Half day', 'neutral'], holiday: ['Holiday', 'neutral'] };

  frame('me', `
    <div class="head"><div><h1>${esc(S.me.full_name)}</h1><p>Staff ID ${esc(co.data?.login_code || '')}-${esc(S.me.employee_code)} · ${esc(branchName(S.me.home_branch_id))}</p></div></div>
    <p class="section-title">This month</p>
    <section class="card"><p style="margin:0 0 6px">${present} days present${late ? `, ${late} late` : ''}</p>
      <ul class="list">${att.slice(0, 10).map((x) => `<li><div><div class="t">${dayLabel(x.attendance_date)}</div><div class="s">${x.check_in_at ? `${clock(x.check_in_at)} to ${clock(x.check_out_at)}` : '–'}</div></div><span class="tag ${(tag[x.status] || ['', 'neutral'])[1]}">${(tag[x.status] || [x.status])[0]}${x.status === 'late' && x.late_minutes ? ` ${x.late_minutes}m` : ''}</span></li>`).join('') || '<li class="s">No attendance yet this month.</li>'}</ul></section>
    <p class="section-title">My closings</p>
    <section class="card"><ul class="list">${cls.map((x) => `<li><button class="item" data-cl="${x.id}"><div><div class="t">${dayLabel(x.closing_date)}</div><div class="s">${x.closing_type === 'product_wise' ? 'Product-wise' : 'Total amount'}${x.status === 'correction_requested' ? ' · correction asked' : x.status === 'corrected' ? ' · corrected' : ''}</div></div><span class="amount">Rs ${money(x.total_amount)}</span></button></li>`).join('') || '<li class="s">No closings yet.</li>'}</ul></section>
    <p class="section-title">Payslips</p>
    <section class="card"><ul class="list">${rs.map((r) => { const s = sl.find((x) => x.run_id === r.id); return s ? `<li><button class="item" data-slip="${s.id}"><div><div class="t">${new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(r.period_end + 'T00:00:00'))}</div><div class="s">${dayLabel(r.period_start)} to ${dayLabel(r.period_end)}</div></div><span class="amount">Rs ${money(s.net)}</span></button></li>` : ''; }).join('') || '<li class="s">Your payslips show here after HR finalizes payroll.</li>'}</ul></section>
    ${advs.length ? `<p class="section-title">Advance</p><section class="card"><ul class="list">${advs.map((x) => `<li><div><div class="t">Rs ${money(x.remaining)} left</div><div class="s">of Rs ${money(x.amount)}, Rs ${money(x.installment)} cut each month</div></div></li>`).join('')}</ul></section>` : ''}
    <button class="btn ghost" id="logout" style="margin-top:22px">Log out</button>`);

  document.querySelectorAll('[data-cl]').forEach((b) => b.onclick = () => closingDone(cls.find((x) => x.id === b.dataset.cl)));
  document.querySelectorAll('[data-slip]').forEach((b) => b.onclick = () => payslip(sl.find((x) => x.id === b.dataset.slip), rs.find((r) => r.id === sl.find((x) => x.id === b.dataset.slip).run_id)));
  document.getElementById('logout').onclick = async () => { if (confirm('Log out?')) { S.me = null; await sb.auth.signOut(); history.replaceState(null, '', '#/home'); viewLogin(); } };
}

function payslip(s, r) {
  const d = s.days || {};
  const rows = [['Basic salary', s.basic_salary, ''], ['Overtime', s.overtime_amount, ''], ['Commission', s.commission, ''], ['Bonus', s.bonus, ''],
    ['Absent', s.absent_cut, '−'], ['Unpaid leave', s.unpaid_leave_cut, '−'], ['Late', s.late_cut, '−'], ['Before joining', s.not_joined_cut, '−'],
    ['Advance installment', s.advance_cut, '−'], ['Other deduction', s.other_cut, '−']].filter((x) => Number(x[1]) || x[0] === 'Basic salary');
  const sheet = document.createElement('div');
  sheet.className = 'sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Payslip');
  sheet.innerHTML = `<div class="inner"><div class="sheet-head"><h2>Payslip</h2><button class="close" aria-label="Close">×</button></div>
    <p class="muted">${dayLabel(r.period_start)} to ${dayLabel(r.period_end)}</p>
    <section class="card"><p style="margin:0">${nd(d.present)} days present of ${nd(d.working)}, ${nd(d.absent)} absent, ${nd(d.paid_leave)} paid leave</p></section>
    <section class="card">${rows.map(([l, v, sign]) => `<div class="slip-row"><span>${l}</span><span class="num">${sign}${money(v)}</span></div>`).join('')}
      <div class="slip-row tot"><span>Net pay</span><span class="num">Rs ${money(s.net)}</span></div></section>
    ${s.note ? `<p class="hint">${esc(s.note)}</p>` : ''}</div>`;
  document.body.appendChild(sheet);
  sheet.querySelector('.close').onclick = () => sheet.remove();
}

// ---------------------------------------------------------------
// start
// ---------------------------------------------------------------
async function render() {
  document.querySelectorAll('.sheet').forEach((s) => s.remove());
  const r = route();
  if (r === 'closing') return viewClosing();
  if (r === 'leave') return viewLeave();
  if (r === 'me') return viewMe();
  return viewHome();
}

async function boot() {
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  if (!S.session) return viewLogin();
  try { await loadBase(); } catch (e) { return viewLogin(errText(e)); }
  if (!S.me) {
    await sb.auth.signOut();
    return viewLogin('This login is not linked to an employee. Company admins use the web panel.');
  }
  if (S.me.status !== 'active' || S.profile?.is_active === false) {
    await sb.auth.signOut();
    return viewLogin('Your account is not active. Please contact HR.');
  }
  render();
}

window.addEventListener('hashchange', () => { if (S.me) render(); });
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { S.me = null; } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
deviceId();
boot();
