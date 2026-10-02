import { decryptJSON, decryptWithKeyBytes, fromB64 } from './crypto.js';
import { load, save, loadRaw, saveRaw, remove, clearAll } from './storage.js';
import { zonedWallToDate, formatClock } from './time.js';
import { adoptOverlay } from './model.js';
import { showToast } from './toast.js';
import { startUI, draw, afterDrawWeather } from './render.js';
import { BUILD_VERSION } from './buildinfo.js';

const state = {
  trip: null,
  tresor: null,
  overlay: null,
  termine: [],
  now: new Date(),
  tz: '',
  today: '',
  route: 'heute',
  buildVersion: BUILD_VERSION,
  einst: {},
  checks: {},
  belege: [],
  tagebuch: {},
  setlists: {},
  tresorExtra: {},
  probenNotizen: {},
  kurs: null,
  mapFilter: 'heute',
  focusId: null,
  planNotice: false,
  moving: null,
  sheetSlot: null,
  pendingId: null,
  fixOk: false,
  suggestion: null,
  wakeLock: null,
};

const nowParam = new URLSearchParams(location.search).get('now');

function persist() {
  save('plan', state.overlay);
  save('tresor', state.tresorExtra);
  save('setlists', state.setlists);
  save('checks', state.checks);
  save('belege', state.belege);
  save('tagebuch', state.tagebuch);
  save('einst', state.einst);
  save('kurs', state.kurs);
  save('proben', state.probenNotizen);
}

function toast(message, type, action) {
  showToast(message, type, action);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text ?? ''));
    toast('Kopiert', 'success');
  } catch {
    toast('Kopieren ist auf diesem Gerät nicht möglich.', 'error');
  }
}

function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename || 'download.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

async function shareText(text, filename) {
  try {
    if (navigator.share) {
      await navigator.share({ text: String(text ?? '') });
      return;
    }
  } catch { /* Nutzer hat abgebrochen oder Share fehlt */ }
  downloadText(String(text ?? ''), filename || 'notiz.txt', 'text/plain;charset=utf-8');
}

function showGate(message) {
  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  gate.hidden = false;
  app.hidden = true;
  const err = document.getElementById('pwError');
  if (err) err.textContent = message || '';
}

function lockDevice() {
  remove('key');
  showGate('Dieses Gerät ist gesperrt.');
}

function wipeDevice() {
  clearAll();
  showGate('Alles auf diesem Gerät ist gelöscht.');
}

function dropSecretFromUrl() {
  const clean = location.pathname + location.search;
  history.replaceState(null, '', clean);
}

function boot(data) {
  state.trip = data.trip;
  state.tresor = data.tresor;
  state.tz = data.trip.meta.zeitzone;
  state.now = nowParam ? zonedWallToDate(nowParam, state.tz) : new Date();
  state.einst = load('einst', {}) || {};
  state.checks = load('checks', {}) || {};
  state.belege = load('belege', []) || [];
  state.tagebuch = load('tagebuch', {}) || {};
  state.setlists = load('setlists', {}) || {};
  state.tresorExtra = load('tresor', {}) || {};
  state.probenNotizen = load('proben', {}) || {};
  state.kurs = load('kurs', null);
  const adopted = adoptOverlay(load('plan', null), state.trip);
  state.overlay = adopted.overlay;
  state.planNotice = adopted.notice;
  document.title = 'Reisebegleiter';
  document.getElementById('gate').hidden = true;
  document.getElementById('app').hidden = false;
  startUI({ state, persist, toast, lockDevice, wipeDevice, copyText, shareText, downloadText });
  afterDrawWeather();
  if (!nowParam) {
    setInterval(() => {
      state.now = new Date();
      const sub = document.getElementById('subtitle');
      if (sub && state.trip) sub.textContent = sub.textContent.replace(/\d{2}:\d{2}$/, formatClock(state.now, state.tz));
    }, 30000);
  }
}

async function openWithPassphrase(pw) {
  const blob = await loadBlob();
  const { data, keyB64 } = await decryptJSON(blob, pw);
  saveRaw('key', keyB64);
  dropSecretFromUrl();
  boot(data);
}

async function openWithKey(keyB64) {
  const blob = await loadBlob();
  const data = await decryptWithKeyBytes(blob, fromB64(keyB64));
  boot(data);
}

async function loadBlob() {
  const res = await fetch('./data.enc.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Daten nicht erreichbar');
  return res.json();
}

function hashPassphrase() {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  const params = new URLSearchParams(raw);
  return params.get('k') || '';
}

async function start() {
  const errBox = document.getElementById('pwError');
  try {
    const stored = loadRaw('key');
    if (stored) {
      await openWithKey(stored);
      return;
    }
    const fromHash = hashPassphrase();
    if (fromHash) {
      await openWithPassphrase(fromHash);
      return;
    }
    showGate('');
  } catch (e) {
    if (e && e.code === 'BAD_KEY') {
      remove('key');
      showGate('Das Passwort passt nicht. Bitte noch einmal versuchen.');
      return;
    }
    showGate('Die Reisedaten sind gerade nicht erreichbar.');
    if (errBox) errBox.textContent = 'Die Reisedaten sind gerade nicht erreichbar.';
  }
}

document.getElementById('gateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = document.getElementById('pwInput').value;
  if (!pw.trim()) {
    document.getElementById('pwError').textContent = 'Bitte die Passphrase eingeben.';
    return;
  }
  document.getElementById('pwGo').disabled = true;
  document.getElementById('pwError').textContent = 'Schlüssel wird abgeleitet …';
  try {
    await openWithPassphrase(pw);
  } catch (err) {
    document.getElementById('pwGo').disabled = false;
    if (err && err.code === 'BAD_KEY') {
      remove('key');
      document.getElementById('pwError').textContent = 'Das Passwort passt nicht. Bitte noch einmal versuchen.';
    } else {
      document.getElementById('pwError').textContent = 'Die Reisedaten sind gerade nicht erreichbar.';
    }
  }
});

function setupWorker() {
  if (!('serviceWorker' in navigator)) return;
  let regRef = null;
  const banner = document.getElementById('updateBanner');
  const go = document.getElementById('updateGo');
  const firstLoad = !navigator.serviceWorker.controller;
  const onInstalled = (worker) => {
    if (!worker || worker.state !== 'installed') return;
    if (firstLoad || !navigator.serviceWorker.controller) worker.postMessage({ type: 'SKIP_WAITING' });
    else if (banner) banner.hidden = false;
  };
  const watch = (worker) => {
    if (!worker) return;
    if (worker.state === 'installed') onInstalled(worker);
    worker.addEventListener('statechange', () => onInstalled(worker));
  };
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    regRef = reg;
    watch(reg.installing);
    if (reg.waiting) onInstalled(reg.waiting);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    setInterval(() => reg.update().catch(() => {}), 60000);
  }).catch(() => {});
  if (go) {
    go.addEventListener('click', () => {
      const waiting = regRef && regRef.waiting;
      if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        location.reload();
      });
    });
  }
}

setupWorker();
start();

export { draw };
