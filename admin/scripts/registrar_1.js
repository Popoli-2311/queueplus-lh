import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, onValue, update, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { firebaseConfig, DEFAULT_ADMINS, ADMIN_API_KEY } from "../admin-config.js";

/* ── Firebase init ── */
let db, useFirebase = false;
try {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  useFirebase = firebaseConfig.apiKey !== 'YOUR_API_KEY';
} catch(e) {}

const fbDot = document.getElementById('fb-dot');
if (useFirebase) { fbDot.className = 'fb-dot live'; }
else { fbDot.className = 'fb-dot demo'; }

/* ── State ── */
let currentAdmin = "Registrar's Office";
let myLaneId     = null;
let queue        = [];
let lanes        = {};
let admins       = [];
let presenceMap  = {};

/* Cooldown after Call Next / Skip */
const ACTION_COOLDOWN_MS = 3000;
let cooldownEndsAt = 0;
let cooldownTimer  = null;

let deptOpen = true;

const pad = (n, prefix = '') => n > 0 ? prefix + String(n).padStart(3, '0') : '—';
const laneId = username => 'lane_' + username.replace(/\s+/g, '_');

/* ── Department config ── */
const DEPT_MAP = {
  registrar:   { label: 'Registrar',           prefix: 'R' },
  accounting:  { label: 'Accounting Office',    prefix: 'A' },
  scholarship: { label: 'Scholarship & Grants', prefix: 'S' },
};

const FIXED_DEPT = 'registrar';
const MY_PREFIX = DEPT_MAP[FIXED_DEPT]?.prefix || '';

/* Department + window number now come from the logged-in admin's own
   record in Firebase (admins/{key}.department / .window) instead of a
   hardcoded value, so multiple staff can log in to this same page and
   each land on their own window (Registrar has windows 1–7). Falls back
   to this page's fixed department / window 1 if the admin record is
   missing either field (keeps old seed accounts working). */
function getDeptForAdmin(username) {
  const found = admins.find(a => a.username === username);
  return (found && found.department) || FIXED_DEPT;
}

function getWindowForAdmin(username) {
  const found = admins.find(a => a.username === username);
  return (found && found.window) || 1;
}

function deptAdmins() {
  return admins.filter(a => a.department === FIXED_DEPT);
}

function isLocked() {
  return Date.now() < cooldownEndsAt;
}

function startCooldown() {
  cooldownEndsAt = Date.now() + ACTION_COOLDOWN_MS;
  updateControlButtons();
  clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    if (Date.now() >= cooldownEndsAt) {
      clearInterval(cooldownTimer);
    }
    updateControlButtons();
  }, 250);
}

function updateControlButtons() {
  const callBtn = document.getElementById('call-next-btn');
  const skipBtn = document.getElementById('skip-btn');
  const remaining = Math.max(0, Math.ceil((cooldownEndsAt - Date.now()) / 1000));
  const locked = remaining > 0;
  
  if (callBtn) {
    callBtn.disabled = locked;
    callBtn.textContent = locked ? `⏳ Wait ${remaining}s` : 'Call Next';
  }
  if (skipBtn) {
    skipBtn.disabled = locked;
    skipBtn.textContent = locked ? `⏳ Wait ${remaining}s` : 'Skip';
  }
}

/* ── Local fallback ── */
const Local = {
  getQueue()    { return JSON.parse(localStorage.getItem('uq_queue')  || '[]'); },
  saveQueue(q)  { localStorage.setItem('uq_queue', JSON.stringify(q)); },
  getLanes()    { return JSON.parse(localStorage.getItem('uq_lanes')  || '{}'); },
  saveLanes(l)  { localStorage.setItem('uq_lanes', JSON.stringify(l)); },
  getAdmins()   { return JSON.parse(localStorage.getItem('uq_admins') || JSON.stringify(DEFAULT_ADMINS)); },
  saveAdmins(a) { localStorage.setItem('uq_admins', JSON.stringify(a)); },
  getDeptStatus()    { return JSON.parse(localStorage.getItem('uq_dept_status') || '{}'); },
  setDeptStatus(dept, open) {
    const s = Local.getDeptStatus();
    s[dept] = { open };
    localStorage.setItem('uq_dept_status', JSON.stringify(s));
  },
};

/* ── Presence ── */
async function registerPresence() {
  if (!useFirebase || !currentAdmin) return;
  const lid = laneId(currentAdmin);
  const presRef = ref(db, `presence/${lid}`);
  await set(presRef, { admin: currentAdmin, online: true, laneId: lid, lastSeen: serverTimestamp() });
  onDisconnect(presRef).set({ admin: currentAdmin, online: false, laneId: lid, lastSeen: serverTimestamp() });
}

function listenPresence() {
  if (!useFirebase) return;
  onValue(ref(db, 'presence'), snap => {
    presenceMap = snap.val() || {};
    renderPresenceBar();
  });
}

function renderPresenceBar() {
  const bar   = document.getElementById('presence-bar');
  const chips = document.getElementById('presence-chips');
  const deptUsernames = deptAdmins().map(a => a.username);
  const online = Object.entries(presenceMap).filter(([,v]) => v.online && deptUsernames.includes(v.admin));

  if (online.length <= 1) {
    bar.classList.remove('show');
    return;
  }

  bar.classList.add('show');
  chips.innerHTML = online.map(([lid, v]) => {
    const tag = lid === myLaneId ? '(you)' : '· Window';
    return `
      <div class="presence-chip ${lid === myLaneId ? 'me' : 'other'}">
        <div class="presence-dot"></div>
        ${v.admin}
        <span class="lane-tag">${tag}</span>
      </div>
    `;
  }).join('');
}

/* ── Kiosk window toggle ── */
window.toggleKioskWindow = async function() {
  const previous = deptOpen;
  const next     = !deptOpen;

  deptOpen = next;
  updateWindowToggle();

  if (useFirebase) {
    try {
      await update(ref(db, `deptStatus/${FIXED_DEPT}`), { open: next, updatedBy: currentAdmin, updatedAt: Date.now() });
    } catch (err) {
      console.error('toggleKioskWindow failed:', err);
      deptOpen = previous;
      updateWindowToggle();
      toast('⚠️ Could not update kiosk window: ' + (err?.message || 'permission denied.'), 'err');
      return;
    }
  } else {
    Local.setDeptStatus(FIXED_DEPT, next);
  }

  toast(
    next
      ? '✅ Kiosk window opened — customers can now get a number.'
      : '🚫 Kiosk window closed — customers can\'t get a number until you reopen it.',
    next ? 'ok' : 'err'
  );
};

function updateWindowToggle() {
  const toggle = document.querySelector('.kiosk-toggle');
  const status = document.getElementById('window-status');
  
  if (toggle) {
    toggle.className = `kiosk-toggle ${deptOpen ? 'on' : 'off'}`;
    toggle.setAttribute('aria-pressed', deptOpen);
  }
  if (status) {
    status.textContent = deptOpen 
      ? 'Open — accepting new numbers' 
      : 'Closed — not accepting new numbers';
    status.style.color = deptOpen ? 'var(--green)' : 'var(--red)';
  }
}

/* ── Render queue display ── */
function renderQueueDisplay() {
  const myLane = lanes[myLaneId] || {};
  const serving = myLane.serving || 0;
  const dept = getDeptForAdmin(currentAdmin);
  const prefix = dept ? DEPT_MAP[dept]?.prefix : '';
  const ticketDisplay = serving ? prefix + String(serving).padStart(3, '0') : '—';
  
  const displayEl = document.getElementById('serving-display');
  const metaEl = document.getElementById('serving-meta');
  
  if (displayEl) {
    displayEl.textContent = ticketDisplay;
  }
  if (metaEl) {
    metaEl.textContent = serving ? `Called at ${myLane.calledAt || ''}` : 'Waiting for next customer';
  }
}

/* ── Render skipped list ── */
function renderSkippedList() {
  const el = document.getElementById('skipped-list');
  if (!el) return;

  const myDept = getDeptForAdmin(currentAdmin);
  const items = queue.filter(q => q.status === 'skipped' && (myDept ? q.department === myDept : true));

  if (!items.length) {
    el.innerHTML = '<div class="skipped-empty">No skipped numbers waiting to be processed.</div>';
    return;
  }

  el.innerHTML = items.slice().sort((a,b) => b.number - a.number).map(q => {
    const key = q._key || q.number;
    const ticketDisplay = q.ticketId || String(q.number).padStart(3,'0');
    return `
      <div class="skipped-row">
        <div class="skipped-info">
          <div class="skipped-num">${ticketDisplay}</div>
          <div class="skipped-time">Issued ${q.issuedAt || ''}</div>
        </div>
        <div class="skipped-actions">
          <button class="mini-btn recall" onclick="recallSkipped('${key}', ${q.number})">↩ Recall</button>
          <button class="mini-btn cancel" onclick="cancelSkipped('${key}', ${q.number})">✕ Cancel</button>
        </div>
      </div>
    `;
  }).join('');
}

window.recallSkipped = async function(key, number) {
  if (useFirebase) {
    await update(ref(db, `queue/${key}`), { status: 'waiting' });
  } else {
    const q = Local.getQueue();
    const i = q.findIndex(item => (item._key || item.number) === key);
    if (i >= 0) q[i].status = 'waiting';
    Local.saveQueue(q);
    queue = q;
    renderSkippedList();
    refreshDash();
  }
  toast('↩ Number ' + pad(number, MY_PREFIX) + ' returned to the queue.', 'ok');
};

window.cancelSkipped = async function(key, number) {
  if (useFirebase) {
    await update(ref(db, `queue/${key}`), { status: 'cancelled' });
  } else {
    const q = Local.getQueue();
    const i = q.findIndex(item => (item._key || item.number) === key);
    if (i >= 0) q[i].status = 'cancelled';
    Local.saveQueue(q);
    queue = q;
    renderSkippedList();
    refreshDash();
  }
  toast('✕ Number ' + pad(number, MY_PREFIX) + ' cancelled.', '');
};

/* ── Refresh dashboard ── */
function refreshDash() {
  if (document.getElementById('dash-view').style.display === 'none') return;

  renderQueueDisplay();
  renderSkippedList();

  const tbody = document.getElementById('qtbody');
  const myDeptFilter = getDeptForAdmin(currentAdmin);
  const visibleQueue = myDeptFilter
    ? queue.filter(q => q.department === myDeptFilter)
    : queue;
  
  const countEl = document.getElementById('log-count');
  if (countEl) countEl.textContent = visibleQueue.length + ' entries';
  
  if (!visibleQueue.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No queue numbers issued yet today.</td></tr>';
  } else {
    const sorted = visibleQueue.slice().sort((a,b)=>b.number-a.number);
    tbody.innerHTML = sorted.map((q,i) => {
      const ticketDisplay = q.ticketId || String(q.number).padStart(3,'0');
      const deptDisplay = q.deptLabel || q.department || '—';
      return `
      <tr>
        <td style="color:var(--text3);font-size:13px">${visibleQueue.length-i}</td>
        <td><span class="qnum">${ticketDisplay}</span></td>
        <td style="font-size:12px;color:var(--text2); display:none">${deptDisplay}</td>
        <td style="color:var(--text3);font-size:13px">${q.issuedAt}</td>
        <td><span class="badge ${q.status}">${q.status}</span></td>
        <td style="color:var(--text3);font-size:13px">${q.calledAt || '—'}</td>
      </tr>`;
    }).join('');
  }
}

/* ── Firebase / Local init ── */
async function initData() {
  if (useFirebase) {
    const seedSnap = await get(ref(db, 'admins'));
    if (!seedSnap.val()) {
      const obj = DEFAULT_ADMINS.reduce((a,v,i)=>(a[i]=v,a),{});
      await set(ref(db, 'admins'), obj);
      admins = DEFAULT_ADMINS.map((v,i) => ({ ...v, _key: String(i) }));
    } else {
      admins = Object.entries(seedSnap.val()).map(([k, v]) => ({ ...v, _key: k }));
    }

    // Live-sync admin accounts from here on, so windows added later from
    // the Super Admin console (or removed) are picked up without a
    // page reload.
    onValue(ref(db, 'admins'), snap => {
      const val = snap.val() || {};
      admins = Object.entries(val).map(([k, v]) => ({ ...v, _key: k }));
      renderPresenceBar();
    });

    onValue(ref(db, 'queue'), snap => {
      queue = snap.val() ? Object.entries(snap.val()).map(([k,v]) => ({...v,_key:k})) : [];
      refreshDash();
    });

    onValue(ref(db, 'lanes'), snap => {
      lanes = snap.val() || {};
      renderPresenceBar();
      renderQueueDisplay();
      refreshDash();
    });

    onValue(ref(db, `deptStatus/${FIXED_DEPT}`), snap => {
      const v = snap.val();
      deptOpen = v ? v.open !== false : true;
      updateWindowToggle();
    });

    listenPresence();
  } else {
    admins = Local.getAdmins();
    deptOpen = (Local.getDeptStatus()[FIXED_DEPT] || {}).open !== false;
    updateWindowToggle();
    setInterval(() => {
      queue = Local.getQueue();
      lanes = Local.getLanes();
      deptOpen = (Local.getDeptStatus()[FIXED_DEPT] || {}).open !== false;
      if (document.getElementById('dash-view').style.display !== 'none') {
        updateWindowToggle();
        refreshDash();
      }
    }, 1500);

    queue = Local.getQueue();
    lanes = Local.getLanes();
  }
}

/* ── Ensure current admin has fixed lane/window ── */
async function ensureMyLane() {
  if (!currentAdmin) return;

  myLaneId = laneId(currentAdmin);
  document.getElementById('admin-user-lbl').textContent = currentAdmin;

  const fixedWindowNumber = getWindowForAdmin(currentAdmin);
  const myDept = getDeptForAdmin(currentAdmin);

  if (useFirebase) {
    const snap = await get(ref(db, `lanes/${myLaneId}`));

    if (!snap.val()) {
      await set(ref(db, `lanes/${myLaneId}`), {
        admin: currentAdmin,
        department: myDept,
        serving: 0,
        calledCount: 0,
        skippedCount: 0,
        calledAt: '',
        skipMode: 'recall',
        windowNumber: fixedWindowNumber
      });
    } else {
      await update(ref(db, `lanes/${myLaneId}`), {
        admin: currentAdmin,
        department: myDept,
        windowNumber: fixedWindowNumber
      });
    }

  } else {
    const ls = Local.getLanes();

    if (!ls[myLaneId]) {
      ls[myLaneId] = {
        admin: currentAdmin,
        department: myDept,
        serving: 0,
        calledCount: 0,
        skippedCount: 0,
        calledAt: '',
        skipMode: 'recall',
        windowNumber: fixedWindowNumber
      };
    } else {
      ls[myLaneId] = {
        ...ls[myLaneId],
        admin: currentAdmin,
        department: myDept,
        windowNumber: fixedWindowNumber
      };
    }

    Local.saveLanes(ls);
    lanes = ls;
  }
}

/* ── Auth ──
   Credentials are checked against the live `admins` array synced from
   Firebase (see initData above). Any admin whose `department` field
   matches this page can sign in here; their own `window` number decides
   which physical counter/lane they control. Adding or removing accounts
   is done from the Super Admin console (/superadmin), not here. */
window.doLogin = function() {
  const u = document.getElementById('login-user').value.trim();
  const p = document.getElementById('login-pass').value;
  const found = deptAdmins().find(a => a.username === u && a.password === p);

  if (found) {
    currentAdmin = u;
    sessionStorage.setItem('admin_session_registrar', u);
    document.getElementById('login-error').classList.remove('show');
    showDash();
    toast('✅ Welcome, ' + u + '!', 'ok');
  } else {
    document.getElementById('login-error').classList.add('show');
  }
};

window.doLogout = async function() {
  if (useFirebase && myLaneId) {
    await update(ref(db, `presence/${myLaneId}`), { online: false });
  }

  currentAdmin = null;
  myLaneId = null;
  sessionStorage.removeItem('admin_session_registrar');

  document.getElementById('app-shell').style.display = 'none';
  document.getElementById('login-view').style.display = 'flex';
  document.getElementById('presence-bar').classList.remove('show');
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';

  toast('Signed out.', '');
};

async function showDash() {
  if (document.getElementById('login-view')) {
    document.getElementById('login-view').style.display = 'none';
  }
  document.getElementById('app-shell').style.display = 'block';
  await ensureMyLane();
  await registerPresence();
  updateWindowToggle();

  const winLbl = document.getElementById('window-label');
  if (winLbl) winLbl.textContent = 'WINDOW ' + DEPT_MAP[FIXED_DEPT].label.toUpperCase() + ' · W' + getWindowForAdmin(currentAdmin);

  refreshDash();
}

/* ── Queue actions ── */
window.callNext = async function() {
  if (isLocked()) {
    toast(`⏳ Please wait ${Math.ceil((cooldownEndsAt - Date.now())/1000)}s before calling the next number.`, '');
    return;
  }

  const now = new Date().toLocaleTimeString();
  const myLane = lanes[myLaneId] || {};
  const prevServ = myLane.serving || 0;
  const myDept = getDeptForAdmin(currentAdmin);

  const next = myDept
    ? queue.find(q => q.status === 'waiting' && q.department === myDept)
    : queue.find(q => q.status === 'waiting');

  const deptLabel = myDept ? DEPT_MAP[myDept].label : 'queue';

  if (useFirebase) {
    if (prevServ > 0) {
      const prev = queue.find(q =>
        q.number === prevServ &&
        q.calledByLane === myLaneId &&
        q.status === 'serving'
      );

      if (prev?._key) {
        await update(ref(db, `queue/${prev._key}`), {
          status: 'done'
        });
      }
    }

    if (!next) {
      await update(ref(db, `lanes/${myLaneId}`), {
        serving: 0,
        calledAt: ''
      });

      startCooldown();
      toast(
        prevServ > 0
          ? `✅ Last number completed. No more in ${deptLabel}.`
          : `⚠ No more waiting in ${deptLabel}.`,
        prevServ > 0 ? 'ok' : 'err'
      );
      return;
    }

    if (next._key) {
      await update(ref(db, `queue/${next._key}`), {
        status:'serving',
        calledAt: now,
        calledBy: currentAdmin,
        calledByLane: myLaneId
      });
    }

    await update(ref(db, `lanes/${myLaneId}`), {
      serving: next.number,
      calledAt: now,
      calledCount: (myLane.calledCount || 0) + 1,
      lastAnnounceId: Date.now()
    });

  } else {
    const q = Local.getQueue();

    if (prevServ > 0) {
      const ci = q.findIndex(i =>
        i.number === prevServ &&
        i.calledByLane === myLaneId &&
        i.status === 'serving'
      );
      if (ci >= 0) q[ci].status = 'done';
    }

    const ls = Local.getLanes();

    if (!next) {
      ls[myLaneId] = {
        ...ls[myLaneId],
        serving: 0,
        calledAt: ''
      };

      Local.saveQueue(q);
      Local.saveLanes(ls);
      queue = q;
      lanes = ls;
      refreshDash();

      startCooldown();
      toast(
        prevServ > 0
          ? `✅ Last number completed. No more in ${deptLabel}.`
          : `⚠ No more waiting in ${deptLabel}.`,
        prevServ > 0 ? 'ok' : 'err'
      );
      return;
    }

    const ni = q.findIndex(i => i.number === next.number);
    if (ni >= 0) {
      q[ni].status = 'serving';
      q[ni].calledAt = now;
      q[ni].calledBy = currentAdmin;
      q[ni].calledByLane = myLaneId;
    }

    ls[myLaneId] = {
      ...ls[myLaneId],
      serving: next.number,
      calledAt: now,
      calledCount: (ls[myLaneId]?.calledCount || 0) + 1,
      lastAnnounceId: Date.now()
    };

    Local.saveQueue(q);
    Local.saveLanes(ls);
    queue = q;
    lanes = ls;
    refreshDash();
  }

  const ticketDisplay = next.ticketId || String(next.number).padStart(3,'0');
  startCooldown();
  toast('📢 Now calling: ' + ticketDisplay, 'ok');
};

window.skipCurrent = async function() {
  if (isLocked()) {
    toast(`⏳ Please wait ${Math.ceil((cooldownEndsAt - Date.now())/1000)}s before skipping.`, '');
    return;
  }

  const myLane  = lanes[myLaneId] || {};
  const serv    = myLane.serving || 0;
  const skipMode = myLane.skipMode || 'recall';
  const newStatus = skipMode === 'cancel' ? 'cancelled' : 'skipped';

  if (!serv) { toast('No number currently serving.', ''); return; }

  if (useFirebase) {
    const curr = queue.find(q => q.number === serv && q.calledByLane === myLaneId);
    if (curr?._key) await update(ref(db, `queue/${curr._key}`), { status: newStatus });

    await update(ref(db, `lanes/${myLaneId}`), {
      serving: 0,
      calledAt: '',
      skippedCount: (myLane.skippedCount || 0) + 1
    });
  } else {
    const q = Local.getQueue();
    const ci = q.findIndex(i => i.number === serv && i.calledByLane === myLaneId);
    if (ci >= 0) q[ci].status = newStatus;
    Local.saveQueue(q);

    const ls = Local.getLanes();
    ls[myLaneId] = {
      ...ls[myLaneId],
      serving: 0,
      calledAt: '',
      skippedCount: (ls[myLaneId]?.skippedCount || 0) + 1
    };

    Local.saveLanes(ls);
    queue = q;
    lanes = ls;
    refreshDash();
  }

  startCooldown();
  toast(
    newStatus === 'cancelled'
      ? '✕ Number ' + pad(serv, MY_PREFIX) + ' cancelled.'
      : '⏭ Number ' + pad(serv, MY_PREFIX) + ' skipped.',
    ''
  );
};

window.recallCurrent = async function() {
  const serv = (lanes[myLaneId] || {}).serving || 0;
  if (!serv) { toast('No number to recall.', ''); return; }

  if (useFirebase) {
    await update(ref(db, `lanes/${myLaneId}`), { lastAnnounceId: Date.now() });
  } else {
    const ls = Local.getLanes();
    ls[myLaneId] = { ...ls[myLaneId], lastAnnounceId: Date.now() };
    Local.saveLanes(ls);
    lanes = ls;
  }

  toast('🔁 Recalling number ' + pad(serv, MY_PREFIX) + '…', 'ok');
};

/* ── Reset ── */
window.resetDept = async function(deptKey) {
  const deptNames = { registrar:'Registrar', accounting:'Accounting Office', scholarship:'Scholarship & Grants' };
  const name = deptNames[deptKey] || deptKey;
  if (!confirm(`Reset ALL queue data for ${name}? This cannot be undone.`)) return;

  if (useFirebase) {
    const snap = await get(ref(db, 'queue'));
    if (snap.val()) {
      const updates = {};
      Object.entries(snap.val()).forEach(([k, v]) => {
        if (v.department === deptKey) updates[`queue/${k}`] = null;
      });
      if (Object.keys(updates).length) await update(ref(db), updates);
    }
    await update(ref(db, 'deptCounters'), { [deptKey]: 0 });
    const laneSnap = await get(ref(db, 'lanes'));
    if (laneSnap.val()) {
      const laneUpdates = {};
      Object.entries(laneSnap.val()).forEach(([lid, lane]) => {
        if (lane.department === deptKey) {
          laneUpdates[`lanes/${lid}/serving`]      = 0;
          laneUpdates[`lanes/${lid}/calledAt`]     = '';
          laneUpdates[`lanes/${lid}/calledCount`]  = 0;
          laneUpdates[`lanes/${lid}/skippedCount`] = 0;
        }
      });
      if (Object.keys(laneUpdates).length) await update(ref(db), laneUpdates);
    }
  } else {
    let q = Local.getQueue().filter(item => item.department !== deptKey);
    Local.saveQueue(q);
    queue = q;
    const ls = Local.getLanes();
    Object.keys(ls).forEach(lid => {
      if (ls[lid].department === deptKey) {
        ls[lid].serving = 0; ls[lid].calledAt = '';
        ls[lid].calledCount = 0; ls[lid].skippedCount = 0;
      }
    });
    Local.saveLanes(ls);
    lanes = ls;
    refreshDash();
  }
  toast(`🗑 ${name} queue reset.`, 'err');
};

/* ── Toast ── */
function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/* ── Admin management ──
   Adding/removing admin profiles now lives entirely in the Super Admin
   console (/superadmin), which writes straight to the same `admins`
   node this page reads from live. */

/* ── Bootstrap ── */
await initData();

const DEFAULT_USER = "Registrar Office"; // Or any admin username from your DEFAULT_ADMINS
const foundAdmin = deptAdmins().find(a => a.username === DEFAULT_USER);

if (foundAdmin) {
  currentAdmin = DEFAULT_USER;
  // Remove any session check and just show the dashboard
  await showDash();
} else {
  // Fallback: if default user not found, try the first admin
  const firstAdmin = deptAdmins()[0];
  if (firstAdmin) {
    currentAdmin = firstAdmin.username;
    await showDash();
  } else {
    console.error("No admin accounts found!");
    // Show a fallback or error message
  }
}