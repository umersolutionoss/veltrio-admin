// =============================================================
//  Veltrio admin panel - Part 7.2
//  Branches (map location, radius, hours, manager) and Settings
//  (company details, attendance rules, shifts, departments,
//  designations, plan)
// =============================================================

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const DEFAULT_CENTER = [31.5204, 74.3587]; // Lahore
const TIME_ZONES = ['Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Kolkata', 'Asia/Dhaka', 'Europe/London'];

export function initSetupPages(ctx) {
  const { sb, state, shell, topbar, bindShell, esc, busy, friendlyError } = ctx;

  // -------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------
  const role = () => state.profile.role;
  const canManage = () => ['company_admin', 'hr'].includes(role());
  const isCompanyAdmin = () => role() === 'company_admin';
  const cid = () => state.profile.company_id;

  function dbError(err, what = 'item') {
    const m = (err && err.message) || String(err);
    if (err && err.code === '23505') return `A ${what} with this name already exists. Use a different name.`;
    if (/row-level security|permission denied/i.test(m)) return 'You do not have permission to make this change. Ask your company admin.';
    if (/foreign key/i.test(m)) return `This ${what} is still in use, so it cannot be removed.`;
    return friendlyError(err);
  }

  const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
  function time12(t) {
    if (!t) return '';
    const [h, m] = String(t).split(':').map(Number);
    const ap = h >= 12 ? 'pm' : 'am';
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ap}`;
  }
  const num = (v) => (v === '' || v == null ? null : Number(v));

  function toast(msg, kind = 'ok') {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.className = 'toast toast-' + kind;
    t.textContent = msg;
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.add('hide'), 2600);
  }

  function formAlert(form, msg, kind = 'error') {
    let box = form.querySelector(':scope > .alert');
    if (!box) { box = document.createElement('div'); form.prepend(box); }
    box.className = 'alert alert-' + kind;
    box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    box.textContent = msg;
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function page(key, title, sub, actions, body) {
    app().innerHTML = shell(key, `
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
  const app = () => document.getElementById('app');
  const loadingBody = '<div class="panel"><p class="sub">Loading…</p></div>';
  const errorBody = (err) => `<div class="alert alert-error" role="alert">Could not load this page: ${esc(friendlyError(err))}</div>`;

  // Parse "31.52, 74.35", Google Maps links (@lat,lng / q=lat,lng / !3dlat!4dlng)
  function parseCoords(text) {
    const s = decodeURIComponent(String(text || '').trim());
    const pats = [
      /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
      /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
      /[?&](?:q|ll|query|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
      /^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/,
    ];
    for (const p of pats) {
      const m = s.match(p);
      if (m) {
        const lat = Number(m[1]), lng = Number(m[2]);
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return [lat, lng];
      }
    }
    return null;
  }

  let leafletPromise = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = LEAFLET_CSS;
      document.head.appendChild(css);
      const js = document.createElement('script');
      js.src = LEAFLET_JS;
      js.onload = () => resolve(window.L);
      js.onerror = () => { leafletPromise = null; reject(new Error('Map could not load')); };
      document.head.appendChild(js);
    });
    return leafletPromise;
  }

  async function loadSettings() {
    const { data, error } = await sb.from('company_settings').select('*').eq('company_id', cid()).maybeSingle();
    if (error) throw error;
    return data || { default_geofence_radius_m: 100, late_grace_minutes: 10, selfie_required: true, allow_price_edit: false, timezone: 'Asia/Karachi', currency: 'PKR' };
  }

  // =============================================================
  // BRANCHES
  // =============================================================
  async function viewBranches(editId) {
    page('branches', 'Branches', '', '', loadingBody);
    let branches, employees, settings;
    try {
      const [b, e, s] = await Promise.all([
        sb.from('branches').select('*').eq('company_id', cid()).order('name'),
        sb.from('employees').select('id, full_name, employee_code').eq('company_id', cid()).eq('status', 'active').order('full_name'),
        loadSettings(),
      ]);
      if (b.error) throw b.error;
      if (e.error) throw e.error;
      branches = b.data || []; employees = e.data || []; settings = s;
    } catch (err) {
      return page('branches', 'Branches', '', '', errorBody(err));
    }

    if (editId) {
      const branch = editId === 'new' ? null : branches.find((x) => x.id === editId);
      if (editId !== 'new' && !branch) { location.hash = '#/branches'; return; }
      return branchEditor(branch, employees, settings);
    }

    const active = branches.filter((b) => b.is_active).length;
    const max = state.sub?.plans?.max_branches;
    const planName = state.sub?.plans?.name;
    const usage = max ? `${active} of ${max} branches used on your ${esc(planName)} plan.` : `${active} active branch${active === 1 ? '' : 'es'}.`;
    const full = max && active >= max;
    const addBtn = canManage()
      ? (full ? `<span class="hint">Branch limit reached. Upgrade your plan to add more.</span>`
              : `<a class="btn" href="#/branches?edit=new">Add branch</a>`)
      : '';
    const empName = (id) => employees.find((x) => x.id === id)?.full_name || '';
    const defR = settings.default_geofence_radius_m;

    const body = branches.length ? `
      <section class="panel flush">
        <div class="table-wrap"><table class="list">
          <thead><tr><th>Branch</th><th>Location</th><th>Check-in radius</th><th>Opening hours</th><th>Manager</th><th>Status</th>${canManage() ? '<th><span class="sr-only">Actions</span></th>' : ''}</tr></thead>
          <tbody>${branches.map((b) => {
            const hasLoc = b.latitude != null && b.longitude != null;
            return `<tr class="${b.is_active ? '' : 'muted-row'}">
              <td><b>${esc(b.name)}</b>${b.code ? ` <span class="code">${esc(b.code)}</span>` : ''}<div class="hint">${esc([b.address, b.city].filter(Boolean).join(', ')) || 'No address'}</div></td>
              <td>${hasLoc ? '<span class="pill pill-active">Set on map</span>' : '<span class="pill pill-trial">Missing</span>'}</td>
              <td class="num">${b.geofence_radius_m ?? defR} m${b.geofence_radius_m == null ? ' <span class="hint">(default)</span>' : ''}</td>
              <td class="num">${b.opening_time ? `${time12(b.opening_time)} to ${time12(b.closing_time)}` : '<span class="hint">Not set</span>'}</td>
              <td>${esc(empName(b.manager_employee_id)) || '<span class="hint">None</span>'}</td>
              <td>${b.is_active ? '<span class="pill pill-active">Open</span>' : '<span class="pill pill-expired">Closed</span>'}</td>
              ${canManage() ? `<td class="right"><a class="btn btn-ghost btn-sm" href="#/branches?edit=${b.id}">Edit</a></td>` : ''}
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </section>
      ${branches.some((b) => b.is_active && b.latitude == null) ? '<p class="note">Employees cannot check in at a branch until its location is set on the map.</p>' : ''}` : `
      <section class="panel"><div class="empty">
        <h2>Add your first branch</h2>
        <p>Each shop needs a location so employees can check in only when they are there.</p>
        ${canManage() ? '<a class="btn" href="#/branches?edit=new">Add branch</a>' : ''}
      </div></section>`;

    page('branches', 'Branches', usage, addBtn, body);
  }

  function branchEditor(b, employees, settings) {
    const isNew = !b;
    b = b || { is_active: true };
    const title = isNew ? 'Add branch' : `Edit ${b.name}`;
    const defR = settings.default_geofence_radius_m || 100;

    page('branches', title, '<a href="#/branches">Back to branches</a>', '', `
      <form id="bf" class="editor" novalidate>
        <div class="editor-grid">
          <section class="panel">
            <h2>Branch details</h2>
            <div class="row-2">
              <div class="field"><label for="name">Branch name</label><input id="name" required value="${esc(b.name)}" placeholder="Iqbal Town"></div>
              <div class="field"><label for="code">Code <span class="opt">optional</span></label><input id="code" value="${esc(b.code)}" placeholder="IQT"></div>
            </div>
            <div class="field"><label for="address">Address</label><input id="address" value="${esc(b.address)}" placeholder="Shop 12, Main Boulevard"></div>
            <div class="field"><label for="city">City</label><input id="city" value="${esc(b.city)}" placeholder="Lahore"></div>
            <div class="row-2">
              <div class="field"><label for="open">Opens at</label><input id="open" type="time" value="${esc(hhmm(b.opening_time))}"></div>
              <div class="field"><label for="close">Closes at</label><input id="close" type="time" value="${esc(hhmm(b.closing_time))}"></div>
            </div>
            <div class="field">
              <label for="manager">Branch manager</label>
              <select id="manager">
                <option value="">No manager</option>
                ${employees.map((e) => `<option value="${e.id}" ${e.id === b.manager_employee_id ? 'selected' : ''}>${esc(e.full_name)}${e.employee_code ? ` (${esc(e.employee_code)})` : ''}</option>`).join('')}
              </select>
              <span class="hint">${employees.length ? 'The manager sees this branch’s attendance and closings.' : 'You can choose a manager after adding employees.'}</span>
            </div>
            ${isNew ? '' : `
            <label class="check"><input type="checkbox" id="active" ${b.is_active ? 'checked' : ''}> Branch is open</label>
            <p class="hint">A closed branch is kept in reports, but nobody can check in there.</p>`}
          </section>

          <section class="panel">
            <h2>Check-in location</h2>
            <p class="sub">Employees can check in only inside the circle. Click the map or drag the pin to the shop entrance.</p>
            <div class="loc-tools">
              <button type="button" class="btn btn-ghost btn-sm" id="here">Use my current location</button>
              <div class="loc-search">
                <input id="find" placeholder="Search a place, or paste a Google Maps link" aria-label="Search a place or paste a Google Maps link">
                <button type="button" class="btn btn-ghost btn-sm" id="findBtn">Find</button>
              </div>
            </div>
            <div id="map" class="map" aria-label="Branch location map"><div class="map-msg">Loading map…</div></div>
            <div class="row-3">
              <div class="field"><label for="lat">Latitude</label><input id="lat" inputmode="decimal" value="${b.latitude ?? ''}"></div>
              <div class="field"><label for="lng">Longitude</label><input id="lng" inputmode="decimal" value="${b.longitude ?? ''}"></div>
              <div class="field"><label for="radius">Radius (metres)</label><input id="radius" type="number" min="20" max="2000" step="10" value="${b.geofence_radius_m ?? ''}" placeholder="${defR}"></div>
            </div>
            <span class="hint">Leave the radius empty to use the company default of ${defR} m. For a shop inside a mall, 50 to 100 m works well.</span>
          </section>
        </div>
        <div class="form-bar">
          <a class="btn btn-ghost" href="#/branches">Cancel</a>
          <button class="btn" type="submit">${isNew ? 'Add branch' : 'Save changes'}</button>
        </div>
      </form>`);

    const f = document.getElementById('bf');
    const latI = f.querySelector('#lat'), lngI = f.querySelector('#lng'), radI = f.querySelector('#radius');
    let map = null, marker = null, circle = null;
    const radius = () => Number(radI.value) || defR;

    function place(lat, lng, pan = true) {
      latI.value = Number(lat).toFixed(6);
      lngI.value = Number(lng).toFixed(6);
      if (!map) return;
      const ll = [Number(lat), Number(lng)];
      if (!marker) {
        const pin = L.divIcon({ className: 'pin', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 26] });
        marker = L.marker(ll, { draggable: true, icon: pin, keyboard: true, title: 'Branch location' }).addTo(map);
        marker.on('dragend', () => { const p = marker.getLatLng(); place(p.lat, p.lng, false); });
        circle = L.circle(ll, { radius: radius(), color: '#13737B', weight: 2, fillColor: '#13737B', fillOpacity: 0.12 }).addTo(map);
      } else {
        marker.setLatLng(ll); circle.setLatLng(ll);
      }
      if (pan) map.setView(ll, Math.max(map.getZoom(), 17));
    }

    loadLeaflet().then((L) => {
      const el = document.getElementById('map');
      if (!el) return;
      el.innerHTML = '';
      const has = b.latitude != null && b.longitude != null;
      map = L.map(el, { scrollWheelZoom: false }).setView(has ? [b.latitude, b.longitude] : DEFAULT_CENTER, has ? 17 : 12);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      map.on('click', (e) => place(e.latlng.lat, e.latlng.lng, false));
      if (has) place(b.latitude, b.longitude, false);
      setTimeout(() => map.invalidateSize(), 50);
    }).catch(() => {
      const el = document.getElementById('map');
      if (el) el.innerHTML = '<div class="map-msg">The map could not load. Type the latitude and longitude below, or paste a Google Maps link above.</div>';
    });

    const syncFromInputs = () => {
      const lat = Number(latI.value), lng = Number(lngI.value);
      if (latI.value && lngI.value && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) place(lat, lng);
    };
    latI.addEventListener('change', syncFromInputs);
    lngI.addEventListener('change', syncFromInputs);
    radI.addEventListener('input', () => { if (circle) circle.setRadius(radius()); });

    f.querySelector('#here').onclick = (e) => {
      const btn = e.currentTarget;
      if (!navigator.geolocation) return formAlert(f, 'This browser cannot share your location. Search the place or paste a Google Maps link instead.');
      busy(btn, true, 'Finding you…');
      navigator.geolocation.getCurrentPosition(
        (pos) => { busy(btn, false); place(pos.coords.latitude, pos.coords.longitude); },
        () => { busy(btn, false); formAlert(f, 'Location permission was blocked. Allow location for this site, or search the place instead.'); },
        { enableHighAccuracy: true, timeout: 15000 });
    };

    const findI = f.querySelector('#find');
    async function find() {
      const q = findI.value.trim();
      if (!q) return;
      const c = parseCoords(q);
      if (c) return place(c[0], c[1]);
      if (/^https?:\/\//i.test(q)) {
        return formAlert(f, 'This link does not show coordinates. In Google Maps, long-press the shop, copy the numbers like 31.5204, 74.3587, and paste them here.');
      }
      const btn = f.querySelector('#findBtn');
      busy(btn, true, 'Finding…');
      try {
        const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } });
        const list = await r.json();
        if (!list.length) formAlert(f, `No place found for "${q}". Try a nearby landmark, or click the map.`);
        else place(Number(list[0].lat), Number(list[0].lon));
      } catch {
        formAlert(f, 'Search is not available right now. Click the map or paste coordinates instead.');
      } finally { busy(btn, false); }
    }
    f.querySelector('#findBtn').onclick = find;
    findI.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } });

    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = {
        name: f.querySelector('#name').value.trim(),
        code: f.querySelector('#code').value.trim() || null,
        address: f.querySelector('#address').value.trim() || null,
        city: f.querySelector('#city').value.trim() || null,
        opening_time: f.querySelector('#open').value || null,
        closing_time: f.querySelector('#close').value || null,
        manager_employee_id: f.querySelector('#manager').value || null,
        latitude: num(latI.value),
        longitude: num(lngI.value),
        geofence_radius_m: num(radI.value),
      };
      if (!isNew) v.is_active = f.querySelector('#active').checked;

      if (!v.name) return formAlert(f, 'Enter the branch name.');
      if ((v.latitude == null) !== (v.longitude == null) ||
          (v.latitude != null && (Number.isNaN(v.latitude) || Number.isNaN(v.longitude) || Math.abs(v.latitude) > 90 || Math.abs(v.longitude) > 180))) {
        return formAlert(f, 'The location is not valid. Click the map to set it again.');
      }
      if (v.geofence_radius_m != null && (v.geofence_radius_m < 20 || v.geofence_radius_m > 2000)) {
        return formAlert(f, 'Radius must be between 20 and 2000 metres.');
      }
      if ((v.opening_time == null) !== (v.closing_time == null)) {
        return formAlert(f, 'Set both the opening and closing time, or leave both empty.');
      }

      const btn = f.querySelector('button[type=submit]');
      busy(btn, true, 'Saving…');
      const res = isNew
        ? await sb.from('branches').insert({ ...v, company_id: cid() })
        : await sb.from('branches').update(v).eq('id', b.id);
      busy(btn, false);
      if (res.error) return formAlert(f, dbError(res.error, 'branch'));
      toast(isNew ? `${v.name} added` : 'Changes saved');
      location.hash = '#/branches';
    });
  }

  // =============================================================
  // SETTINGS
  // =============================================================
  async function viewSettings() {
    page('settings', 'Settings', '', '', loadingBody);
    let company, settings, shifts, departments, designations;
    try {
      const [c, s, sh, dp, dg] = await Promise.all([
        sb.from('companies').select('id, name, email, phone, address, city').eq('id', cid()).maybeSingle(),
        loadSettings(),
        sb.from('shifts').select('*').eq('company_id', cid()).order('start_time'),
        sb.from('departments').select('id, name').eq('company_id', cid()).order('name'),
        sb.from('designations').select('id, name').eq('company_id', cid()).order('name'),
      ]);
      for (const r of [c, sh, dp, dg]) if (r.error) throw r.error;
      company = c.data || {}; settings = s; shifts = sh.data || []; departments = dp.data || []; designations = dg.data || [];
    } catch (err) {
      return page('settings', 'Settings', '', '', errorBody(err));
    }

    const adminOnly = isCompanyAdmin() ? '' : 'disabled';
    const manage = canManage();
    const ro = isCompanyAdmin() ? '' : '<p class="note">Only the company admin can change this section.</p>';
    const sub = state.sub, plan = sub?.plans;
    const fmtDate = (d) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d + 'T00:00:00'));

    page('settings', 'Settings', 'Company details and the rules the mobile app follows.', '', `
      <nav class="subnav" aria-label="Settings sections">
        <a href="#s-company">Company</a><a href="#s-rules">Attendance rules</a><a href="#s-shifts">Shifts</a>
        <a href="#s-teams">Departments</a><a href="#s-plan">Plan</a>
      </nav>

      <section class="panel" id="s-company">
        <h2>Company</h2>
        <p class="sub">Shown on reports and payslips.</p>
        <form id="cf" novalidate>
          ${ro}
          <fieldset ${adminOnly}>
            <div class="row-2">
              <div class="field"><label for="c_name">Company name</label><input id="c_name" value="${esc(company.name)}" required></div>
              <div class="field"><label for="c_email">Email</label><input id="c_email" type="email" value="${esc(company.email)}" required></div>
            </div>
            <div class="row-2">
              <div class="field"><label for="c_phone">Phone</label><input id="c_phone" type="tel" value="${esc(company.phone)}"></div>
              <div class="field"><label for="c_city">City</label><input id="c_city" value="${esc(company.city)}"></div>
            </div>
            <div class="field"><label for="c_address">Head office address</label><input id="c_address" value="${esc(company.address)}"></div>
            <div class="form-end"><button class="btn" type="submit">Save company</button></div>
          </fieldset>
        </form>
      </section>

      <section class="panel" id="s-rules">
        <h2>Attendance and closing rules</h2>
        <p class="sub">The mobile app checks these on every check-in and closing.</p>
        <form id="rf" novalidate>
          ${ro}
          <fieldset ${adminOnly}>
            <div class="row-2">
              <div class="field"><label for="r_radius">Default check-in radius (metres)</label><input id="r_radius" type="number" min="20" max="2000" step="10" value="${settings.default_geofence_radius_m}"><span class="hint">Used for any branch without its own radius.</span></div>
              <div class="field"><label for="r_grace">Late after (minutes)</label><input id="r_grace" type="number" min="0" max="120" value="${settings.late_grace_minutes}"><span class="hint">Check-in this many minutes after shift start counts as late.</span></div>
            </div>
            <label class="check"><input type="checkbox" id="r_selfie" ${settings.selfie_required ? 'checked' : ''}> Selfie required at check-in and check-out</label>
            <label class="check"><input type="checkbox" id="r_price" ${settings.allow_price_edit ? 'checked' : ''}> Employees can change the product price in their closing</label>
            <p class="hint">When this is off, the app always uses the price set in Products.</p>
            <div class="field narrow"><label for="r_tz">Time zone</label>
              <select id="r_tz">${TIME_ZONES.concat(TIME_ZONES.includes(settings.timezone) ? [] : [settings.timezone]).map((z) => `<option ${z === settings.timezone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select>
            </div>
            <div class="form-end"><button class="btn" type="submit">Save rules</button></div>
          </fieldset>
        </form>
      </section>

      <section class="panel" id="s-shifts">
        <div class="panel-head">
          <div><h2>Shifts</h2><p class="sub">Working hours used to mark late arrivals and early leaving. You assign shifts to employees on their profile.</p></div>
          ${manage ? '<button class="btn btn-ghost btn-sm" type="button" id="addShift">Add shift</button>' : ''}
        </div>
        ${shifts.length ? `
        <div class="table-wrap"><table class="list">
          <thead><tr><th>Shift</th><th>Hours</th><th>Late after</th><th>Status</th>${manage ? '<th><span class="sr-only">Actions</span></th>' : ''}</tr></thead>
          <tbody>${shifts.map((s) => `
            <tr class="${s.is_active ? '' : 'muted-row'}">
              <td><b>${esc(s.name)}</b></td>
              <td class="num">${time12(s.start_time)} to ${time12(s.end_time)}${s.end_time < s.start_time ? ' <span class="hint">(next day)</span>' : ''}</td>
              <td class="num">${s.late_grace_minutes ?? settings.late_grace_minutes} min${s.late_grace_minutes == null ? ' <span class="hint">(default)</span>' : ''}</td>
              <td>${s.is_active ? '<span class="pill pill-active">In use</span>' : '<span class="pill pill-expired">Off</span>'}</td>
              ${manage ? `<td class="right"><button class="btn btn-ghost btn-sm" type="button" data-shift="${s.id}">Edit</button></td>` : ''}
            </tr>`).join('')}</tbody>
        </table></div>` : `<div class="empty small"><p>No shifts yet. Add one, for example Morning 10:00 am to 6:00 pm.</p></div>`}
      </section>

      <section class="panel" id="s-teams">
        <h2>Departments and designations</h2>
        <p class="sub">Used to group employees in reports.</p>
        <div class="two-lists">
          ${tagList('departments', 'Departments', departments, 'Sales, Accounts, Warehouse')}
          ${tagList('designations', 'Designations', designations, 'Sales Associate, Cashier, Supervisor')}
        </div>
      </section>

      <section class="panel" id="s-plan">
        <h2>Plan</h2>
        ${sub ? `
        <dl class="facts">
          <div><dt>Current plan</dt><dd>${esc(plan?.name || '')}</dd></div>
          <div><dt>Status</dt><dd>${sub.status === 'trial' ? 'Free trial' : esc(sub.status[0].toUpperCase() + sub.status.slice(1))}</dd></div>
          <div><dt>${sub.status === 'trial' ? 'Trial ends' : 'Renews on'}</dt><dd>${fmtDate(sub.end_date)}</dd></div>
          <div><dt>Limits</dt><dd>${plan?.max_branches ? `${plan.max_branches} branches, ${plan.max_employees} employees` : 'Unlimited branches and employees'}</dd></div>
        </dl>
        <p class="note">To upgrade or pay, contact Veltrio. Online payment arrives in a later update.</p>` : '<p class="sub">No plan found for this company. Contact Veltrio.</p>'}
      </section>

      <dialog id="dlg" class="dlg"></dialog>`);

    // Section links scroll inside the page instead of changing the route
    document.querySelectorAll('.subnav a').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById(a.getAttribute('href').slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));

    // ---- Company
    const cf = document.getElementById('cf');
    cf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = {
        name: cf.querySelector('#c_name').value.trim(), email: cf.querySelector('#c_email').value.trim(),
        phone: cf.querySelector('#c_phone').value.trim() || null, city: cf.querySelector('#c_city').value.trim() || null,
        address: cf.querySelector('#c_address').value.trim() || null,
      };
      if (!v.name || !v.email) return formAlert(cf, 'Company name and email are required.');
      const btn = cf.querySelector('button[type=submit]');
      busy(btn, true, 'Saving…');
      const { error } = await sb.from('companies').update(v).eq('id', cid());
      busy(btn, false);
      if (error) return formAlert(cf, dbError(error, 'company'));
      if (state.company) state.company.name = v.name;
      const chip = document.querySelector('.company-chip strong');
      if (chip) chip.textContent = v.name;
      formAlert(cf, 'Company saved.', 'ok');
    });

    // ---- Rules
    const rf = document.getElementById('rf');
    rf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = {
        default_geofence_radius_m: Number(rf.querySelector('#r_radius').value),
        late_grace_minutes: Number(rf.querySelector('#r_grace').value),
        selfie_required: rf.querySelector('#r_selfie').checked,
        allow_price_edit: rf.querySelector('#r_price').checked,
        timezone: rf.querySelector('#r_tz').value,
      };
      if (!(v.default_geofence_radius_m >= 20 && v.default_geofence_radius_m <= 2000)) return formAlert(rf, 'Radius must be between 20 and 2000 metres.');
      if (!(v.late_grace_minutes >= 0 && v.late_grace_minutes <= 120)) return formAlert(rf, 'Late after must be between 0 and 120 minutes.');
      const btn = rf.querySelector('button[type=submit]');
      busy(btn, true, 'Saving…');
      const { error } = await sb.from('company_settings').update(v).eq('company_id', cid());
      busy(btn, false);
      if (error) return formAlert(rf, dbError(error, 'setting'));
      formAlert(rf, 'Rules saved. The app uses them from the next check-in.', 'ok');
    });

    // ---- Shifts
    const dlg = document.getElementById('dlg');
    const openShift = (s) => {
      const isNew = !s; s = s || { is_active: true };
      dlg.innerHTML = `
        <form method="dialog" id="sf" novalidate>
          <h2>${isNew ? 'Add shift' : 'Edit shift'}</h2>
          <div class="field"><label for="s_name">Shift name</label><input id="s_name" value="${esc(s.name)}" placeholder="Morning" required></div>
          <div class="row-2">
            <div class="field"><label for="s_start">Starts</label><input id="s_start" type="time" value="${esc(hhmm(s.start_time))}" required></div>
            <div class="field"><label for="s_end">Ends</label><input id="s_end" type="time" value="${esc(hhmm(s.end_time))}" required></div>
          </div>
          <div class="field"><label for="s_grace">Late after (minutes) <span class="opt">optional</span></label><input id="s_grace" type="number" min="0" max="120" value="${s.late_grace_minutes ?? ''}" placeholder="${settings.late_grace_minutes}"><span class="hint">Leave empty to use the company rule.</span></div>
          ${isNew ? '' : `<label class="check"><input type="checkbox" id="s_active" ${s.is_active ? 'checked' : ''}> Shift is in use</label>`}
          <div class="dlg-bar"><button class="btn btn-ghost" value="cancel" formnovalidate>Cancel</button><button class="btn" value="save" id="s_save">${isNew ? 'Add shift' : 'Save shift'}</button></div>
        </form>`;
      dlg.showModal();
      const sf = dlg.querySelector('#sf');
      dlg.querySelector('#s_save').onclick = async (e) => {
        e.preventDefault();
        const v = {
          name: sf.querySelector('#s_name').value.trim(),
          start_time: sf.querySelector('#s_start').value, end_time: sf.querySelector('#s_end').value,
          late_grace_minutes: num(sf.querySelector('#s_grace').value),
        };
        if (!isNew) v.is_active = sf.querySelector('#s_active').checked;
        if (!v.name || !v.start_time || !v.end_time) return formAlert(sf, 'Enter the shift name, start and end time.');
        if (v.start_time === v.end_time) return formAlert(sf, 'Start and end time cannot be the same.');
        const btn = e.currentTarget;
        busy(btn, true, 'Saving…');
        const res = isNew
          ? await sb.from('shifts').insert({ ...v, company_id: cid() })
          : await sb.from('shifts').update(v).eq('id', s.id);
        busy(btn, false);
        if (res.error) return formAlert(sf, dbError(res.error, 'shift'));
        dlg.close();
        toast(isNew ? `${v.name} shift added` : 'Shift saved');
        reloadAt('s-shifts');
      };
    };
    document.getElementById('addShift')?.addEventListener('click', () => openShift(null));
    document.querySelectorAll('[data-shift]').forEach((b) => b.onclick = () => openShift(shifts.find((s) => s.id === b.dataset.shift)));

    // ---- Departments / designations
    document.querySelectorAll('form[data-tags]').forEach((form) => {
      const table = form.dataset.tags, what = table === 'departments' ? 'department' : 'designation';
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = form.querySelector('input'), name = input.value.trim();
        if (!name) return;
        const btn = form.querySelector('button');
        busy(btn, true, 'Adding…');
        const { error } = await sb.from(table).insert({ company_id: cid(), name });
        busy(btn, false);
        if (error) return formAlert(form, dbError(error, what));
        toast(`${name} added`);
        reloadAt('s-teams');
      });
    });
    document.querySelectorAll('[data-del]').forEach((btn) => {
      btn.onclick = async () => {
        const [table, id, name] = [btn.dataset.del, btn.dataset.id, btn.dataset.name];
        if (!confirm(`Remove "${name}"? Employees in it will show no ${table === 'departments' ? 'department' : 'designation'}.`)) return;
        const { error } = await sb.from(table).delete().eq('id', id);
        if (error) return toast(dbError(error), 'error');
        toast(`${name} removed`);
        reloadAt('s-teams');
      };
    });

    function tagList(table, label, rows, example) {
      return `
        <div class="tag-col">
          <h3>${label}</h3>
          ${rows.length ? `<ul class="tags">${rows.map((r) => `<li>${esc(r.name)}${manage ? `<button type="button" class="x" data-del="${table}" data-id="${r.id}" data-name="${esc(r.name)}" aria-label="Remove ${esc(r.name)}">×</button>` : ''}</li>`).join('')}</ul>`
            : `<p class="hint">None yet. For example: ${example}.</p>`}
          ${manage ? `<form class="tag-add" data-tags="${table}" novalidate>
            <input aria-label="New ${label.toLowerCase().slice(0, -1)} name" placeholder="New ${label.toLowerCase().slice(0, -1)}">
            <button class="btn btn-ghost btn-sm" type="submit">Add</button>
          </form>` : ''}
        </div>`;
    }
  }

  async function reloadAt(anchor) {
    await viewSettings();
    document.getElementById(anchor)?.scrollIntoView({ block: 'start' });
  }

  return { viewBranches, viewSettings, parseCoords };
}
