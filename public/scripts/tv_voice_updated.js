import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { firebaseConfig, UNI_NAME } from "./firebase-config.js";

document.getElementById('uni-name-tv').textContent = UNI_NAME + ' — Live Display';

let db, useFirebase = false;
try {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  useFirebase = firebaseConfig.apiKey !== 'YOUR_API_KEY';
} catch (e) {}

const fbDot = document.getElementById('fb-dot');
const fbLabel = document.getElementById('fb-label');
if (useFirebase) {
  fbDot.className = 'live-dot live';
  fbLabel.textContent = 'FIREBASE LIVE';
} else {
  fbDot.className = 'live-dot demo';
  fbLabel.textContent = 'DEMO MODE';
}

const pad = n => n > 0 ? String(n).padStart(3, '0') : '—';

let queue = [];
let lanes = {};   // { laneId: { admin, serving, calledCount, skippedCount, calledAt } }
let presence = {};   // { laneId: { online, admin } }

let voices = [];
let lastServed = {};
speechSynthesis.onvoiceschanged = () => { voices = speechSynthesis.getVoices(); };
voices = speechSynthesis.getVoices();

function speakNumber(windowNo, number) {
  if (number <= 0) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(`Now serving number ${String(number).padStart(3, '0')}. Please proceed to Window.`);
  const v = voices.find(v => v.lang.startsWith('en'));
  if (v) { u.voice = v; }
  u.lang = 'en-US';
  u.rate = .9;
  u.pitch = 1;
  u.volume = 1;
  speechSynthesis.speak(u);
}

/* ── Render lane panels — ONLINE ADMINS ONLY ── */
function renderLanes() {
  const row = document.getElementById('lanes-row');

  // Only include lanes where the admin is currently online
  const laneIds = Object.keys(lanes)
    .sort((a, b) => (lanes[a].windowNumber || 99) - (lanes[b].windowNumber || 99))
    .filter(lid => presence[lid]?.online === true);

  if (!laneIds.length) {
    row.style.gridTemplateColumns = '1fr';
    row.innerHTML = '<div class="no-lanes-msg" style="grid-column:1/-1">No admins currently online…</div>';
    return;
  }

  // 1 lane = centred single column; 2+ = side-by-side
  row.style.gridTemplateColumns = laneIds.length === 1 ? '1fr' : '1fr auto 1fr';

  const panelClasses = ['lane-a', 'lane-b'];
  let html = '';

  laneIds.forEach((lid, i) => {
    const lane = lanes[lid] || {};
    const adminName = lane.admin || lid.replace('lane_', '');
    const serving = lane.serving || 0;
    const servStr = pad(serving);
    const called = lane.calledCount || 0;
    const skipped = lane.skippedCount || 0;
    const calledAt = lane.calledAt || '';
    const isDash = serving === 0;
    const winNum = lane.windowNumber || (i + 1);
    const cls = panelClasses[i % 2];

    html += `
    <div class="lane-panel ${cls}" id="panel-${lid}">
      <div class="lp-window-badge">Window</div>
      <div class="lp-admin">
        <div class="lp-status-dot online"></div>
        ${adminName}
      </div>
      <div class="lp-label">Now Serving</div>
      <div class="lp-number ${isDash ? 'dash' : ''}" id="lpnum-${lid}">${servStr}</div>
      <div class="lp-called-at" id="lpcalled-${lid}">${calledAt ? 'Called at ' + calledAt : 'No active number'}</div>
      <div class="lp-stats">
        <div class="lp-stat"><div class="lp-stat-val">${called}</div><div class="lp-stat-lbl">Called</div></div>
        <div class="lp-stat"><div class="lp-stat-val">${skipped}</div><div class="lp-stat-lbl">Skipped</div></div>
      </div>
    </div>`;

    if (i === 0 && laneIds.length > 1) {
      html += `<div class="center-divider"><div class="div-line"></div><div class="div-vs">vs</div><div class="div-line"></div></div>`;
    }
  });

  row.innerHTML = html;
}

/* ── Update lane numbers (with pop animation, no full re-render) ── */
function updateLaneNumbers() {
  // Only update panels that are currently rendered (online lanes)
  const laneIds = Object.keys(lanes)
    .sort((a, b) => (lanes[a].windowNumber || 99) - (lanes[b].windowNumber || 99))
    .filter(lid => presence[lid]?.online === true);

  laneIds.forEach(lid => {
    const lane = lanes[lid] || {};
    const serving = lane.serving || 0;
    const servStr = pad(serving);
    const el = document.getElementById('lpnum-' + lid);
    const metaEl = document.getElementById('lpcalled-' + lid);
    if (!el) return;

    if (el.textContent !== servStr) {
      el.className = 'lp-number';
      void el.offsetWidth; // reflow
      el.textContent = servStr;
      el.className = serving === 0 ? 'lp-number dash' : 'lp-number flash';
    }
    if (metaEl) {
      metaEl.textContent = lane.calledAt ? 'Called at ' + lane.calledAt : 'No active number';
    }
  });
}

/* ── Global stats (tracked silently — stats bar removed from display) ── */
function refreshStats() {
  // Stats are still computed but the bar has been removed from the UI per requirements.
  // Kept here so Firebase listeners don't break.
}

/* ── Firebase listeners ── */
if (useFirebase) {
  onValue(ref(db, 'queue'), snap => {
    queue = snap.val() ? Object.entries(snap.val()).map(([k, v]) => ({ ...v, _key: k })) : [];
    refreshStats();
  });

  onValue(ref(db, 'lanes'), snap => {
    const newLanes = snap.val() || {};
    const keysChanged = JSON.stringify(Object.keys(newLanes).sort()) !== JSON.stringify(Object.keys(lanes).sort());
    lanes = newLanes;
    if (keysChanged) renderLanes();
    else updateLaneNumbers();
    refreshStats();
  });

  onValue(ref(db, 'presence'), snap => {
    presence = snap.val() || {};
    renderLanes(); // always re-render: online status determines which panels show
  });

} else {
  // Demo mode — localStorage polling
  // In demo mode treat all known lanes as "online" so they appear on TV
  const Local = {
    getQueue() { return JSON.parse(localStorage.getItem('uq_queue') || '[]'); },
    getLanes() { return JSON.parse(localStorage.getItem('uq_lanes') || '{}'); },
  };
  setInterval(() => {
    queue = Local.getQueue();
    lanes = Local.getLanes();
    // Mark all lanes as online in demo mode
    presence = {};
    Object.keys(lanes).forEach(lid => { presence[lid] = { online: true, admin: lanes[lid].admin }; });
    renderLanes();
    refreshStats();
  }, 1500);
  queue = Local.getQueue(); lanes = Local.getLanes();
  Object.keys(lanes).forEach(lid => { presence[lid] = { online: true, admin: lanes[lid].admin }; });
  renderLanes(); refreshStats();
}

/* ── Clock ── */
function updateClock() {
  document.getElementById('clock').textContent =
    new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();