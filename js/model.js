import { minutes, fmtMinutes, durationMin, interval, overlaps, clone, addDays } from './util.js';
import { eventBounds } from './time.js';

export const SLOTS = ['vormittag', 'nachmittag', 'abend'];
export const SLOT_LABEL = { vormittag: 'vormittags', nachmittag: 'nachmittags', abend: 'abends' };

export function emptyOverlay(version) {
  return { saatVersion: version, aenderungen: {}, eigene: [], entfernt: [], erledigt: [], verlauf: [] };
}

export function adoptOverlay(raw, trip) {
  const version = trip.meta.planVersion || 1;
  const base = emptyOverlay(version);
  if (!raw || typeof raw !== 'object') return { overlay: base, notice: false };
  const overlay = {
    saatVersion: raw.saatVersion || 0,
    aenderungen: raw.aenderungen && typeof raw.aenderungen === 'object' ? raw.aenderungen : {},
    eigene: Array.isArray(raw.eigene) ? raw.eigene : [],
    entfernt: Array.isArray(raw.entfernt) ? raw.entfernt : [],
    erledigt: Array.isArray(raw.erledigt) ? raw.erledigt : [],
    verlauf: Array.isArray(raw.verlauf) ? raw.verlauf.slice(-10) : [],
  };
  let notice = false;
  const previous = overlay.saatVersion || 0;
  if (previous < version) {
    const ids = new Set(trip.termine.map((t) => t.id));
    for (const id of Object.keys(overlay.aenderungen)) {
      if (!ids.has(id)) delete overlay.aenderungen[id];
    }
    overlay.entfernt = overlay.entfernt.filter((id) => ids.has(id));
    overlay.erledigt = overlay.erledigt.filter((id) => ids.has(id) || overlay.eigene.some((e) => e.id === id));
    overlay.saatVersion = version;
    notice = previous > 0;
  }
  return { overlay, notice };
}

export function mergeTermine(trip, overlay) {
  const removed = new Set(overlay.entfernt || []);
  const list = [];
  for (const t of trip.termine) {
    if (removed.has(t.id)) continue;
    const patch = overlay.aenderungen?.[t.id];
    list.push(patch ? { ...t, ...patch, id: t.id } : { ...t });
  }
  for (const e of overlay.eigene || []) list.push({ ...e });
  return list;
}

function snapOf(overlay) {
  return {
    saatVersion: overlay.saatVersion,
    aenderungen: clone(overlay.aenderungen),
    eigene: clone(overlay.eigene),
    entfernt: clone(overlay.entfernt),
    erledigt: clone(overlay.erledigt),
  };
}

export function pushHistory(overlay) {
  overlay.verlauf = overlay.verlauf || [];
  overlay.verlauf.push(snapOf(overlay));
  if (overlay.verlauf.length > 10) overlay.verlauf.shift();
}

export function undo(overlay) {
  const prev = (overlay.verlauf || []).pop();
  if (!prev) return false;
  overlay.aenderungen = prev.aenderungen;
  overlay.eigene = prev.eigene;
  overlay.entfernt = prev.entfernt;
  overlay.erledigt = prev.erledigt;
  overlay.saatVersion = prev.saatVersion;
  return true;
}

export function wtOf(trip, tag) {
  return trip.tage.find((t) => t.datum === tag)?.wt || '';
}

export function findMerged(termine, id) {
  return termine.find((t) => t.id === id) || null;
}

function writePatch(overlay, trip, id, fields) {
  const own = overlay.eigene.find((e) => e.id === id);
  if (own) {
    Object.assign(own, fields);
    return;
  }
  const seed = trip.termine.find((t) => t.id === id);
  if (!seed) return;
  overlay.aenderungen[id] = { ...(overlay.aenderungen[id] || {}), ...fields };
}

export function applyFields(overlay, trip, id, fields) {
  pushHistory(overlay);
  writePatch(overlay, trip, id, fields);
}

export function setDone(overlay, id, on) {
  pushHistory(overlay);
  const set = new Set(overlay.erledigt);
  if (on) set.add(id); else set.delete(id);
  overlay.erledigt = [...set];
}

export function removeEvent(overlay, trip, id) {
  pushHistory(overlay);
  if (overlay.eigene.some((e) => e.id === id)) {
    overlay.eigene = overlay.eigene.filter((e) => e.id !== id);
  } else if (trip.termine.some((t) => t.id === id)) {
    if (!overlay.entfernt.includes(id)) overlay.entfernt.push(id);
    delete overlay.aenderungen[id];
  }
}

export function addOwn(overlay, event) {
  pushHistory(overlay);
  overlay.eigene.push(event);
}

function othersOn(termine, id, tag) {
  return termine.filter((t) => t.id !== id && t.tag === tag);
}

export function closedReason(trip, ev, tag) {
  const wt = wtOf(trip, tag);
  const fromEv = ev.geschlossenAn || [];
  const fromOrt = trip.orte[ev.ort]?.geschlossenAn || [];
  const days = [...fromEv, ...fromOrt];
  if (days.includes(wt)) return `geschlossen (${wt})`;
  if (ev.milonga) {
    const m = trip.milongas.find((x) => x.id === ev.milonga);
    if (m && m.wt !== wt) {
      const alt = trip.milongas.find((x) => x.wt === wt);
      return alt ? `nur ${m.wt} · stattdessen ${alt.name}` : `nur ${m.wt}`;
    }
  }
  return '';
}

export function collectWarnings(trip, termine, ev) {
  const warnings = [];
  const closed = closedReason(trip, ev, ev.tag);
  if (closed) warnings.push(closed);
  const dayEvents = othersOn(termine, ev.id, ev.tag);
  const iv = interval(ev);
  for (const o of dayEvents) {
    if (overlaps(iv, interval(o))) warnings.push(`überschneidet „${o.titel}“`);
  }
  if (ev.kat === 'tango') {
    const end = iv[1];
    const next = addDays(ev.tag, 1);
    const concert = termine.some((t) => t.tag === next && t.kat === 'konzert');
    if (concert && end > 23 * 60 + 30) warnings.push('morgen ist Konzert – Schluss um 23:30?');
  }
  if (ev.kat === 'tourismus') {
    const concertDay = termine.some((t) => t.tag === ev.tag && t.kat === 'konzert' && t.id !== ev.id)
      || (ev.kat === 'konzert');
    if (concertDay || termine.some((t) => t.tag === ev.tag && t.kat === 'konzert')) {
      let sum = durationMin(ev);
      for (const o of dayEvents) if (o.kat === 'tourismus') sum += durationMin(o);
      if (sum > 180 && termine.some((t) => t.tag === ev.tag && t.kat === 'konzert')) {
        warnings.push('mehr als 3 Stunden Stadtprogramm an einem Konzerttag');
      }
    }
  }
  return [...new Set(warnings)];
}

export function fixOverlap(termine, ev) {
  const iv = interval(ev);
  return othersOn(termine, ev.id, ev.tag).find((o) => o.fix && overlaps(iv, interval(o))) || null;
}

export function occupant(termine, ev) {
  return othersOn(termine, ev.id, ev.tag).find((o) => !o.fix && o.slot === ev.slot) || null;
}

export function suggestStart(termine, ev, tag) {
  const dur = durationMin(ev);
  const blocks = othersOn(termine, ev.id, tag).map(interval).sort((a, b) => a[0] - b[0]);
  let cursor = 8 * 60;
  const endDay = 22 * 60;
  for (const [a, b] of blocks) {
    if (a - cursor >= dur) return fmtMinutes(cursor);
    cursor = Math.max(cursor, b);
  }
  if (endDay - cursor >= dur) return fmtMinutes(cursor);
  return null;
}

export function chipKind(trip, termine, ev, tag, slot) {
  const draft = { ...ev, tag, slot };
  const reason = closedReason(trip, draft, tag);
  if (reason) return { kind: 'bad', reason };
  const occ = othersOn(termine, ev.id, tag).find((o) => !o.fix && o.slot === slot);
  if (occ) return { kind: 'busy', reason: 'belegt', occupantId: occ.id };
  return { kind: 'free', reason: '' };
}

export function placeEvent(overlay, trip, termine, id, tag, slot, start) {
  const ev = findMerged(termine, id);
  if (!ev) return { ok: false, message: 'Termin nicht gefunden' };
  const dur = durationMin(ev);
  const next = { ...ev, tag, slot: slot || ev.slot, start: start || ev.start };
  next.ende = fmtMinutes(minutes(next.start) + dur);
  const hit = fixOverlap(termine, next);
  if (hit) {
    const suggestion = suggestStart(termine, next, tag);
    return { ok: false, blocked: true, hit, suggestion, ev: next };
  }
  const occ = occupant(termine, next);
  const warnings = collectWarnings(trip, termine.filter((t) => t.id !== id), next);
  pushHistory(overlay);
  writePatch(overlay, trip, id, { tag: next.tag, slot: next.slot, start: next.start, ende: next.ende });
  return { ok: true, warnings, occupant: occ, ev: next };
}

export function exchangePlaces(overlay, trip, termine, idA, idB) {
  const a = findMerged(termine, idA);
  const b = findMerged(termine, idB);
  if (!a || !b) return { ok: false };
  pushHistory(overlay);
  const aDur = durationMin(a);
  const bDur = durationMin(b);
  writePatch(overlay, trip, idA, { tag: b.tag, slot: b.slot, start: a.start, ende: fmtMinutes(minutes(a.start) + aDur) });
  writePatch(overlay, trip, idB, { tag: a.tag, slot: a.slot, start: b.start, ende: fmtMinutes(minutes(b.start) + bDur) });
  return { ok: true };
}

export function swapDays(overlay, trip, termine, tagA, tagB) {
  const moving = termine.filter((t) => !t.fix && (t.tag === tagA || t.tag === tagB));
  pushHistory(overlay);
  const warnings = [];
  for (const t of moving) {
    const tag = t.tag === tagA ? tagB : tagA;
    const dur = durationMin(t);
    const next = { ...t, tag, ende: fmtMinutes(minutes(t.start) + dur) };
    warnings.push(...collectWarnings(trip, termine.filter((x) => x.id !== t.id), next));
    writePatch(overlay, trip, t.id, { tag });
  }
  return { ok: true, warnings: [...new Set(warnings)], count: moving.length };
}

export function schedulePool(overlay, trip, termine, poolId, tag, slot, start) {
  const idea = trip.ideenPool.find((i) => i.id === poolId);
  if (!idea) return { ok: false, message: 'Idee nicht gefunden' };
  const id = 'eigen-' + idea.id;
  if (overlay.eigene.some((e) => e.id === id) || termine.some((t) => t.id === id)) {
    return placeEvent(overlay, trip, termine, id, tag, slot || idea.slotEmpfehlung || 'vormittag', start);
  }
  const hours = Number(idea.dauerStunden) || 2;
  const dur = Math.round(hours * 60);
  const slotUse = slot || idea.slotEmpfehlung || 'vormittag';
  const startUse = start || (slotUse === 'nachmittag' ? '13:00' : slotUse === 'abend' ? '19:00' : '10:00');
  const ev = {
    id,
    titel: idea.titel,
    kat: idea.kat,
    ort: idea.ort,
    status: idea.status || 'vorschlag',
    notiz: idea.notiz || '',
    fix: false,
    tag,
    slot: slotUse,
    start: startUse,
    ende: fmtMinutes(minutes(startUse) + dur),
    draussen: !!idea.draussen,
    regenAlternative: idea.regenAlternative || '',
    geschlossenAn: idea.geschlossenAn || [],
    milonga: idea.milonga || '',
    stationen: idea.stationen || [],
    ausPool: idea.id,
  };
  const hit = fixOverlap(termine, ev);
  if (hit) {
    return { ok: false, blocked: true, hit, suggestion: suggestStart(termine, ev, tag), ev };
  }
  const warnings = collectWarnings(trip, termine, ev);
  pushHistory(overlay);
  overlay.eigene.push(ev);
  return { ok: true, warnings, ev, fresh: true };
}

export function balance(termine, tag) {
  const groups = { Stadt: 0, Musik: 0, Tango: 0, Pause: 0 };
  const map = {
    tourismus: 'Stadt', konzert: 'Musik', probe: 'Musik', online: 'Musik',
    tango: 'Tango', pause: 'Pause', essen: 'Pause', reise: 'Pause', unterkunft: 'Pause',
  };
  for (const t of termine) {
    if (t.tag !== tag) continue;
    const g = map[t.kat] || 'Pause';
    groups[g] += durationMin(t);
  }
  const sum = Object.values(groups).reduce((a, b) => a + b, 0) || 1;
  return { groups, sum };
}

export function nextUp(termine, now, tz) {
  const rows = termine.map((ev) => ({ ev, ...eventBounds(ev, tz) })).sort((a, b) => a.start - b.start);
  const current = rows.find((r) => now >= r.start && now < r.end);
  if (current) return { mode: 'jetzt', ev: current.ev, at: current.start };
  const upcoming = rows.find((r) => r.start > now);
  if (upcoming) return { mode: 'naechstes', ev: upcoming.ev, at: upcoming.start };
  return null;
}

export function sortedDay(termine, tag) {
  return termine.filter((t) => t.tag === tag).sort((a, b) => minutes(a.start) - minutes(b.start) || a.titel.localeCompare(b.titel));
}

export const STATUS_MARK = { bestaetigt: '✔', kalender: '❓', vorschlag: '', pruefen: '🔎' };
export const KAT_ICON = {
  reise: '✈️', unterkunft: '🏠', konzert: '🎼', probe: '🎹', tango: '💃',
  tourismus: '🏛️', essen: '🍽️', pause: '🌿', online: '💻',
};
