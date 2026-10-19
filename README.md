# Veltrio admin panel

Static web app (no build step). Hosted on Vercel, data in Supabase.

- `index.html`, `styles.css`, `app.js` - core panel (login, signup, forgot password, dashboard)
- `setup-pages.js` - Branches and Settings pages
- `employees-page.js` - Employees page and staff app logins
- `leave-page.js` - Leave requests, approvals, balances, rules, leave types and holidays
- `payroll-page.js` - Payroll, payslips (print and CSV), advances and payroll rules
- `reports-pages.js` - Products (with Excel import), Attendance (daily, report, mark by hand), Sales closing (report, by branch, by product, corrections)
- `admin-pages.js` - Veltrio admin (overview, companies, payments, plans, payment details) and the company plan and payments section in Settings
- `staff.html`, `staff.js`, `staff.css`, `staff-sw.js`, `staff.webmanifest`, `icon-*.png` - Veltrio Staff app for employees (opens at /staff.html): check in/out with GPS and selfie, store visits, closing, corrections, leave, payslips
- `config.js` - Supabase URL and publishable key (edit the key here)
- `supabase/functions/staff-login/index.ts` - Edge Function that creates staff logins (deploy in Supabase)

Part 7.1: login, company signup with free trial, company setup, dashboard, Veltrio admin overview.
Part 7.2: branches with map location and check-in radius, company settings, attendance rules, shifts, departments, designations, plan.
Part 7.3: employees, shifts per employee, pay, duty at another branch, staff logins (Staff ID = company code + employee code).
Part 7.4: per-company roles and permissions for HR and branch managers, salary in its own protected table, work types (fixed, floater, field staff with store visits).
Part 7.5: leave with company rules (approval flow, leave year, working or calendar days, weekly off, allow beyond balance), leave types, holidays, balances and adjustments.
Part 7.6: payroll with company rules (pay period start day, day rate basis, absent cut, late rule, overtime, advances), payslips with bonus and other deductions, finalize and reopen, print and CSV.
Part 7.7: products with Excel import, attendance daily view and report, sales closing report with corrections (employee request or direct by manager).
Part 8: employee app at /staff.html (installable web app), private selfie storage, selfie thumbnails in attendance.
Part 9: Veltrio admin panel, company payments with screenshot, approval extends the plan, plan-ended banner.
