import { minutes, fmtMinutes, durationMin } from './util.js';
import { wtOf } from './model.js';

const WEEK = [
  ['montag', 'Mo'], ['dienstag', 'Di'], ['mittwoch', 'Mi'], ['donnerstag', 'Do'],
  ['freitag', 'Fr'], ['samstag', 'Sa'], ['sonntag', 'So'],
  ['mo', 'Mo'], ['di', 'Di'], ['mi', 'Mi'], ['do', 'Do'], ['fr', 'Fr'], ['sa', 'Sa'], ['so', 'So'],
];

const FILLER = new Set(['lieber', 'am', 'an', 'auf', 'den', 'dem', 'der', 'die', 'das', 'bitte', 'nach', 'zum', 'zur', 'in', 'fuer', 'für', 'mal', 'doch', 'ein', 'eine', 'ab', 'von', 'bis', 'uhr', 'bitte']);

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function searchItems(query, items) {
  const tokens = norm(query).split(' ').filter(Boolean);
  if (!tokens.length) return [];
  return items.filter((it) => {
    const n = norm(it.titel);
    return tokens.every((t) => n.includes(t));
  });
}

function weekdayCode(phrase) {
  const n = norm(phrase);
  if (!n) return '';
  for (const [word, code] of WEEK) {
    if (n === word) return code;
  }
  return '';
}

function dateFromCode(trip, code) {
  return trip.tage.find((t) => t.wt === code)?.datum || '';
}

function slotFromTime(hhmm) {
  const m = minutes(hhmm);
  if (m < 12 * 60 + 30) return 'vormittag';
  if (m < 18 * 60) return 'nachmittag';
  return 'abend';
}

function extract(trip, text, todayYmd) {
  let s = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const out = { tag: '', slot: '', start: '', schedule: false, raw: s };
  if (/\beinplanen\b/.test(s)) {
    out.schedule = true;
    s = s.replace(/\beinplanen\b/g, ' ');
  }
  if (/\bübermorgen\b|\buebermorgen\b/.test(s)) {
    out.tag = shift(trip, todayYmd, 2);
    s = s.replace(/\bübermorgen\b|\buebermorgen\b/g, ' ');
  } else if (/\bmorgen\b/.test(s)) {
    out.tag = shift(trip, todayYmd, 1);
    s = s.replace(/\bmorgen\b/g, ' ');
  }
  const full = s.match(/\b(\d{1,2})\.(\d{1,2})\.(?:\d{2,4})?/);
  if (full) {
    const hit = trip.tage.find((d) => {
      const [, m, dd] = d.datum.split('-');
      return Number(dd) === Number(full[1]) && Number(m) === Number(full[2]);
    });
    if (hit) out.tag = hit.datum;
    s = s.replace(full[0], ' ');
  } else {
    const dayOnly = s.match(/\b(\d{1,2})\.(?!\d)/);
    if (dayOnly) {
      const hit = trip.tage.find((d) => Number(d.datum.slice(8, 10)) === Number(dayOnly[1]));
      if (hit) out.tag = hit.datum;
      s = s.replace(dayOnly[0], ' ');
    }
  }
  const um = s.match(/\bum\s*(\d{1,2})(?::(\d{2}))?/);
  const colon = s.match(/\b(\d{1,2}):(\d{2})\b/);
  const tm = um || colon;
  if (tm) {
    const h = Math.min(23, Number(tm[1]));
    const mi = String(tm[2] != null ? Number(tm[2]) : 0).padStart(2, '0');
    out.start = String(h).padStart(2, '0') + ':' + mi;
    s = s.replace(tm[0], ' ');
  }
  if (/\bvormittag|\bmorgens\b/.test(s)) { out.slot = 'vormittag'; s = s.replace(/\bvormittags?\b|\bmorgens\b/g, ' '); }
  else if (/\bnachmittag/.test(s)) { out.slot = 'nachmittag'; s = s.replace(/\bnachmittags?\b/g, ' '); }
  else if (/\babend/.test(s)) { out.slot = 'abend'; s = s.replace(/\babends?\b/g, ' '); }
  for (const [word, code] of WEEK) {
    const re = new RegExp('\\b' + word + '\\b', 'i');
    if (re.test(s)) {
      if (!out.tag) out.tag = dateFromCode(trip, code);
      out.wt = code;
      s = s.replace(re, ' ');
      break;
    }
  }
  out.query = s.split(' ').filter((w) => w && !FILLER.has(w)).join(' ').trim();
  return out;
}

function shift(trip, today, n) {
  if (!today) return '';
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  const ymd = dt.toISOString().slice(0, 10);
  return trip.tage.some((t) => t.datum === ymd) ? ymd : '';
}

function ask(prompt, candidates) {
  return { type: 'ask', prompt, candidates };
}

export function interpret(trip, termine, text, todayYmd) {
  const raw = String(text || '').trim();
  if (!raw) return { type: 'noop', message: 'Bitte einen Satz eingeben.' };
  const lower = raw.toLowerCase().replace(/\s+/g, ' ');
  if (/\btauschen\b/.test(lower)) {
    const mm = lower.match(/^(.*)\sund\s(.*)\s+tauschen$/);
    if (!mm) return ask('Was soll getauscht werden?', []);
    const left = mm[1].trim();
    const right = mm[2].trim();
    const wl = weekdayCode(left);
    const wr = weekdayCode(right);
    if (wl && wr) {
      const a = dateFromCode(trip, wl);
      const b = dateFromCode(trip, wr);
      if (!a || !b) return { type: 'noop', message: 'Diese Tage liegen nicht im Plan.' };
      return { type: 'swap-days', a, b };
    }
    const L = searchItems(left, termine);
    const R = searchItems(right, termine);
    if (L.length !== 1 || R.length !== 1) {
      const candidates = [...L, ...R].map((t) => ({ id: t.id, titel: t.titel, kind: 'tausch' }));
      return ask('Welche Termine meinst du?', candidates);
    }
    return { type: 'swap-events', a: L[0].id, b: R[0].id };
  }

  const ex = extract(trip, lower, todayYmd);
  const pool = trip.ideenPool || [];
  let items = ex.schedule ? [] : searchItems(ex.query, termine);
  let fromPool = false;
  if (!items.length) {
    items = searchItems(ex.query, pool);
    fromPool = true;
  }
  if (!ex.query) return { type: 'noop', message: 'Ich habe den Termin nicht erkannt.' };
  if (items.length === 0) return { type: 'noop', message: 'Nichts gefunden. Bitte anders formulieren.' };
  if (items.length > 1) {
    return ask('Welchen meinst du?', items.map((t) => ({ id: t.id, titel: t.titel, kind: fromPool ? 'pool' : 'termin' })));
  }
  const hit = items[0];
  if (!ex.tag && !ex.start && !ex.slot) {
    return ask('Wohin damit?', trip.tage.map((t) => ({ id: t.datum, titel: `${t.wt} ${t.datum.slice(8, 10)}.${t.datum.slice(5, 7)}.`, kind: fromPool || ex.schedule ? 'pool-day' : 'day', ref: hit.id })));
  }
  const slot = ex.slot || (ex.start ? slotFromTime(ex.start) : (hit.slot || hit.slotEmpfehlung || 'vormittag'));
  const tag = ex.tag || hit.tag;
  if (!tag) return ask('An welchem Tag?', trip.tage.map((t) => ({ id: t.datum, titel: t.wt, kind: 'day', ref: hit.id })));
  if (fromPool || ex.schedule) {
    return { type: 'schedule', poolId: hit.id.startsWith('pool-') ? hit.id : hit.id, tag, slot, start: ex.start || '' };
  }
  return { type: 'move', id: hit.id, tag, slot, start: ex.start || hit.start };
}

export function describeMove(trip, ev) {
  const day = trip.tage.find((t) => t.datum === ev.tag);
  const label = day ? `${day.wt} ${day.datum.slice(8, 10)}.${day.datum.slice(5, 7)}.` : ev.tag;
  return `${ev.titel} → ${label} ${slotWord(ev.slot)}`;
}

function slotWord(slot) {
  return { vormittag: 'vormittags', nachmittag: 'nachmittags', abend: 'abends' }[slot] || slot;
}

export { fmtMinutes, durationMin, wtOf };
