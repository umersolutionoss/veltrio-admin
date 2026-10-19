// =====================================================================
//  Veltrio Edge Function: staff-login
//  Creates and manages app logins for employees.
//  Runs on Supabase servers, so the secret key never reaches a browser.
//
//  Actions (POST JSON):
//    { action: "create",         employee_id, password, role }
//    { action: "reset_password", employee_id, password }
//    { action: "set_active",     employee_id, active: true|false }
//    { action: "set_role",       employee_id, role }
//
//  Only a Company Admin or HR of the same company can call it.
//  HR can manage only employees and branch managers.
// =====================================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const STAFF_DOMAIN = 'staff.veltrio.app';
export const slug = (s: string) =>
  String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const staffEmail = (companyCode: string, employeeCode: string) =>
  `${slug(employeeCode)}.${slug(companyCode)}@${STAFF_DOMAIN}`;

const STAFF_ROLES = ['employee', 'branch_manager', 'hr'];
const canGrant = (callerRole: string, role: string) =>
  callerRole === 'company_admin' ? STAFF_ROLES.includes(role)
    : callerRole === 'hr' ? ['employee', 'branch_manager'].includes(role)
    : false;

class Fail extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

// deno-lint-ignore no-explicit-any
type Admin = any;

export async function handle(body: Record<string, unknown>, token: string, admin: Admin) {
  // ---- Who is calling?
  if (!token) throw new Fail('Please log in again.', 401);
  const { data: u, error: ue } = await admin.auth.getUser(token);
  if (ue || !u?.user) throw new Fail('Your session has expired. Please log in again.', 401);
  const callerId = u.user.id;

  const { data: caller } = await admin.from('users_profile')
    .select('id, role, company_id, is_active').eq('id', callerId).maybeSingle();
  if (!caller || !caller.is_active || !['company_admin', 'hr'].includes(caller.role)) {
    throw new Fail('Only a company admin or HR can manage staff logins.', 403);
  }

  // ---- Which employee?
  const employeeId = String(body.employee_id || '');
  const { data: emp } = await admin.from('employees')
    .select('id, company_id, user_id, employee_code, full_name, phone, status')
    .eq('id', employeeId).maybeSingle();
  if (!emp || emp.company_id !== caller.company_id) throw new Fail('Employee not found.', 404);

  const { data: company } = await admin.from('companies')
    .select('id, login_code, status').eq('id', caller.company_id).maybeSingle();
  if (!company) throw new Fail('Company not found.', 404);

  let target: { id: string; role: string; is_active: boolean } | null = null;
  if (emp.user_id) {
    const { data } = await admin.from('users_profile').select('id, role, is_active').eq('id', emp.user_id).maybeSingle();
    target = data;
  }
  const mustOwnTarget = () => {
    if (!emp.user_id || !target) throw new Fail('This employee has no app login yet.');
    if (emp.user_id === callerId) throw new Fail('You cannot change your own login here.');
    if (!canGrant(caller.role, target.role)) throw new Fail('Only the company admin can change an HR login.', 403);
  };
  const checkPassword = (p: unknown) => {
    const s = String(p || '');
    if (s.length < 6) throw new Fail('Password must be at least 6 characters.');
    return s;
  };

  const action = String(body.action || '');

  // ---- Create login
  if (action === 'create') {
    if (emp.user_id) throw new Fail('This employee already has an app login.');
    if (emp.status !== 'active') throw new Fail('Only active employees can get an app login.');
    if (!['trial', 'active'].includes(company.status)) throw new Fail('Your company subscription is not active.');
    const role = String(body.role || 'employee');
    if (!canGrant(caller.role, role)) throw new Fail('You cannot give this role.', 403);
    const password = checkPassword(body.password);
    const email = staffEmail(company.login_code, emp.employee_code);

    const { data: created, error: ce } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: emp.full_name, staff_id: `${company.login_code}-${emp.employee_code}` },
    });
    if (ce || !created?.user) {
      if (/already/i.test(ce?.message || '')) throw new Fail('A login with this staff ID already exists. Change the employee code and try again.');
      throw new Fail(ce?.message || 'Could not create the login.');
    }
    const newId = created.user.id;

    const { error: pe } = await admin.from('users_profile').insert({
      id: newId, company_id: caller.company_id, role, full_name: emp.full_name, phone: emp.phone, is_active: true,
    });
    const { error: ee } = pe ? { error: null } : await admin.from('employees').update({ user_id: newId }).eq('id', emp.id);
    if (pe || ee) {
      await admin.from('users_profile').delete().eq('id', newId);
      await admin.auth.admin.deleteUser(newId);
      throw new Fail('Could not link the login to this employee. Nothing was saved, please try again.');
    }
    return { ok: true, staff_id: `${company.login_code}-${emp.employee_code}`, role };
  }

  // ---- Reset password
  if (action === 'reset_password') {
    mustOwnTarget();
    const password = checkPassword(body.password);
    const { error } = await admin.auth.admin.updateUserById(emp.user_id, { password });
    if (error) throw new Fail(error.message);
    return { ok: true };
  }

  // ---- Turn login off / on
  if (action === 'set_active') {
    mustOwnTarget();
    const active = body.active === true;
    const { error } = await admin.auth.admin.updateUserById(emp.user_id, { ban_duration: active ? 'none' : '876000h' });
    if (error) throw new Fail(error.message);
    await admin.from('users_profile').update({ is_active: active }).eq('id', emp.user_id);
    return { ok: true, active };
  }

  // ---- Change role
  if (action === 'set_role') {
    mustOwnTarget();
    const role = String(body.role || '');
    if (!canGrant(caller.role, role)) throw new Fail('You cannot give this role.', 403);
    const { error } = await admin.from('users_profile').update({ role }).eq('id', emp.user_id);
    if (error) throw new Fail(error.message);
    return { ok: true, role };
  }

  throw new Fail('Unknown action.');
}

// ---------------------------------------------------------------------
// Supabase runtime entry point
// ---------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D) {
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  let secret = D.env.get('SUPABASE_SERVICE_ROLE_KEY');
  try { secret = JSON.parse(D.env.get('SUPABASE_SECRET_KEYS') || '{}').default || secret; } catch { /* keep legacy key */ }
  const admin = createClient(D.env.get('SUPABASE_URL'), secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  D.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
    try {
      if (req.method !== 'POST') throw new Fail('Use POST.', 405);
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const body = await req.json().catch(() => ({}));
      return json(await handle(body, token, admin));
    } catch (e) {
      const status = e instanceof Fail ? e.status : 500;
      if (status === 500) console.error(e);
      return json({ error: e instanceof Fail ? e.message : 'Something went wrong on the server. Please try again.' }, status);
    }
  });
}
