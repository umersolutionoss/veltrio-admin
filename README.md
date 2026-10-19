# Veltrio admin panel

Static web app (no build step). Hosted on Vercel, data in Supabase.

- `index.html`, `styles.css`, `app.js` - core panel (login, signup, forgot password, dashboard)
- `setup-pages.js` - Branches and Settings pages
- `employees-page.js` - Employees page and staff app logins
- `config.js` - Supabase URL and publishable key (edit the key here)
- `supabase/functions/staff-login/index.ts` - Edge Function that creates staff logins (deploy in Supabase)

Part 7.1: login, company signup with free trial, company setup, dashboard, Veltrio admin overview.
Part 7.2: branches with map location and check-in radius, company settings, attendance rules, shifts, departments, designations, plan.
Part 7.3: employees, shifts per employee, pay, duty at another branch, staff logins (Staff ID = company code + employee code).
Part 7.4: per-company roles and permissions for HR and branch managers, salary in its own protected table, work types (fixed, floater, field staff with store visits).
