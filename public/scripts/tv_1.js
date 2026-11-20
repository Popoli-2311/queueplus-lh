import { initializeApp }             from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { firebaseConfig, UNI_NAME }  from "../firebase-config.js";

const TICKER_MESSAGE = 'Numbers will not be present in sequence. If your number has been missed, please approach the counter directly.';
document.getElementById('uni-name-tv').textContent = TICKER_MESSAGE;

/* ── Background image carousel ──
 * List every image you want to rotate through, in the order they should
 * appear. Put the files inside public/assets/carousel/ (or anywhere under
 * public/) and reference them here by path. Leave the array empty to keep
 * showing the "Display image goes here" placeholder. */
const CAROUSEL_IMAGES = [
   'assets/images1.jfif',
   'assets/images2.jfif',
   'assets/images3.jfif',
   'assets/mascot.jpg',
];
const CAROUSEL_INTERVAL = 3000; // milliseconds each slide stays on screen

function initCarousel() {
  const track       = document.getElementById('ip-carousel');
  const placeholder = document.getElementById('ip-media-placeholder');
  if (!track || !CAROUSEL_IMAGES.length) return; // no images configured — keep placeholder

  placeholder.style.display = 'none';

  CAROUSEL_IMAGES.forEach((src, i) => {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    if (i === 0) img.classList.add('active');
    track.appendChild(img);
  });

  if (CAROUSEL_IMAGES.length > 1) {
    let idx = 0;
    setInterval(() => {
      const imgs = track.querySelectorAll('img');
      imgs[idx].classList.remove('active');
      idx = (idx + 1) % imgs.length;
      imgs[idx].classList.add('active');
    }, CAROUSEL_INTERVAL);
  }
}
initCarousel();

let db, useFirebase = false;
try {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  useFirebase = firebaseConfig.apiKey !== 'YOUR_API_KEY';
} catch(e) {}

const fbDot   = document.getElementById('fb-dot');
const fbLabel = document.getElementById('fb-label');
if (useFirebase) { fbDot.className='live-dot live'; fbLabel.textContent='FIREBASE LIVE'; }
else             { fbDot.className='live-dot demo'; fbLabel.textContent='DEMO MODE'; }

const pad = (n, prefix = '') => n > 0 ? prefix + String(n).padStart(3,'0') : '—';

let queue    = [];
let lanes    = {};   // { laneId: { admin, serving, calledCount, skippedCount, calledAt } }
let presence = {};   // { laneId: { online, admin } }

// Same prefixes as kiosk.html's DEPARTMENTS map, so the spoken ticket ID
// matches what's printed on the ticket (e.g. "A001" for Accounting).
const DEPT_PREFIX = { registrar: 'R', accounting: 'A', scholarship: 'S' };

// Spoken department/office name, announced instead of the window number
// so listeners hear "Accounting Office" rather than "Window 2".
const DEPT_LABEL = { registrar: 'Registrar', accounting: 'Accounting Office', scholarship: 'Scholarship and Grants Office' };

/* ── Voice Announcements (Web Speech API — built into the browser, English) ── */
let voiceEnabled     = localStorage.getItem('tv_voice_enabled') === 'true';
let englishVoice     = null;
let speechQueue      = [];
let speaking         = false;
let voiceInitialized = false; // guards against announcing on the very first data load

function pickEnglishVoice() {
  if (!window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;
  englishVoice =
    voices.find(v => v.lang === 'en-US' && /Google|Microsoft|Samantha|Alex/i.test(v.name)) ||
    voices.find(v => v.lang === 'en-US') ||
    voices.find(v => v.lang && v.lang.toLowerCase().startsWith('en')) ||
    voices[0];
}
if (window.speechSynthesis) {
  pickEnglishVoice();
  window.speechSynthesis.onvoiceschanged = pickEnglishVoice;
}

function processSpeechQueue() {
  if (speaking || !speechQueue.length || !window.speechSynthesis) return;
  speaking = true;
  const text  = speechQueue.shift();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang  = 'en-US';
  if (englishVoice) utter.voice = englishVoice;
  utter.rate  = 0.95;
  utter.pitch = 1;
  utter.onend = utter.onerror = () => { speaking = false; processSpeechQueue(); };

  // Chrome (and some Windows/touchscreen builds) silently clips the first
  // ~0.5s of speech after the engine has been idle for a while — exactly
  // what happens on a kiosk display that isn't speaking constantly. A
  // pause()+resume() right around speak() is the standard workaround.
  window.speechSynthesis.pause();
  window.speechSynthesis.speak(utter);
  window.speechSynthesis.resume();
}

// Keep the speech engine "warm" so it doesn't fall back into the idle
// state that causes clipped audio — harmless no-op while nothing is queued.
setInterval(() => {
  if (window.speechSynthesis && window.speechSynthesis.speaking) {
    window.speechSynthesis.pause();
    window.speechSynthesis.resume();
  }
}, 10000);

function announce(text) {
  if (!voiceEnabled || !window.speechSynthesis) return;
  speechQueue.push(text);
  processSpeechQueue();
}

function announceCall(lane, winNum) {
  const num = lane.serving || 0;
  if (!num) return;
  const prefix    = DEPT_PREFIX[lane.department] || '';
  const ticketId  = prefix + String(num).padStart(3, '0');
  const deptLabel = DEPT_LABEL[lane.department] || `window ${winNum}`;
  announce(`Now serving. Number ${ticketId}. Please proceed to ${deptLabel}', 'Now serving. Number ${ticketId}. Please proceed to ${deptLabel}.`);
}

/* Compare old vs. new lane data and speak for any lane whose serving number just changed */
function detectAndAnnounceChanges(newLanes) {
  if (!voiceInitialized) {
    // First data snapshot ever received — treat as baseline, don't announce it
    voiceInitialized = true;
    return;
  }
  Object.keys(newLanes).forEach(lid => {
    const newLane    = newLanes[lid] || {};
    const oldLane    = lanes[lid] || {};
    const newServing = newLane.serving || 0;
    const oldServing = oldLane.serving || 0;
    const numberChanged   = newServing && newServing !== oldServing;
    const reAnnounced     = newServing && newLane.lastAnnounceId && newLane.lastAnnounceId !== oldLane.lastAnnounceId;
    const isOffline  = presence[lid] && presence[lid].online === false;
    if ((numberChanged || reAnnounced) && !isOffline) {
      const winNum = newLane.windowNumber || 1;
      announceCall(newLane, winNum);
    }
  });
}

/* Sound on/off toggle */
const soundToggle = document.getElementById('sound-toggle');
const soundLabel  = document.getElementById('sound-label');
function updateSoundUI() {
  if (voiceEnabled) {
    soundToggle.classList.remove('muted'); soundToggle.classList.add('on');
    soundLabel.textContent = 'Voice On';
    soundToggle.title = 'Click to mute voice announcements';
  } else {
    soundToggle.classList.remove('on'); soundToggle.classList.add('muted');
    soundLabel.textContent = 'Voice Off';
    soundToggle.title = 'Click to enable voice announcements';
  }
}
updateSoundUI();
soundToggle.addEventListener('click', () => {
  voiceEnabled = !voiceEnabled;
  localStorage.setItem('tv_voice_enabled', String(voiceEnabled));
  updateSoundUI();
  if (voiceEnabled && window.speechSynthesis) {
    // A click is a real user gesture, so this both unlocks audio and confirms it's on
    announce('Voice announcements enabled.');
  } else if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
    speechQueue = [];
    speaking = false;
  }
});

/* ── Render ticket cards — ONLINE ADMINS ONLY ── */
function renderLanes() {
  const row = document.getElementById('lanes-row');

  // Only include lanes where the admin is currently online
  const laneIds = Object.keys(lanes)
    .sort((a,b) => (lanes[a].windowNumber||99) - (lanes[b].windowNumber||99))
    .filter(lid => presence[lid]?.online === true);

  if (!laneIds.length) {
    row.innerHTML = '<div class="no-lanes-msg">No admins currently online…</div>';
    return;
  }

  let html = '';

  laneIds.forEach(lid => {
    const lane      = lanes[lid] || {};
    const adminName = DEPT_LABEL[lane.department] || lane.admin || lid.replace('lane_','');
    const serving   = lane.serving || 0;
    const servStr   = pad(serving, DEPT_PREFIX[lane.department] || '');
    const isDash    = serving === 0;

    html += `
<div class="ticket-card" id="panel-${lid}">
  <div class="tc-label">Now Serving</div>
  <div class="tc-number ${isDash ? 'dash' : ''}" id="lpnum-${lid}">${servStr}</div>
  <div class="tc-pill">
    <span class="tc-status-dot online"></span>
    <span class="tc-pill-label">${adminName}</span>
  </div>
</div>`;
  });

  row.innerHTML = html;
}

/* ── Update ticket numbers (with pop animation, no full re-render) ── */
function updateLaneNumbers() {
  // Only update cards that are currently rendered (online lanes)
  const laneIds = Object.keys(lanes)
    .sort((a,b) => (lanes[a].windowNumber||99) - (lanes[b].windowNumber||99))
    .filter(lid => presence[lid]?.online === true);

  laneIds.forEach(lid => {
    const lane    = lanes[lid] || {};
    const serving = lane.serving || 0;
    const servStr = pad(serving, DEPT_PREFIX[lane.department] || '');
    const el      = document.getElementById('lpnum-' + lid);
    if (!el) return;

    if (el.textContent !== servStr) {
      el.className = 'tc-number';
      void el.offsetWidth; // reflow
      el.textContent = servStr;
      el.className   = serving === 0 ? 'tc-number dash' : 'tc-number flash';
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
    queue = snap.val() ? Object.entries(snap.val()).map(([k,v]) => ({...v, _key:k})) : [];
    refreshStats();
  });

  onValue(ref(db, 'lanes'), snap => {
    const newLanes = snap.val() || {};
    const keysChanged = JSON.stringify(Object.keys(newLanes).sort()) !== JSON.stringify(Object.keys(lanes).sort());
    detectAndAnnounceChanges(newLanes);
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
    const newLanes = Local.getLanes();
    detectAndAnnounceChanges(newLanes);
    lanes = newLanes;
    // Mark all lanes as online in demo mode
    presence = {};
    Object.keys(lanes).forEach(lid => { presence[lid] = { online: true, admin: lanes[lid].admin }; });
    renderLanes();
    refreshStats();
  }, 1500);
  queue = Local.getQueue(); lanes = Local.getLanes();
  Object.keys(lanes).forEach(lid => { presence[lid] = { online: true, admin: lanes[lid].admin }; });
  voiceInitialized = true; // don't announce whatever numbers happen to already be showing on load
  renderLanes(); refreshStats();
}

/* ── Clock + Date ── */
function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent =
    now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  document.getElementById('tv-date').textContent =
    now.toLocaleDateString('en-US', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
}
setInterval(updateClock, 1000); updateClock();