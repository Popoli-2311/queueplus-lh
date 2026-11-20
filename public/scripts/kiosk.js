import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, onValue, update, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { firebaseConfig, UNI_NAME, UNI_LABEL, APP_DL_URL } from "../firebase-config.js";

/* -- Department Config --
   Each department now runs a single window/counter. */
const DEPARTMENTS = {
  registrar:   { label: 'Registrar',            prefix: 'R', windows: 1 },
  accounting:  { label: 'Accounting Office',     prefix: 'A', windows: 1 },
  scholarship: { label: 'Scholarship & Grants',  prefix: 'S', windows: 1 },
};

/* -- Clock -- */
function tickClock() {
  document.getElementById('clock').textContent = new Date().toLocaleString('en-US', {
    month: 'numeric', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit'
  });
}
tickClock();
setInterval(tickClock, 1000);

/* -- Firebase -- */
let db, useFirebase = false;
try {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  useFirebase = firebaseConfig.apiKey !== 'YOUR_API_KEY';
} catch(e) { 
  useFirebase = false; 
}

const dotEl = document.getElementById('fb-dot-inner');
const lblEl = document.getElementById('fb-label');
if (useFirebase) {
  dotEl.style.background = '#0D8A4B';
  dotEl.style.boxShadow  = '0 0 6px #0D8A4B';
  lblEl.textContent = '';
} else {
  lblEl.textContent = 'DEMO MODE';
}

/* -- Local fallback -- */
const Local = {
  getQueue()       { return JSON.parse(localStorage.getItem('uq_queue') || '[]'); },
  saveQueue(q)     { localStorage.setItem('uq_queue', JSON.stringify(q)); },
  getCounter(dept) { return parseInt(localStorage.getItem('uq_counter_' + dept) || '0'); },
  setCounter(dept, n) { localStorage.setItem('uq_counter_' + dept, String(n)); },
  getLanes()       { return JSON.parse(localStorage.getItem('uq_lanes') || '{}'); },
  getDeptStatus()  { return JSON.parse(localStorage.getItem('uq_dept_status') || '{}'); },
};

/* -- State -- */
let queue    = [];
let lanes    = {};
let presence = {};
let deptCounters = { registrar: 0, accounting: 0, scholarship: 0 };
let deptStatus    = {}; // { registrar: { open: true }, accounting: { open: false }, ... }

const pad = n => n > 0 ? String(n).padStart(3, '0') : '—';
const padNum = n => String(n).padStart(3, '0');

function animPop(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('pop');
  setTimeout(() => el.classList.remove('pop'), 400);
}

/* -- Kiosk window open/closed, controlled from each admin dashboard --
   A department is treated as OPEN unless its deptStatus/{dept}.open is
   explicitly false. This flag lives in the database (not presence), so
   it stays exactly as the admin left it even after they go offline —
   it only changes when an admin deliberately flips it. */
function isDeptOpen(deptKey) {
  const s = deptStatus[deptKey];
  return !s || s.open !== false;
}

/* -- Cooldown after tapping "Get Number", so a double-tap on the kiosk
   screen can't silently issue two tickets to the same person. -- */
const KIOSK_COOLDOWN_MS = 6000;
let kioskCooldownEndsAt = 0;
let kioskCooldownTimer  = null;

function isKioskLocked() {
  return Date.now() < kioskCooldownEndsAt;
}

/* -- Apply open/closed + cooldown state to every department button/card -- */
function applyDeptOpenStates() {
  const locked = isKioskLocked();
  for (const deptKey of Object.keys(DEPARTMENTS)) {
    const card = document.getElementById('dept-card-' + deptKey);
    const btn  = document.getElementById('dc-btn-' + deptKey);
    if (!card || !btn) continue;

    const open = isDeptOpen(deptKey);
    card.classList.toggle('closed', !open);

    if (!open) {
      btn.disabled = true;
      btn.classList.add('closed-btn');
      btn.textContent = 'Window Closed';
    } else {
      btn.classList.remove('closed-btn');
      if (!locked) {
        btn.disabled = false;
        btn.textContent = 'Get Number';
      }
      // if locked, the cooldown countdown owns disabled/text state
    }
  }
}

function startKioskCooldown(activeDeptKey) {
  kioskCooldownEndsAt = Date.now() + KIOSK_COOLDOWN_MS;

  for (const deptKey of Object.keys(DEPARTMENTS)) {
    const btn = document.getElementById('dc-btn-' + deptKey);
    if (!btn || !isDeptOpen(deptKey)) continue;
    btn.disabled = true;
  }

  clearInterval(kioskCooldownTimer);
  kioskCooldownTimer = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((kioskCooldownEndsAt - Date.now()) / 1000));

    for (const deptKey of Object.keys(DEPARTMENTS)) {
      const btn = document.getElementById('dc-btn-' + deptKey);
      if (!btn || !isDeptOpen(deptKey)) continue;
      btn.textContent = (deptKey === activeDeptKey && remaining > 0)
        ? `Please wait ${remaining}s`
        : 'Get Number';
    }

    if (remaining <= 0) {
      clearInterval(kioskCooldownTimer);
      kioskCooldownTimer = null;
      applyDeptOpenStates();
    }
  }, 250);
}

/* -- Update Next Available Number display -- */
function updateNextNumber() {
  for (const [deptKey, val] of Object.entries(deptCounters)) {
    const el = document.getElementById('dc-num-' + deptKey);
    if (el) {
      const prefix = DEPARTMENTS[deptKey] ? DEPARTMENTS[deptKey].prefix : '';
      const newVal = prefix + padNum(val + 1);
      if (el.textContent !== newVal) {
        el.textContent = newVal;
        el.classList.add('pop');
        setTimeout(() => el.classList.remove('pop'), 400);
      }
    }
  }
}

/* -- Build window cards from real lane data -- */
function renderWindowRow() {
  const row = document.getElementById('windows-row');

  const laneIds = Object.keys(lanes)
    .sort((a,b) => (lanes[a].windowNumber||99) - (lanes[b].windowNumber||99))
    .slice(0, 2);

  const allServing = laneIds.map(lid => lanes[lid]?.serving || 0).filter(Boolean);
  const latestServing = allServing.length ? Math.max(...allServing) : 0;

  let html = '';

  if (laneIds.length === 0) {
    html = `
    <div class="center-card">
      <div class="cc-label">Now Serving</div>
      <div class="cc-number ${latestServing ? '' : 'dash'}" id="center-num">${latestServing ? pad(latestServing) : '—'}</div>
      <div class="cc-sub">Waiting for counter session...</div>
    </div>`;
  } else if (laneIds.length === 1) {
    const lid   = laneIds[0];
    const lane  = lanes[lid] || {};
    const serv  = lane.serving || 0;
    html = `
    <div class="center-card">
      <div class="cc-label">Now Serving</div>
      <div class="cc-number ${serv ? '' : 'dash'}" id="center-num">${pad(serv)}</div>
      <div class="cc-sub">${lane.admin ? 'Window: ' + lane.admin : 'Waiting for next call'}</div>
    </div>`;
  } else {
    laneIds.forEach((lid, i) => {
      const lane     = lanes[lid] || {};
      const pres     = presence[lid] || {};
      const isOnline = pres.online === true;
      const serv     = lane.serving || 0;
      const servStr  = pad(serv);
      const isDash   = serv === 0;
      const winNum   = lane.windowNumber || (i + 1);
      const colorCls = winNum === 1 ? 'lane-a' : 'lane-b';

      html += `
      <div class="window-card ${colorCls}">
        <div class="wc-label">Window ${winNum}</div>
        <div class="wc-admin">
          <div class="wc-online-dot ${isOnline ? 'online' : 'offline'}"></div>
          ${lane.admin || ('Lane ' + (i+1))}
        </div>
        <div class="wc-serving">Now Serving</div>
        <div class="wc-num ${isDash ? 'dash' : ''}" id="wnum-${lid}">${servStr}</div>
        <div class="wc-status ${isOnline ? (serv ? 'serving' : 'idle') : 'offline'}">
          ${isOnline ? (serv ? 'Serving' : 'Idle') : 'Offline'}
        </div>
      </div>`;
    });
  }

  row.innerHTML = html;
}

/* -- Lightweight update: just numbers, no full re-render -- */
function updateNumbers() {
  const laneIds = Object.keys(lanes).sort().slice(0, 2);

  laneIds.forEach(lid => {
    const lane  = lanes[lid] || {};
    const serv  = lane.serving || 0;
    const str   = pad(serv);
    const el    = document.getElementById('wnum-' + lid);
    if (el && el.textContent !== str) {
      el.textContent = str;
      el.className   = 'wc-num' + (serv === 0 ? ' dash' : '');
      animPop('wnum-' + lid);
    }
  });

  const allServing = laneIds.map(lid => lanes[lid]?.serving || 0).filter(Boolean);
  const latest     = allServing.length ? Math.max(...allServing) : 0;
  const cEl        = document.getElementById('center-num');
  const cStr       = latest ? pad(latest) : '—';
  if (cEl && cEl.textContent !== cStr) {
    cEl.textContent = cStr;
    cEl.className   = 'cc-number' + (latest === 0 ? ' dash': '');
    animPop('center-num');
  }
}

/* -- Firebase listeners -- */
if (useFirebase) {
  onValue(ref(db, 'queue'), snap => {
    queue = snap.val() ? Object.entries(snap.val()).map(([k,v]) => ({...v,_key:k})) : [];
    for (const deptKey of Object.keys(DEPARTMENTS)) {
      const deptNums = queue.filter(q => q.department === deptKey).map(q => q.number || 0);
      deptCounters[deptKey] = deptNums.length ? Math.max(...deptNums) : 0;
    }
    updateNextNumber();
    updateNumbers();
  });

  onValue(ref(db, 'lanes'), snap => {
    const newLanes = snap.val() || {};
    const changed  = JSON.stringify(Object.keys(newLanes).sort()) !== JSON.stringify(Object.keys(lanes).sort());
    lanes = newLanes;
    if (changed) renderWindowRow();
    else updateNumbers();
  });

  onValue(ref(db, 'presence'), snap => {
    presence = snap.val() || {};
    renderWindowRow();
  });

  onValue(ref(db, 'deptCounters'), snap => {
    const s = snap.val() || {};
    for (const deptKey of Object.keys(DEPARTMENTS)) {
      if (s[deptKey] !== undefined) deptCounters[deptKey] = s[deptKey];
    }
    updateNextNumber();
  });

  // Kiosk window on/off, set from each admin dashboard. Persists in the
  // database regardless of that admin's online/offline presence.
  onValue(ref(db, 'deptStatus'), snap => {
    deptStatus = snap.val() || {};
    applyDeptOpenStates();
  });

} else {
  setInterval(() => {
    queue  = Local.getQueue();
    lanes  = Local.getLanes();
    deptStatus = Local.getDeptStatus();
    for (const deptKey of Object.keys(DEPARTMENTS)) {
      deptCounters[deptKey] = Local.getCounter(deptKey);
    }
    updateNextNumber();
    renderWindowRow();
    applyDeptOpenStates();
  }, 1500);

  queue = Local.getQueue();
  lanes = Local.getLanes();
  deptStatus = Local.getDeptStatus();
  for (const deptKey of Object.keys(DEPARTMENTS)) {
    deptCounters[deptKey] = Local.getCounter(deptKey);
  }
  updateNextNumber();
  renderWindowRow();
}

// Initial render
renderWindowRow();
updateNextNumber();
applyDeptOpenStates();

window.selectDepartment = async function(deptKey) {
  if (isKioskLocked()) {
    toast('Please wait a moment before requesting another number.', '');
    return;
  }
  if (!isDeptOpen(deptKey)) {
    toast('This window is currently closed. Please try another department.', 'err');
    return;
  }

  const btn = document.getElementById('dc-btn-' + deptKey);
  if (btn) { btn.disabled = true; btn.textContent = 'Please wait…'; }

  const dept     = DEPARTMENTS[deptKey];
  const newNum   = (deptCounters[deptKey] || 0) + 1;
  const ticketId = dept.prefix + padNum(newNum);

  const item = {
    number:       newNum,
    ticketId:     ticketId,
    department:   deptKey,
    deptLabel:    dept.label,
    issuedAt:     new Date().toLocaleTimeString(),
    status:       'waiting',
    calledAt:     null,
    calledBy:     null,
    calledByLane: null
  };

  try {
    if (useFirebase) {
      await update(ref(db, 'deptCounters'), { [deptKey]: newNum });
      await push(ref(db, 'queue'), item);
    } else {
      Local.setCounter(deptKey, newNum);
      const q = Local.getQueue();
      q.push(item);
      Local.saveQueue(q);
      queue = q;
    }

    deptCounters[deptKey] = newNum;
    updateNextNumber();

    // Lock all buttons for a short cooldown so this ticket can't be
    // accidentally duplicated by a second tap right after.
    startKioskCooldown(deptKey);

    // -- SILENT PRINT via server /print endpoint --
    const issueTime = new Date().toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit', second:'2-digit'});

    printReceiptPreview(ticketId, dept.label, dept.label, issueTime);

    fetch('/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': window._ADMIN_KEY || '' },
      body: JSON.stringify({
        ticketId,
        deptLabel: dept.label,
        uniName:   dept.label,
        issuedAt:  issueTime
      })
    })
    .then(r => r.json())
    .then(r => {
      if (r.ok) {
        toast('🎫 Ticket ' + ticketId + ' printed!', 'ok');
      } else {
        toast('⚠️ Print failed: ' + r.error, 'err');
      }
    })
    .catch(() => toast('⚠️ Could not reach printer server.', 'err'));

  } catch(e) {
    toast('Error issuing ticket. Try again.', 'err');
    applyDeptOpenStates();
  }
};

/* -- Render enlarged ticket markup into #print-area -- */
function printReceiptPreview(ticketId, deptLabel, uniName, issuedAt) {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const year = now.getFullYear();
  const dateToday = `${month}/${day}/${year}`;
  
  const area = document.getElementById('print-area');
  area.innerHTML = `
    <div class="rcpt">
      <div class="uni">${uniName}</div>
      <div class="sep"></div>
      <div class="lbl">YOUR NUMBER</div>
      <div class="num">${ticketId}</div>
      <div class="issued">Date: ${dateToday}</div>
      <div class="issued">Issued: ${issuedAt}</div>
      <div class="sep"></div>
      <div class="foot">QUELIO QUEUE System ${year}</div>
    </div>`;

  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}

function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
