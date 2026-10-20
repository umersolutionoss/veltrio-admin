// =============================================================
//  Veltrio admin panel
//  7.1 Login, company signup, company setup, dashboard, super admin overview
//  7.2 Branches and settings (see setup-pages.js)
//  7.3 Employees and staff app logins (see employees-page.js)
//  7.4 Per-company permissions for HR and branch managers
//  7.5 Leave: requests, approvals, balances, rules (see leave-page.js)
//  7.6 Payroll: payslips, advances, payroll rules (see payroll-page.js)
//  7.7 Products, attendance and sales closing reports (see reports-pages.js)
//  9   Veltrio admin: companies, payments, plans; company billing (see admin-pages.js)
// =============================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY, TIME_ZONE } from './config.js';
import { initSetupPages } from './setup-pages.js';
import { initEmployeesPage } from './employees-page.js';
import { initLeavePage } from './leave-page.js';
import { initPayrollPage } from './payroll-page.js';
import { initReportPages } from './reports-pages.js';
import { initAdminPages } from './admin-pages.js';

// Staff log in with "<company code>-<employee code>", e.g. BV7K2-E01.
// It maps to the hidden login email the staff-login function creates.
const STAFF_DOMAIN = 'staff.veltrio.app';
const slug = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function loginEmail(input) {
  const v = String(input || '').trim();
  if (v.includes('@')) return v;
  const i = v.indexOf('-');
  if (i < 1) return v;
  return `${slug(v.slice(i + 1))}.${slug(v.slice(0, i))}@${STAFF_DOMAIN}`;
}

const app = document.getElementById('app');

// Captured before Supabase reads (and clears) the link a reset email opens
const START = new URL(location.href);
const START_HASH = new URLSearchParams(START.hash.replace(/^#\/?/, ''));
const LINK_ERROR = START_HASH.get('error_description') || START.searchParams.get('error_description');
const configured = SUPABASE_KEY && !SUPABASE_KEY.startsWith('PASTE_');
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const state = {
  session: null, profile: undefined, company: null, sub: null, signingUp: false,
  // true while the person is setting a new password from the reset email
  recovery: START.searchParams.get('reset') === '1' || START_HASH.get('type') === 'recovery',
};

// ---------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => 'Rs ' + new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(Number(n) || 0);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
const daysLeft = (end) => Math.round((Date.parse(end) - Date.parse(today())) / 86400000);
const route = () => (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0];
const query = () => new URLSearchParams(location.hash.split('?')[1] || '');
const go = (r) => { if (route() === r) render(); else location.hash = '#/' + r; };

const ROLE_NAMES = {
  super_admin: 'Veltrio admin', company_admin: 'Company admin',
  hr: 'HR', branch_manager: 'Branch manager', employee: 'Employee',
};

function friendlyError(err) {
  const m = (err && (err.message || err.error_description)) || String(err);
  if (/Invalid login credentials/i.test(m)) return 'Email, Staff ID or password is incorrect.';
  if (/banned/i.test(m)) return 'This login is turned off. Ask your company admin or HR.';
  if (/Email not confirmed/i.test(m)) return 'Please confirm your email first. Check your inbox for the link from Veltrio.';
  if (/already registered|already been registered/i.test(m)) return 'An account with this email already exists. Log in instead.';
  if (/Password should be at least/i.test(m)) return 'Password must be at least 8 characters.';
  if (/rate limit|too many/i.test(m)) return 'Too many emails were sent. Wait an hour and try again, or contact Veltrio support.';
  if (/not authorized/i.test(m)) return 'Email could not be sent to this address. Contact Veltrio support to reset your password.';
  if (/should be different/i.test(m)) return 'Choose a password different from your old one.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Could not reach the server. Check your internet connection and try again.';
  return m;
}

function showAlert(form, msg, kind = 'error') {
  let box = form.querySelector('.alert');
  if (!box) { box = document.createElement('div'); form.prepend(box); }
  box.className = 'alert alert-' + kind;
  box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  box.textContent = msg;
}

function busy(btn, on, label) {
  btn.disabled = on;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label; }
  else if (btn.dataset.label) btn.textContent = btn.dataset.label;
}

const LOGO = `<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0B4F55"/><rect x="1" y="1" width="30" height="30" rx="7" fill="none" stroke="rgba(255,255,255,.18)"/><path d="M9 10l7 13 7-13" fill="none" stroke="#F2B84B" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const ICONS = {
  dashboard: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
  branches: '<path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6"/>',
  employees: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M22 21c0-3-2-5-4-5.5"/>',
  products: '<path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8"/>',
  attendance: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  payroll: '<rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="2.5"/><path d="M6 6V4h12v2M5.5 12.5h.01M18.5 12.5h.01"/>',
  leave: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M9 15l2 2 4-4"/>',
  closings: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  companies: '<path d="M3 21h18M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M10 7h4M10 11h4M10 15h4"/>',
  payments: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  plans: '<path d="M4 7h16M4 12h16M4 17h10"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ''}</svg>`;

const COMPANY_NAV = [
  ['dashboard', 'Dashboard'], ['branches', 'Branches'], ['employees', 'Employees'],
  ['products', 'Products'], ['attendance', 'Attendance'], ['leave', 'Leave'], ['payroll', 'Payroll'], ['closings', 'Sales closing'],
  ['settings', 'Settings'],
];
const ADMIN_NAV = [
  ['dashboard', 'Overview'], ['companies', 'Companies'], ['payments', 'Payments'], ['plans', 'Plans'],
];
const COMING = {
  companies: ['Companies', 'All companies on Veltrio, their plan, status and usage.', '7.7'],
  payments: ['Payments', 'Approve bank transfer, JazzCash and Easypaisa payments.', '7.7'],
  plans: ['Plans', 'Set prices and limits for Starter, Business and Enterprise.', '7.7'],
};

// ---------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------
async function loadProfile() {
  const uid = state.session.user.id;
  const { data, error } = await sb.from('users_profile')
    .select('id, role, full_name, company_id, is_active').eq('id', uid).maybeSingle();
  if (error) throw error;
  state.profile = data || null;
  state.company = null; state.sub = null;
  if (data && data.company_id) {
    const [c, s] = await Promise.all([
      sb.from('companies').select('*').eq('id', data.company_id).maybeSingle(),
      sb.from('subscriptions').select('plan_id, status, end_date, billing_cycle, plans(name, max_branches, max_employees)')
        .eq('company_id', data.company_id).order('end_date', { ascending: false }).limit(1).maybeSingle(),
    ]);
    state.company = c.data || null;
    state.sub = s.data || null;
    // limits that apply today: employees paid for, or a limit set by Veltrio
    if (state.sub?.plans) {
      const lim = await sb.rpc('my_limits');
      const l = lim.data?.[0];
      if (!lim.error && l) {
        state.sub.plans = { ...state.sub.plans, custom: l.is_custom, max_branches: l.max_branches, max_employees: l.max_employees,
          next_employees: l.next_employees, next_start: l.next_start };
      } else {
        const co = state.company;
        if (co && (co.custom_max_branches != null || co.custom_max_employees != null)) {
          state.sub.plans = { ...state.sub.plans, custom: true,
            max_branches: co.custom_max_branches ?? state.sub.plans.max_branches,
            max_employees: co.custom_max_employees ?? state.sub.plans.max_employees };
        }
      }
    }
    await reloadPerms();
    const me = await sb.from('employees').select('id').eq('user_id', uid).maybeSingle();
    state.employeeId = me.data?.id || null;
  }
}

// What HR and branch managers may do in this company (company admin: everything)
async function reloadPerms() {
  const p = state.profile;
  state.perms = new Set();
  if (!p || !['hr', 'branch_manager'].includes(p.role)) return;
  const [d, o] = await Promise.all([
    sb.from('permission_defs').select('key, hr_default, manager_default'),
    sb.from('role_permissions').select('permission, allowed').eq('company_id', p.company_id).eq('role', p.role),
  ]);
  for (const def of d.data || []) {
    const ov = (o.data || []).find((x) => x.permission === def.key);
    const on = ov ? ov.allowed : (p.role === 'hr' ? def.hr_default : def.manager_default);
    if (on) state.perms.add(def.key);
  }
}
function can(key) {
  const r = state.profile?.role;
  if (r === 'company_admin') return true;
  if (r === 'hr' || r === 'branch_manager') return !!state.perms?.has(key);
  return false;
}

async function count(table, filter) {
  let q = sb.from(table).select('id', { count: 'exact', head: true });
  if (filter) q = filter(q);
  const { count: n, error } = await q;
  if (error) throw error;
  return n || 0;
}

// ---------------------------------------------------------------
// Screens: not configured / login / signup / company setup
// ---------------------------------------------------------------
function viewNotConfigured() {
  app.innerHTML = `
  <div class="center-page"><div class="center-card">
    <span class="logo">${LOGO} Veltrio</span>
    <h2>One setting is missing</h2>
    <p class="sub">The panel needs your Supabase publishable key before it can connect.</p>
    <p>Open <code>config.js</code> and paste the key where it says <code>PASTE_YOUR_PUBLISHABLE_KEY_HERE</code>. You will find the key in Supabase under Settings, API Keys.</p>
  </div></div>`;
}

function authLayout(inner) {
  return `
  <div class="auth">
    <aside class="auth-brand">
      <a class="logo" href="#/login">${LOGO} Veltrio</a>
      <div>
        <h1>Every shop, every shift, every closing.</h1>
        <p>Attendance with GPS and selfie, daily sales closing and staff records for all your branches in one place.</p>
      </div>
      <div class="ledger" aria-label="Example of a shop day">
        <div class="ledger-head"><span>Iqbal Town branch</span><span>Today</span></div>
        <div class="ledger-row"><time>10:52</time><span><b>Ali</b> checked in</span><span class="tag">On time</span></div>
        <div class="ledger-row"><time>11:14</time><span><b>Sana</b> checked in</span><span class="tag late">14 min late</span></div>
        <div class="ledger-row"><time>21:05</time><span><b>Ali</b> closing</span><span class="amt">Rs 32,000</span></div>
        <div class="ledger-row"><time>21:09</time><span><b>Sana</b> closing</span><span class="amt">Rs 18,500</span></div>
        <div class="ledger-total"><span>Branch total</span><span class="num">Rs 50,500</span></div>
      </div>
    </aside>
    <main class="auth-main"><div class="auth-card">${inner}</div></main>
  </div>`;
}

function viewLogin() {
  const notice = state.notice; state.notice = null;
  app.innerHTML = authLayout(`
    <h2>Log in</h2>
    <p class="sub">Welcome back. Log in to manage your company.</p>
    <form id="f" novalidate>
      ${notice ? `<div class="alert alert-ok" role="status">${esc(notice)}</div>` : ''}
      <div class="field"><label for="email">Email or Staff ID</label><input id="email" autocomplete="username" required><span class="hint">Staff use their Staff ID, for example BV7K2-E01.</span></div>
      <div class="field">
        <div class="label-row"><label for="pw">Password</label><a href="#/forgot">Forgot password?</a></div>
        <input id="pw" type="password" autocomplete="current-password" required>
      </div>
      <button class="btn btn-block" type="submit">Log in</button>
    </form>
    <p class="auth-switch">New company? <a href="#/signup">Start a free trial</a></p>`);

  const f = document.getElementById('f');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = loginEmail(f.email.value), password = f.pw.value;
    if (!email || !password) return showAlert(f, 'Enter your email or Staff ID, and your password.');
    const btn = f.querySelector('button');
    busy(btn, true, 'Logging in…');
    const { error } = await sb.auth.signInWithPassword({ email, password });
    busy(btn, false);
    if (error) showAlert(f, friendlyError(error));
    // success: auth listener re-renders
  });
}

function viewForgot() {
  app.innerHTML = authLayout(`
    <h2>Reset your password</h2>
    <p class="sub">Enter the email you log in with. We will send you a link to set a new password.</p>
    <form id="f" novalidate>
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" required></div>
      <button class="btn btn-block" type="submit">Send reset link</button>
    </form>
    <p class="auth-switch"><a href="#/login">Back to log in</a></p>`);

  const f = document.getElementById('f');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = f.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showAlert(f, 'Enter a valid email address.');
    const btn = f.querySelector('button');
    busy(btn, true, 'Sending…');
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname + '?reset=1',
    });
    busy(btn, false);
    if (error) return showAlert(f, friendlyError(error));
    f.innerHTML = `<div class="alert alert-ok" role="status">If ${esc(email)} has a Veltrio account, a reset link is on its way. Open the email and click the link. Check your spam folder too.</div>`;
  });
}

function viewResetPassword() {
  app.innerHTML = authLayout(`
    <h2>Set a new password</h2>
    <p class="sub">Choose a new password for ${esc(state.session.user.email)}.</p>
    <form id="f" novalidate>
      <div class="field"><label for="pw">New password</label><input id="pw" type="password" autocomplete="new-password" minlength="8" required><span class="hint">At least 8 characters.</span></div>
      <div class="field"><label for="pw2">Type it again</label><input id="pw2" type="password" autocomplete="new-password" required></div>
      <button class="btn btn-block" type="submit">Save new password</button>
    </form>`);

  const f = document.getElementById('f');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = f.pw.value, pw2 = f.pw2.value;
    if (pw.length < 8) return showAlert(f, 'Password must be at least 8 characters.');
    if (pw !== pw2) return showAlert(f, 'The two passwords do not match.');
    const btn = f.querySelector('button');
    busy(btn, true, 'Saving…');
    const { error } = await sb.auth.updateUser({ password: pw });
    busy(btn, false);
    if (error) return showAlert(f, friendlyError(error));
    state.recovery = false;
    history.replaceState(null, '', location.pathname + '#/dashboard');
    render();
  });
}

function viewLinkProblem(message) {
  app.innerHTML = authLayout(`
    <h2>This link does not work</h2>
    <p class="sub">${esc(message)}</p>
    <a class="btn btn-block" href="#/forgot">Send a new reset link</a>
    <p class="auth-switch"><a href="#/login">Back to log in</a></p>`);
}

async function viewSignup() {
  app.innerHTML = authLayout(`
    <h2>Start your free trial</h2>
    <p class="sub">Set up your company in two minutes. No payment needed now.</p>
    <form id="f" novalidate>
      <div class="field"><label for="full_name">Your name</label><input id="full_name" autocomplete="name" required></div>
      <div class="field"><label for="company">Company name</label><input id="company" autocomplete="organization" required></div>
      <div class="row-2">
        <div class="field"><label for="phone">Phone</label><input id="phone" type="tel" autocomplete="tel" placeholder="03xx xxxxxxx"></div>
        <div class="field"><label for="plan">Plan</label><select id="plan"><option>Starter</option></select></div>
      </div>
      <div class="field"><label for="email">Work email</label><input id="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="new-password" minlength="8" required><span class="hint">At least 8 characters.</span></div>
      <button class="btn btn-block" type="submit">Create company</button>
    </form>
    <p class="auth-switch">Already using Veltrio? <a href="#/login">Log in</a></p>`);

  const f = document.getElementById('f');

  // Load plans (readable before login)
  sb.from('plans').select('name, max_branches, max_employees, trial_days').eq('is_active', true)
    .order('max_employees', { ascending: true, nullsFirst: false })
    .then(({ data }) => {
      if (!data || !data.length) return;
      f.plan.innerHTML = data.map((p) => {
        const lim = p.max_employees ? `up to ${p.max_branches} branches, ${p.max_employees} staff` : 'unlimited';
        return `<option value="${esc(p.name)}" ${p.name === 'Starter' ? 'selected' : ''}>${esc(p.name)} (${lim})</option>`;
      }).join('');
    });

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = {
      full_name: f.full_name.value.trim(), company: f.company.value.trim(), phone: f.phone.value.trim(),
      plan: f.plan.value, email: f.email.value.trim(), password: f.pw.value,
    };
    if (!v.full_name || !v.company || !v.email) return showAlert(f, 'Fill in your name, company name and email.');
    if (v.password.length < 8) return showAlert(f, 'Password must be at least 8 characters.');

    const btn = f.querySelector('button');
    busy(btn, true, 'Creating company…');
    state.signingUp = true;
    const { data, error } = await sb.auth.signUp({
      email: v.email, password: v.password,
      options: {
        emailRedirectTo: location.origin + location.pathname,
        data: { full_name: v.full_name, company_name: v.company, phone: v.phone, plan: v.plan },
      },
    });
    if (error) { state.signingUp = false; busy(btn, false); return showAlert(f, friendlyError(error)); }

    if (!data.session) {
      state.signingUp = false;
      // Email confirmation is on: company is created after the first login
      busy(btn, false);
      state.notice = `Almost done. We sent a confirmation link to ${v.email}. Open it, then log in here.`;
      return go('login');
    }
    state.session = data.session;
    try {
      await registerCompany(v);
      await loadProfile();
    } catch (err) {
      // Login exists but company failed: the setup screen lets them retry
      state.profile = undefined;
    }
    state.signingUp = false;
    go('dashboard');
  });
}

async function registerCompany(v) {
  const { error } = await sb.rpc('register_company', {
    p_company_name: v.company, p_company_email: v.email,
    p_full_name: v.full_name, p_phone: v.phone || null, p_plan_name: v.plan || 'Starter',
  });
  if (error) throw error;
}

function viewCompanySetup() {
  const u = state.session.user, m = u.user_metadata || {};
  app.innerHTML = `
  <div class="center-page"><div class="center-card">
    <span class="logo">${LOGO} Veltrio</span>
    <h2>Set up your company</h2>
    <p class="sub">Your login is ready. Add your company details to start the free trial.</p>
    <form id="f" novalidate>
      <div class="field"><label for="full_name">Your name</label><input id="full_name" value="${esc(m.full_name)}" required></div>
      <div class="field"><label for="company">Company name</label><input id="company" value="${esc(m.company_name)}" required></div>
      <div class="field"><label for="phone">Phone</label><input id="phone" type="tel" value="${esc(m.phone)}"></div>
      <button class="btn btn-block" type="submit">Create company</button>
    </form>
    <p class="auth-switch"><a href="#" id="out">Log out</a></p>
  </div></div>`;

  document.getElementById('out').onclick = (e) => { e.preventDefault(); sb.auth.signOut(); };
  const f = document.getElementById('f');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = { full_name: f.full_name.value.trim(), company: f.company.value.trim(), phone: f.phone.value.trim(), email: u.email, plan: m.plan };
    if (!v.full_name || !v.company) return showAlert(f, 'Fill in your name and company name.');
    const btn = f.querySelector('button');
    busy(btn, true, 'Creating company…');
    try {
      await registerCompany(v);
      await loadProfile();
      go('dashboard');
    } catch (err) {
      busy(btn, false);
      showAlert(f, friendlyError(err));
    }
  });
}

function viewNotice(title, text) {
  app.innerHTML = `
  <div class="center-page"><div class="center-card">
    <span class="logo">${LOGO} Veltrio</span>
    <h2>${esc(title)}</h2>
    <p class="sub">${esc(text)}</p>
    <button class="btn btn-ghost" id="out">Log out</button>
  </div></div>`;
  document.getElementById('out').onclick = () => sb.auth.signOut();
}

// ---------------------------------------------------------------
// App shell
// ---------------------------------------------------------------
function shell(current, inner) {
  const p = state.profile, isSuper = p.role === 'super_admin';
  const nav = isSuper ? ADMIN_NAV : COMPANY_NAV;
  const chip = isSuper
    ? `<strong>Veltrio admin</strong><span>All companies</span>`
    : `<strong>${esc(state.company?.name || 'Your company')}</strong><span>${esc(state.sub?.plans?.name || '')}${state.sub ? ' plan' : ''}</span>`;
  return `
  <div class="shell" id="shell">
    <aside class="side">
      <a class="logo" href="#/dashboard">${LOGO} Veltrio</a>
      <div class="company-chip">${chip}</div>
      <nav class="nav" aria-label="Main">
        ${nav.map(([k, label]) => `<a href="#/${k}" class="${k === current ? 'active' : ''}" ${k === current ? 'aria-current="page"' : ''}>${icon(k === 'dashboard' && isSuper ? 'dashboard' : k)}${label}</a>`).join('')}
      </nav>
      <div class="side-foot">
        <div class="who">${esc(p.full_name)}</div>
        <div class="role">${esc(ROLE_NAMES[p.role] || p.role)}</div>
        <button id="out" type="button">Log out</button>
      </div>
    </aside>
    <div class="maincol">${planBanner(isSuper, current)}<main class="main" id="main">${inner}</main></div>
  </div>`;
}

// Plan ended or company suspended: tell the company admin on every page
function planBanner(isSuper, current) {
  if (isSuper || !state.sub) return '';
  const ended = state.company?.status === 'suspended' || state.company?.status === 'expired' || state.sub.end_date < today();
  if (!ended) return '';
  const why = state.company?.status === 'suspended' ? 'Your company is suspended by Veltrio.' : 'Your plan has ended.';
  return `<div class="banner bad"><span>${why} Staff cannot use the app until it is renewed.</span>${current === 'settings' ? '' : '<a class="btn btn-sm" href="#/settings?pay=1">Renew plan</a>'}</div>`;
}

function bindShell() {
  document.getElementById('out').onclick = () => sb.auth.signOut();
  document.querySelectorAll('[data-menu]').forEach((b) => b.onclick = () => document.getElementById('shell').classList.toggle('open'));
  document.querySelectorAll('.nav a').forEach((a) => a.addEventListener('click', () => document.getElementById('shell').classList.remove('open')));
}

const topbar = (title, sub) => `
  <div class="topbar">
    <div>
      <button class="btn btn-ghost menu-btn" data-menu type="button" aria-label="Open menu">Menu</button>
      <h1>${esc(title)}</h1>
      ${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
    </div>
  </div>`;

// ---------------------------------------------------------------
// Company dashboard
// ---------------------------------------------------------------
async function viewCompanyDashboard() {
  const greet = `Hello, ${state.profile.full_name.split(' ')[0]}`;
  app.innerHTML = shell('dashboard', topbar(greet, 'Here is your company today.') + '<div class="panel"><p class="sub">Loading figures…</p></div>');
  bindShell();

  const t = today(), cid = state.profile.company_id, plan = state.sub?.plans || {};
  let d;
  try {
    const [branches, employees, products, checkedIn, closings] = await Promise.all([
      count('branches', (q) => q.eq('company_id', cid).eq('is_active', true)),
      count('employees', (q) => q.eq('company_id', cid).eq('status', 'active')),
      count('products', (q) => q.eq('company_id', cid).eq('is_active', true)),
      count('attendance', (q) => q.eq('company_id', cid).eq('attendance_date', t)),
      sb.from('daily_closings').select('total_amount').eq('company_id', cid).eq('closing_date', t),
    ]);
    if (closings.error) throw closings.error;
    const rows = closings.data || [];
    d = { branches, employees, products, checkedIn, closingCount: rows.length,
          closingTotal: rows.reduce((s, r) => s + Number(r.total_amount || 0), 0) };
  } catch (err) {
    document.getElementById('main').innerHTML = topbar(greet) + `<div class="alert alert-error" role="alert">Could not load figures: ${esc(friendlyError(err))}</div>`;
    bindShell();
    return;
  }

  let banner = '';
  if (state.sub && state.sub.status === 'trial') {
    const left = daysLeft(state.sub.end_date);
    banner = `<div class="banner"><span>${left > 0 ? `Free trial: ${left} day${left === 1 ? '' : 's'} left` : 'Your free trial has ended'}</span><span>Upgrade from Settings when you are ready.</span></div>`;
  }

  const lim = (n) => (n ? `<small> / ${n}</small>` : '');
  const steps = [
    ['Add your branches', 'Shop name, address and location for GPS check-in.', d.branches > 0, 'branches'],
    ['Add employees', 'Staff details, salary and their app login.', d.employees > 0, 'employees'],
    ['Add products', 'Products and prices for the daily sales closing.', d.products > 0, 'products'],
    ['Staff start using the app', 'Employees check in and submit their closing from the phone.', d.checkedIn > 0, 'attendance'],
  ];
  const doneAll = steps.every((s) => s[2]);

  document.getElementById('main').innerHTML = `
    ${topbar(greet, new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()))}
    ${banner}
    <section class="stats" aria-label="Today at a glance">
      <div class="stat"><div class="label">Checked in today</div><div class="value">${d.checkedIn}<small> / ${d.employees}</small></div><div class="foot">active employees</div></div>
      <div class="stat"><div class="label">Today's sales closing</div><div class="value">${money(d.closingTotal)}</div><div class="foot">${d.closingCount} closing${d.closingCount === 1 ? '' : 's'} submitted</div></div>
      <div class="stat"><div class="label">Branches</div><div class="value">${d.branches}${lim(plan.max_branches)}</div><div class="foot">${plan.max_branches ? (plan.custom ? 'allowed for your account' : 'allowed now') : 'active'}</div></div>
      <div class="stat"><div class="label">Employees</div><div class="value">${d.employees}${lim(plan.max_employees)}</div><div class="foot">${plan.max_employees ? (plan.custom ? 'allowed for your account' : 'allowed now') : 'active'}</div></div>
    </section>
    ${doneAll ? '' : `
    <section class="panel">
      <h2>Get your company running</h2>
      <p class="sub">Finish these in order and your staff can start checking in.</p>
      <ol class="steps">
        ${steps.map(([t1, t2, done, link], i) => `
          <li class="${done ? 'done' : ''}">
            <span class="n" aria-hidden="true">${done ? '✓' : i + 1}</span>
            <div><div class="t">${t1}${done ? '<span class="sr-only"> (done)</span>' : ''}</div><div class="d">${t2}</div></div>
            ${done ? '' : `<a class="btn btn-ghost" href="#/${link}">Open</a>`}
          </li>`).join('')}
      </ol>
    </section>`}`;
  bindShell();
}

// ---------------------------------------------------------------
// Pages that arrive in later parts
// ---------------------------------------------------------------
function viewComing(key) {
  const [title, text, part] = COMING[key];
  app.innerHTML = shell(key, topbar(title) + `
    <section class="panel"><div class="empty">
      <h2>Coming in the next update</h2>
      <p>${esc(text)}</p>
      <p class="hint">Part ${part}</p>
    </div></section>`);
  bindShell();
}

// ---------------------------------------------------------------
// Router
// ---------------------------------------------------------------
let rendering = false, again = false;
async function render() {
  if (rendering) { again = true; return; }
  rendering = true;
  try {
    if (!configured) return viewNotConfigured();
    const r = route();

    if (state.recovery) {
      if (state.session) return viewResetPassword();
      state.recovery = false;
      state.linkErrorShown = true;
      history.replaceState(null, '', location.pathname + '#/login');
      return viewLinkProblem(/expired|invalid/i.test(LINK_ERROR || 'expired')
        ? 'The reset link has expired or was already used. Links work once and only for a short time.'
        : LINK_ERROR);
    }
    if (LINK_ERROR && !state.linkErrorShown) {
      state.linkErrorShown = true;
      history.replaceState(null, '', location.pathname + '#/login');
      if (!state.session) return viewLinkProblem('The link from your email has expired or was already used.');
    }

    if (!state.session) {
      state.profile = undefined;
      if (r === 'signup') return viewSignup();
      if (r === 'forgot') return viewForgot();
      return viewLogin();
    }
    if (state.profile === undefined) await loadProfile();

    const p = state.profile;
    if (!p) return viewCompanySetup();
    if (!p.is_active) return viewNotice('Your account is switched off', 'Ask your company admin to switch it back on.');
    if (p.role === 'employee') return viewNotice('Use the Veltrio app', 'This panel is for admins and managers. Employees check in and submit closings from the Veltrio mobile app.');

    const isSuper = p.role === 'super_admin';
    const allowed = (isSuper ? ADMIN_NAV : COMPANY_NAV).map((n) => n[0]);
    if (r === 'login' || r === 'signup' || r === 'forgot' || !allowed.includes(r)) { location.hash = '#/dashboard'; return; }

    if (r === 'dashboard') return isSuper ? admin.viewOverview() : viewCompanyDashboard();
    if (isSuper && r === 'companies') return admin.viewCompanies();
    if (isSuper && r === 'payments') return admin.viewPayments();
    if (isSuper && r === 'plans') return admin.viewPlans();
    if (r === 'branches') return pages.viewBranches(query().get('edit'));
    if (r === 'settings') return pages.viewSettings();
    if (r === 'employees') return employees.viewEmployees(query().get('edit'));
    if (r === 'leave') return leave.viewLeave(query().get('tab'));
    if (r === 'products') return reports.viewProducts();
    if (r === 'attendance') return reports.viewAttendance(query().get('tab'));
    if (r === 'closings') return reports.viewClosings(query().get('tab'));
    if (r === 'payroll') return payroll.viewPayroll(query().get('tab'), query().get('month'));
    return viewComing(r);
  } catch (err) {
    console.error(err);
    viewNotice('Something went wrong', friendlyError(err));
  } finally {
    rendering = false;
    if (again) { again = false; render(); }
  }
}

const admin = initAdminPages({ sb, state, shell, bindShell, esc, busy, friendlyError, today });
const pages = initSetupPages({ sb, state, shell, topbar, bindShell, esc, busy, friendlyError, can, reloadPerms, billing: admin, reloadProfile: () => loadProfile() });
const employees = initEmployeesPage({ sb, state, shell, bindShell, esc, busy, friendlyError, today, can });
const leave = initLeavePage({ sb, state, shell, bindShell, esc, busy, friendlyError, today, can });
const reports = initReportPages({ sb, state, shell, bindShell, esc, busy, friendlyError, today, can });
const payroll = initPayrollPage({ sb, state, shell, bindShell, esc, busy, friendlyError, today, can });

window.addEventListener('hashchange', (e) => {
  // In-page section links (#s-shifts) on the settings page are not routes
  if (/^#s-/.test(location.hash)) {
    const el = document.getElementById(location.hash.slice(1));
    history.replaceState(null, '', e.oldURL);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  render();
});

if (configured) {
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  sb.auth.onAuthStateChange((event, session) => {
    const changedUser = (session?.user?.id || null) !== (state.session?.user?.id || null);
    state.session = session;
    if (event === 'PASSWORD_RECOVERY') { state.recovery = true; return render(); }
    if (state.signingUp) return;
    if (changedUser || event === 'SIGNED_OUT') {
      state.profile = undefined;
      if (!session) location.hash = '#/login';
      render();
    }
  });
}
render();
