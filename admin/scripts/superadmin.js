/* ══════════════════════════════════════════════════════════════════
   superadmin.js — Super Admin Console (LIVE FIREBASE)

   Reads/writes the same Realtime Database nodes the kiosk, TV, and
   department dashboards already use:
     - admins        → staff accounts (department + window + role)
     - superAdmins   → super admin accounts (this console's own login)
     - queue         → every ticket issued (department, status, ...)
     - lanes         → live per-window state (serving, calledCount,
                        skippedCount, department, windowNumber)
     - presence      → which lane/admin is currently online
   ══════════════════════════════════════════════════════════════════ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, get, set, push, remove, update, onValue
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { firebaseConfig, DEFAULT_ADMINS, DEFAULT_SUPERADMINS } from "../admin-config.js";

/* ── Firebase init ── */
let db, useFirebase = false;
try {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  useFirebase = firebaseConfig.apiKey !== 'YOUR_API_KEY';
} catch (e) {}

/* ── Department / window configuration (matches kiosk.js & tv_1.js) ── */
const DEPARTMENTS = {
  registrar:   { label: 'Registrar',            prefix: 'R', windows: 7, color: 'navy'   },
  accounting:  { label: 'Accounting Office',     prefix: 'A', windows: 4, color: 'teal'   },
  scholarship: { label: 'Scholarship & Grants',  prefix: 'S', windows: 3, color: 'violet' },
};

const laneId = username => 'lane_' + username.replace(/\s+/g, '_');

/* ── Live state ── */
let admins      = [];  // [{ username, password, role, department, window, _key }]
let superAdmins = [];  // [{ username, password, _key }]
let queue       = [];  // all queue tickets
let lanes       = {};  // per-window live state
let presence    = {};  // per-lane online/offline

let bootReady = false;  // true once superAdmins has been loaded (or failed)
let bootError = null;   // set if loading superAdmins threw (e.g. permission-denied)

/* ══════════════════════ AUTH ══════════════════════ */

async function loadSuperAdmins() {
  if (!useFirebase) { superAdmins = DEFAULT_SUPERADMINS.slice(); return; }
  const snap = await get(ref(db, 'superAdmins'));
  if (!snap.val()) {
    const obj = DEFAULT_SUPERADMINS.reduce((a, v, i) => (a[i] = v, a), {});
    await set(ref(db, 'superAdmins'), obj);
    superAdmins = DEFAULT_SUPERADMINS.map((v, i) => ({ ...v, _key: String(i) }));
  } else {
    superAdmins = Object.entries(snap.val()).map(([k, v]) => ({ ...v, _key: k }));
  }
  onValue(ref(db, 'superAdmins'), s => {
    const val = s.val() || {};
    superAdmins = Object.entries(val).map(([k, v]) => ({ ...v, _key: k }));
  });
}

function setLoginBoxState() {
  const btn   = document.getElementById('login-submit-btn');
  const errEl = document.getElementById('login-error');
  if (!btn || !errEl) return;

  if (!bootReady) {
    btn.disabled = true;
    btn.textContent = 'Connecting to Firebase…';
    return;
  }

  btn.disabled = false;
  btn.textContent = 'Sign In';

  if (bootError) {
    errEl.textContent = bootError;
    errEl.classList.add('show');
  }
}

window.doLogin = function () {
  const errEl = document.getElementById('login-error');

  if (!bootReady) {
    errEl.textContent = 'Still connecting to Firebase — try again in a moment.';
    errEl.classList.add('show');
    return;
  }
  if (bootError) {
    errEl.textContent = bootError;
    errEl.classList.add('show');
    return;
  }

  const u = document.getElementById('login-user').value.trim();
  const p = document.getElementById('login-pass').value;
  const found = superAdmins.find(a => a.username === u && a.password === p);

  if (found) {
    sessionStorage.setItem('superadmin_session', u);
    errEl.classList.remove('show');
    showDash(u);
  } else {
    errEl.textContent = 'Incorrect username or password.';
    errEl.classList.add('show');
  }
};

window.doLogout = function () {
  sessionStorage.removeItem('superadmin_session');
  document.getElementById('dash-view').style.display = 'none';
  document.getElementById('login-view').style.display = 'flex';
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
};

function showDash(username) {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('dash-view').style.display = 'block';
  document.getElementById('admin-user-lbl').textContent = username;
  renderAdminsTable();
  refreshAnalytics();
}

/* ══════════════════════ BOOTSTRAP ══════════════════════ */

async function bootstrap() {
  try {
    await loadSuperAdmins();

    if (useFirebase) {
      // Seed `admins` (shared with the department dashboards) if empty.
      const seedSnap = await get(ref(db, 'admins'));
      if (!seedSnap.val()) {
        const obj = DEFAULT_ADMINS.reduce((a, v, i) => (a[i] = v, a), {});
        await set(ref(db, 'admins'), obj);
      }

      onValue(ref(db, 'admins'), snap => {
        const val = snap.val() || {};
        admins = Object.entries(val).map(([k, v]) => ({ ...v, _key: k }));
        renderAdminsTable();
        refreshAnalytics();
      });

      onValue(ref(db, 'queue'), snap => {
        queue = snap.val() ? Object.entries(snap.val()).map(([k, v]) => ({ ...v, _key: k })) : [];
        refreshAnalytics();
      });

      onValue(ref(db, 'lanes'), snap => {
        lanes = snap.val() || {};
        refreshAnalytics();
      });

      onValue(ref(db, 'presence'), snap => {
        presence = snap.val() || {};
        renderAdminsTable();
        refreshAnalytics();
      });
    }
  } catch (err) {
    // Most common cause: Firebase security rules only allow the paths the
    // department dashboards already use (admins/queue/lanes/presence/...)
    // and default-deny anything new — including `superAdmins`. If that's
    // the case, add a rule for "superAdmins" (and "admins" writes, for
    // Add/Remove Admin) alongside your existing rules.
    const code = err?.code || '';
    if (code.includes('PERMISSION_DENIED') || code.includes('permission-denied')) {
      bootError = 'Firebase permission denied on "superAdmins". Your database security rules need a rule allowing read/write on this path (see console for details).';
    } else {
      bootError = 'Could not connect to Firebase: ' + (err?.message || 'unknown error') + ' (see console for details).';
    }
    console.error('[superadmin] bootstrap failed:', err);
  }

  bootReady = true;
  setLoginBoxState();

  const existing = sessionStorage.getItem('superadmin_session');
  const validSession = !bootError && existing && superAdmins.find(a => a.username === existing);
  if (validSession) showDash(existing);
}
bootstrap();

/* ── Tabs ── */
window.switchTab = function (tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  if (tab === 'admins') renderAdminsTable();
  if (tab === 'overview') refreshAnalytics();
};

/* ══════════════════════ ADMIN ACCOUNTS TAB ══════════════════════ */

function renderAdminsTable() {
  const tbody = document.getElementById('admins-tbody');
  if (!tbody) return; // not logged in yet

  if (!admins.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="admins-empty">No admin profiles yet. Click "+ Add Admin" to create one.</td></tr>`;
    return;
  }

  const order = { registrar: 0, accounting: 1, scholarship: 2 };
  const sorted = admins.slice().sort((a, b) =>
    (order[a.department] - order[b.department]) || ((a.window || 1) - (b.window || 1))
  );

  tbody.innerHTML = sorted.map(a => {
    const dept = DEPARTMENTS[a.department] || { label: a.department };
    const lid = laneId(a.username);
    const online = presence[lid]?.online === true;
    return `
    <tr>
      <td><span class="win-status-pill ${online ? 'online' : 'offline'}"><span class="d"></span>${online ? 'Online' : 'Offline'}</span></td>
      <td>${escapeHtml(a.username)}</td>
      <td><span class="dept-tag ${a.department}">${dept.label}</span></td>
      <td>Window ${a.window || 1}</td>
      <td>${escapeHtml(a.role || 'Staff')}</td>
      <td><button class="remove-btn" onclick="removeAdmin('${a._key}')">Remove</button></td>
    </tr>`;
  }).join('');
}

/* Add Admin modal */
window.openAddAdminModal = function () {
  document.getElementById('new-admin-user').value = '';
  document.getElementById('new-admin-pass').value = '';
  document.getElementById('new-admin-role').value = 'Staff';
  document.getElementById('new-admin-dept').value = 'registrar';
  populateWindowOptions();
  document.getElementById('add-admin-backdrop').classList.add('show');
};

window.closeAddAdminModal = function (evt) {
  if (evt && evt.target !== evt.currentTarget) return;
  document.getElementById('add-admin-backdrop').classList.remove('show');
};

document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'new-admin-dept') populateWindowOptions();
});

function populateWindowOptions() {
  const deptKey = document.getElementById('new-admin-dept').value;
  const dept = DEPARTMENTS[deptKey];
  const sel = document.getElementById('new-admin-window');
  const usedWindows = admins.filter(a => a.department === deptKey).map(a => a.window);
  let opts = '';
  for (let w = 1; w <= dept.windows; w++) {
    const taken = usedWindows.includes(w);
    opts += `<option value="${w}" ${taken ? 'disabled' : ''}>Window ${w}${taken ? ' — already assigned' : ''}</option>`;
  }
  sel.innerHTML = opts;
}

window.submitAddAdmin = async function () {
  const username = document.getElementById('new-admin-user').value.trim();
  const password = document.getElementById('new-admin-pass').value.trim();
  const department = document.getElementById('new-admin-dept').value;
  const win = parseInt(document.getElementById('new-admin-window').value, 10);
  const role = document.getElementById('new-admin-role').value.trim() || 'Staff';

  if (!username || !password) { toast('Enter a username and password.', 'err'); return; }
  if (admins.find(a => a.username.toLowerCase() === username.toLowerCase())) {
    toast('That username already exists.', 'err');
    return;
  }
  if (!win) { toast('That department has no free windows left.', 'err'); return; }

  const newAdmin = { username, password, role, department, window: win };

  try {
    if (useFirebase) {
      await push(ref(db, 'admins'), newAdmin);
      // onValue(admins) listener will refresh the table automatically
    } else {
      admins.push({ ...newAdmin, _key: String(Date.now()) });
      renderAdminsTable();
    }
    closeAddAdminModal();
    toast(`✅ Admin "${username}" added to ${DEPARTMENTS[department].label}, Window ${win}.`, 'ok');
  } catch (err) {
    toast('⚠️ Could not add admin: ' + (err?.message || 'unknown error'), 'err');
  }
};

window.removeAdmin = async function (key) {
  const a = admins.find(x => x._key === key);
  const name = a ? a.username : key;
  if (!confirm(`Remove admin profile "${name}"? This cannot be undone.`)) return;

  try {
    if (useFirebase) {
      await remove(ref(db, `admins/${key}`));
      // also mark that lane offline so it drops off the kiosk/TV immediately
      if (a) await update(ref(db, `presence/${laneId(a.username)}`), { online: false });
    } else {
      admins = admins.filter(x => x._key !== key);
      renderAdminsTable();
    }
    toast(`Admin "${name}" removed.`, '');
  } catch (err) {
    toast('⚠️ Could not remove admin: ' + (err?.message || 'unknown error'), 'err');
  }
};

/* ══════════════════════ ANALYTICS / REPORTS TAB ══════════════════════ */

document.getElementById('today-label').textContent =
  'Today — ' + new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

/* Build live per-department / per-window stats straight from Firebase.
   - "Issued" / "Served" / "Skipped" at department level come from the
     `queue` node (every ticket ever issued since the last daily reset).
   - Per-window Served/Skipped come from `lanes/{laneId}.calledCount` /
     `.skippedCount`, which each dashboard already increments on
     Call Next / Skip — no extra bookkeeping needed.
   Historical ranges (week/month) aren't available yet because tickets
   aren't date-stamped beyond issuedAt's time-of-day string; "Today"
   reflects whatever is currently in the queue (departments reset it
   each morning via "Reset Queue"). */
function getAnalyticsData() {
  const data = {};

  Object.entries(DEPARTMENTS).forEach(([deptKey, dept]) => {
    const deptQueue  = queue.filter(q => q.department === deptKey);
    const issued     = deptQueue.length;
    const served     = deptQueue.filter(q => q.status === 'done').length;
    const skipped    = deptQueue.filter(q => q.status === 'skipped' || q.status === 'cancelled').length;
    const waiting    = deptQueue.filter(q => q.status === 'waiting').length;

    const windows = [];
    let onlineWindows = 0;

    for (let w = 1; w <= dept.windows; w++) {
      const admin = admins.find(a => a.department === deptKey && (a.window || 1) === w);
      const lid   = admin ? laneId(admin.username) : null;
      const lane  = lid ? (lanes[lid] || {}) : {};
      const isOnline = lid ? presence[lid]?.online === true : false;
      if (isOnline) onlineWindows++;

      windows.push({
        window: w,
        admin: admin ? admin.username : '— Unassigned —',
        online: isOnline,
        serving: lane.serving || 0,
        served: lane.calledCount || 0,
        skipped: lane.skippedCount || 0,
      });
    }

    data[deptKey] = { issued, served, skipped, waiting, onlineWindows, totalWindows: dept.windows, windows, prefix: dept.prefix };
  });

  return data;
}

window.refreshAnalytics = function () {
  if (!document.getElementById('kpi-row')) return; // not logged in yet
  const range = document.getElementById('range-select').value;

  if (range !== 'today') {
    document.getElementById('kpi-row').innerHTML =
      `<div class="kpi-card"><div class="kpi-label">Not Available Yet</div><div class="kpi-sub" style="margin-top:6px;">Weekly/monthly reports need date-stamped ticket logs, which this system doesn't record yet — each office's queue is cleared daily. "Today" reflects live data.</div></div>`;
    document.getElementById('dept-report-grid').innerHTML = '';
    return;
  }

  const data = getAnalyticsData();
  renderKpiRow(data);
  renderDeptReports(data);
};

function renderKpiRow(data) {
  const totals = Object.values(data).reduce((acc, d) => ({
    issued: acc.issued + d.issued,
    served: acc.served + d.served,
    skipped: acc.skipped + d.skipped,
    online: acc.online + d.onlineWindows,
    all: acc.all + d.totalWindows,
  }), { issued: 0, served: 0, skipped: 0, online: 0, all: 0 });

  const kpis = [
    { label: 'Numbers Issued', value: totals.issued, sub: 'Across all departments, today', cls: '' },
    { label: 'Customers Served', value: totals.served, sub: `${totals.issued ? Math.round(totals.served / totals.issued * 100) : 0}% completion rate`, cls: 'kpi-teal' },
    { label: 'Skipped / No-show', value: totals.skipped, sub: 'Returned or cancelled', cls: 'kpi-violet' },
    { label: 'Windows Online', value: `${totals.online} / ${totals.all}`, sub: 'Currently staffed', cls: 'kpi-gold' },
  ];

  document.getElementById('kpi-row').innerHTML = kpis.map(k => `
    <div class="kpi-card ${k.cls}">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-sub">${k.sub}</div>
    </div>`).join('');
}

function renderDeptReports(data) {
  const grid = document.getElementById('dept-report-grid');

  grid.innerHTML = Object.entries(DEPARTMENTS).map(([deptKey, dept]) => {
    const d = data[deptKey];
    const maxServed = Math.max(1, ...d.windows.map(w => w.served));

    const rows = d.windows.map(w => `
      <tr>
        <td><span class="win-status-pill ${w.online ? 'online' : 'offline'}"><span class="d"></span>${w.online ? 'Online' : 'Offline'}</span></td>
        <td>Window ${w.window}</td>
        <td>${escapeHtml(w.admin)}</td>
        <td class="mono">${w.serving ? d.prefix + String(w.serving).padStart(3, '0') : '—'}</td>
        <td class="mono">${w.served}</td>
        <td class="mono">${w.skipped}</td>
        <td>
          <span class="bar-track"><span class="bar-fill" style="width:${Math.round(w.served / maxServed * 100)}%"></span></span>
        </td>
      </tr>`).join('');

    return `
    <div class="dept-report-card" data-dept="${deptKey}">
      <div class="drc-header">
        <div class="drc-title">
          <span class="drc-dot"></span>
          <h3>${dept.label} · ${dept.windows} Window${dept.windows > 1 ? 's' : ''}</h3>
        </div>
        <div class="drc-summary">
          <div class="drc-stat"><div class="n">${d.issued}</div><div class="l">Issued</div></div>
          <div class="drc-stat"><div class="n">${d.served}</div><div class="l">Served</div></div>
          <div class="drc-stat"><div class="n">${d.skipped}</div><div class="l">Skipped</div></div>
          <div class="drc-stat"><div class="n">${d.onlineWindows}/${d.totalWindows}</div><div class="l">Online</div></div>
        </div>
      </div>
      <div class="drc-table-wrap">
        <table class="drc-table">
          <thead><tr><th>Status</th><th>Window</th><th>Admin</th><th>Now Serving</th><th>Served</th><th>Skipped</th><th>Volume</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}

/* ── Utilities ── */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
