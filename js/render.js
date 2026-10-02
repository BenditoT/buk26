import { esc, deDate, minutes, csvNum, uid, durationMin } from './util.js';
import { ymdInZone, formatClock, relPhrase, eventBounds } from './time.js';
import {
  SLOTS, SLOT_LABEL, STATUS_MARK, KAT_ICON, mergeTermine, placeEvent, exchangePlaces,
  swapDays, schedulePool, undo, balance, nextUp, sortedDay, chipKind, collectWarnings,
  applyFields, setDone, removeEvent, addOwn, wtOf, findMerged, suggestStart,
} from './model.js';
import { interpret, describeMove } from './commands.js';
import { renderMap, destroyMap, locateMe } from './mapview.js';

let ctx;

export function startUI(c) {
  ctx = c;
  document.body.addEventListener('click', onClick);
  document.body.addEventListener('change', onChange);
  document.body.addEventListener('submit', onSubmit);
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', draw);
  if (!location.hash) location.hash = '#heute';
  draw();
}

function S() { return ctx.state; }

function route() {
  const h = location.hash.replace('#', '').split('?')[0];
  return h || 'heute';
}

function go(name) {
  closeSheet();
  if (location.hash.replace('#', '') === name) draw();
  else location.hash = name;
}

function draw() {
  const state = S();
  state.termine = mergeTermine(state.trip, state.overlay);
  state.today = ymdInZone(state.now, state.tz);
  state.route = route();
  const app = document.getElementById('app');
  if (!app || app.hidden) return;
  const kicker = document.getElementById('kicker');
  const title = document.getElementById('title');
  const sub = document.getElementById('subtitle');
  kicker.textContent = state.trip.meta.untertitel || '';
  title.textContent = state.trip.meta.titel || 'Reisebegleiter';
  sub.textContent = `${deDate(state.trip.meta.von)}–${deDate(state.trip.meta.bis)} · ${formatClock(state.now, state.tz)}`;
  const dock = dockKey(state.route);
  document.querySelectorAll('.dock button').forEach((b) => {
    b.setAttribute('aria-current', b.dataset.go === dock ? 'page' : 'false');
  });
  const root = document.getElementById('view');
  destroyMap();
  const painters = {
    heute: viewHeute, plan: viewPlan, karte: viewKarte, musik: viewMusik, mehr: viewMehr,
    buchungen: viewBuchungen, notfall: viewNotfall, sprache: viewSprache, belege: viewBelege,
    checks: viewChecks, tagebuch: viewTagebuch, praktisch: viewPraktisch,
    konzerte: viewKonzerte, setlist: viewSetlist, proben: viewProben, milongas: viewMilongas,
    buehne: viewBuehne, stimm: viewStimm,
  };
  (painters[state.route] || viewHeute)(root, state);
  if (state.route === 'heute') loadWeather(state);
  if (state.planNotice) {
    ctx.toast('Plan aktualisiert', 'info');
    state.planNotice = false;
  }
}

function dockKey(r) {
  if (['buchungen', 'notfall', 'belege', 'checks', 'tagebuch', 'praktisch'].includes(r)) return 'mehr';
  if (['konzerte', 'setlist', 'proben', 'milongas', 'buehne', 'sprache', 'stimm'].includes(r)) return 'musik';
  return ['plan', 'karte', 'musik', 'mehr'].includes(r) ? r : 'heute';
}

function placeOf(state, ortId, ortText) {
  if (ortText) return { name: ortText, adresse: ortText, lat: null, lon: null, hinweis: '', tel: '' };
  const o = state.trip.orte[ortId] || { name: 'Ort offen', adresse: '', lat: null, lon: null };
  if (ortId === 'unterkunft' && state.tresor?.unterkunft) {
    const u = state.tresor.unterkunft;
    return {
      ...o,
      name: u.name || o.name,
      adresse: u.adresse || o.adresse,
      lat: u.lat ?? o.lat,
      lon: u.lon ?? o.lon,
      tel: u.telefonGastgeber || o.tel || '',
      hinweis: o.hinweis || '',
    };
  }
  return { hinweis: '', tel: '', ...o };
}

function mapsUrl(p) {
  if (p && p.lat != null && p.lon != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}&travelmode=transit`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent((p && (p.adresse || p.name)) || '')}&travelmode=transit`;
}

function boltUrl() { return 'https://bolt.eu/'; }

function labelOf(state, ev) {
  return ev.ortText || placeOf(state, ev.ort).name || '';
}

function whenPhrase(ev, state) {
  const extra = ev.zeitzone && ev.zeitzone !== state.tz ? ' (dt. Zeit)' : '';
  return `${ev.start}–${ev.ende}${extra}`;
}

function back(label = 'Zurück') {
  return `<button type="button" class="btn ghost" data-act="back">${esc(label)}</button>`;
}

function viewHeute(root, state) {
  const phase = state.today < state.trip.meta.von ? 'vor' : state.today > state.trip.meta.bis ? 'nach' : 'in';
  if (phase === 'vor') root.innerHTML = heuteVor(state);
  else if (phase === 'nach') root.innerHTML = heuteNach(state);
  else root.innerHTML = heuteIn(state);
}

function daysBetween(a, b) {
  const A = Date.parse(a + 'T00:00:00Z');
  const B = Date.parse(b + 'T00:00:00Z');
  return Math.round((B - A) / 86400000);
}

function heuteVor(state) {
  const n = daysBetween(state.today, state.trip.meta.von);
  const text = n <= 0 ? 'Heute geht es los' : n === 1 ? 'Noch 1 Tag' : `Noch ${n} Tage`;
  const items = [...state.trip.vorDerReise].sort((a, b) => a.bis.localeCompare(b.bis));
  const checks = state.checks || {};
  return `
    <section class="card hero-card">
      <h2>${esc(text)}</h2>
      <p class="lead">${esc(state.trip.meta.zeitHinweis || '')}</p>
    </section>
    <section class="card">
      <h2>Vor der Reise</h2>
      ${items.map((it) => {
        const late = it.bis < state.today;
        const on = !!checks[it.id];
        return `<label class="check-row ${late && !on ? 'overdue' : ''} ${on ? 'done' : ''}">
          <input type="checkbox" data-check="${esc(it.id)}" ${on ? 'checked' : ''}>
          <span><b>${esc(it.titel)}</b><br><span class="note">bis ${esc(deDate(it.bis))} · ${esc(it.detail || '')}</span></span>
        </label>`;
      }).join('')}
      <button type="button" class="btn" data-go="checks">Packliste öffnen</button>
    </section>
    <section class="card">
      <h2>Offene Fragen</h2>
      ${(state.trip.offeneFragen || []).map((q) => `<p class="hl">${esc(q)}</p>`).join('') || '<p>Keine offenen Fragen.</p>'}
    </section>`;
}

function heuteIn(state) {
  const up = nextUp(state.termine, state.now, state.tz);
  const day = state.trip.tage.find((t) => t.datum === state.today);
  const morgen = state.trip.tage.find((t) => t.datum > state.today);
  const morgenEv = morgen ? sortedDay(state.termine, morgen.datum)[0] : null;
  return `
    ${up ? nextCard(state, up) : '<section class="card"><h2>Alles erledigt</h2></section>'}
    <div class="tiles">
      ${tile('heim', '🏠', 'Heim')}
      ${tile('buchungen', '🎫', 'Buchungen', true)}
      ${tile('setlist-next', '🎼', 'Setlist')}
      ${tile('milonga-heute', '💃', 'Milonga heute')}
      ${tile('karte', '🗺️', 'Karte', true)}
      ${tile('sprache', '🗣️', 'Sprache', true)}
      ${tile('belege', '🧾', 'Beleg', true)}
      ${tile('notfall', '🆘', 'Notfall', true)}
    </div>
    <section class="card">
      <h2>${esc(day ? day.wt + ' ' + deDate(day.datum) + ' · ' + day.motto : '')}</h2>
      <p class="lead">${esc(day?.hinweis || '')}</p>
      <div id="wetter" class="note">Wetter wird geladen …</div>
      ${timeline(state, state.today)}
      <p class="note">Morgen: ${morgenEv ? esc(morgenEv.titel) : '–'}</p>
    </section>`;
}

function tile(act, icon, label, isGo) {
  const attr = isGo ? `data-go="${act}"` : `data-act="${act}"`;
  return `<button type="button" class="tile" ${attr}><span>${icon}</span>${esc(label)}</button>`;
}

function nextCard(state, up) {
  const ev = up.ev;
  const p = placeOf(state, ev.ort, ev.ortText);
  const rel = up.mode === 'jetzt' ? 'Jetzt' : `Als Nächstes · ${relPhrase(up.at - state.now)}`;
  const tel = p.tel || '';
  return `<section class="card next-card" data-next="${esc(ev.id)}">
    <p class="when">${esc(rel)}</p>
    <h2>${esc(KAT_ICON[ev.kat] || '')} ${esc(ev.titel)}</h2>
    <p><b>${esc(whenPhrase(ev, state))}</b> · ${esc(labelOf(state, ev))}</p>
    <div class="btn-row">
      <a class="btn" href="${mapsUrl(p)}" target="_blank" rel="noopener">Route</a>
      <a class="btn ghost" href="${boltUrl()}" target="_blank" rel="noopener">Bolt</a>
      ${tel ? `<a class="btn ghost" href="tel:${esc(tel)}">Anrufen</a>` : ''}
      <button type="button" class="btn ghost" data-act="open" data-id="${esc(ev.id)}">Details</button>
    </div>
  </section>`;
}

function timeline(state, tag) {
  const done = new Set(state.overlay.erledigt || []);
  return SLOTS.map((slot) => {
    const items = sortedDay(state.termine, tag).filter((t) => t.slot === slot);
    return `<h3 class="slot-h">${esc(slot)}</h3>` + (items.length ? items.map((ev) => rowEvent(state, ev, done, true)).join('') : '<p class="note">–</p>');
  }).join('');
}

function rowEvent(state, ev, done, withCheck) {
  const on = done.has(ev.id);
  const rain = state.einst?.regen && ev.draussen && ev.regenAlternative;
  return `<article class="ev kat-${esc(ev.kat)} ${on ? 'done' : ''}" data-id="${esc(ev.id)}">
    ${withCheck ? `<label class="check-row tight"><input type="checkbox" data-done="${esc(ev.id)}" ${on ? 'checked' : ''}><span></span></label>` : ''}
    <button type="button" class="ev-main" data-act="open" data-id="${esc(ev.id)}">
      <b>${esc(ev.start)} ${esc(ev.titel)}</b>
      ${ev.fix ? ' 🔒' : ''} ${STATUS_MARK[ev.status] || ''}
      <div class="note">${esc(labelOf(state, ev))}${rain ? ' · Regen: ' + esc(ev.regenAlternative) : ''}</div>
      ${ev.status === 'kalender' ? '<div class="hl">Details offen – tippen zum Eintragen</div>' : ''}
    </button>
  </article>`;
}

function heuteNach(state) {
  const days = Object.entries(state.tagebuch || {});
  return `<section class="card"><h2>Rückblick</h2>
    ${days.length ? days.map(([d, t]) => `<p><b>${esc(deDate(d))}</b><br>${esc(t)}</p>`).join('') : '<p>Noch keine Einträge im Tagebuch.</p>'}
    <button type="button" class="btn" data-act="export-belege">Belege exportieren</button>
    <button type="button" class="btn ghost" data-act="export-diary">Tagebuch exportieren</button>
  </section>`;
}

function viewPlan(root, state) {
  const regen = !!state.einst?.regen;
  root.innerHTML = `
    <form id="cmdForm" class="cmd">
      <label class="sr" for="cmdText">Schnellbefehl</label>
      <input id="cmdText" name="cmd" autocomplete="off" placeholder="Termin und Wochentag">
      <button type="submit" class="btn">Los</button>
    </form>
    <div id="cmdAsk"></div>
    <div class="btn-row wrap">
      <button type="button" class="btn ghost" data-act="undo" ${state.overlay.verlauf?.length ? '' : 'disabled'}>Rückgängig</button>
      <button type="button" class="btn ghost" data-act="new-event">+ Termin</button>
      <button type="button" class="btn ghost" data-act="swap-open">Zwei Tage tauschen</button>
      <button type="button" class="btn ghost" data-act="restore">Originalplan</button>
      <label class="switch"><input type="checkbox" id="regen" ${regen ? 'checked' : ''}> Regen</label>
    </div>
    ${state.trip.tage.map((day) => dayBlock(state, day)).join('')}
    <section class="card">
      <h2>Ideen-Pool</h2>
      ${(state.trip.ideenPool || []).map((idea) => `
        <article class="ev kat-${esc(idea.kat)}" data-pool="${esc(idea.id)}">
          <div class="ev-main"><b>${esc(KAT_ICON[idea.kat] || '')} ${esc(idea.titel)}</b>
            <div class="note">${esc(idea.notiz || '')}</div></div>
          <button type="button" class="btn" data-act="schedule" data-pool="${esc(idea.id)}">Einplanen</button>
        </article>`).join('')}
    </section>`;
}

function dayBlock(state, day) {
  const today = day.datum === state.today ? ' today' : '';
  const bal = balance(state.termine, day.datum);
  const parts = ['Stadt', 'Musik', 'Tango', 'Pause'].map((g) => {
    const w = Math.round((bal.groups[g] / bal.sum) * 100);
    return `<i class="b-${g.toLowerCase()}" style="width:${w}%"></i>`;
  }).join('');
  return `<section class="day${today}" data-day="${esc(day.datum)}">
    <h2>${esc(day.wt)} ${esc(deDate(day.datum))} · ${esc(day.motto)}</h2>
    <div class="balance" title="Stadt / Musik / Tango / Pause">${parts}</div>
    ${SLOTS.map((slot) => `<div data-slot="${slot}"><h3 class="slot-h">${esc(slot)}</h3>
      ${sortedDay(state.termine, day.datum).filter((t) => t.slot === slot).map((ev) => planCard(state, ev)).join('') || '<p class="note">–</p>'}
    </div>`).join('')}
  </section>`;
}

function planCard(state, ev) {
  const rain = state.einst?.regen && ev.draussen && ev.regenAlternative;
  return `<article class="ev kat-${esc(ev.kat)}" data-id="${esc(ev.id)}">
    <button type="button" class="ev-main" data-act="open" data-id="${esc(ev.id)}">
      <b>${esc(KAT_ICON[ev.kat] || '')} ${esc(ev.start)} ${esc(ev.titel)}</b>
      ${ev.fix ? ' 🔒' : ''} ${STATUS_MARK[ev.status] || ''}
      <div class="note">${esc(labelOf(state, ev))}${ev.zeitzone && ev.zeitzone !== state.tz ? ' (dt. Zeit)' : ''}</div>
      ${rain ? `<div class="hl">${esc(ev.regenAlternative)}</div>` : ''}
      ${ev.status === 'kalender' ? '<div class="hl">Details offen – tippen zum Eintragen</div>' : ''}
    </button>
    ${ev.fix ? '' : `<button type="button" class="btn icon" data-act="move" data-id="${esc(ev.id)}" aria-label="Verschieben">↔</button>`}
  </article>`;
}

function viewKarte(root, state) {
  root.innerHTML = '<div id="mapHost"></div>';
  renderMap(root, {
    state, placeOf, mapsUrl, esc,
  });
}

function viewMusik(root) {
  root.innerHTML = `<section class="card"><h2>Musik</h2>
    <div class="tiles">
      ${tile('konzerte', '🎼', 'Konzerte', true)}
      ${tile('setlist', '📋', 'Setlist', true)}
      ${tile('milongas', '💃', 'Tango-Abende', true)}
      ${tile('proben', '🎹', 'Proben', true)}
      ${tile('sprache', '🗣️', 'Sprache', true)}
      ${tile('buehne', '🌙', 'Bühne', true)}
      ${tile('stimm', '🔔', 'Stimmton', true)}
    </div></section>`;
}

function viewMehr(root, state) {
  root.innerHTML = `<section class="card"><h2>Mehr</h2>
    <div class="links">
      ${more('buchungen', 'Buchungen')}
      ${more('checks', 'Vor der Reise & Packliste')}
      ${more('belege', 'Belege')}
      ${more('tagebuch', 'Tagebuch')}
      ${more('praktisch', 'Praktisches & Notfall')}
      ${more('notfall', 'Notruf')}
    </div>
    ${state.einst?.installSeen ? '' : `<p class="hl" id="installHint">Zum Home-Bildschirm: Teilen-Menü, dann „Zum Home-Bildschirm“.</p><button type="button" class="btn ghost" data-act="install-seen">Hinweis verstanden</button>`}
    <p class="note">Stand dieser Ausgabe: ${esc(state.buildVersion || '')}</p>
    <button type="button" class="btn ghost" data-act="share-plan">Plan als Text</button>
    <button type="button" class="btn ghost" data-act="export-ics">Fixpunkte als Kalender</button>
    <button type="button" class="btn ghost" data-act="export-backup">Sicherung exportieren</button>
    <label class="btn ghost file">Sicherung laden<input type="file" id="importFile" accept="application/json"></label>
    <button type="button" class="btn ghost" data-act="lock">Dieses Gerät sperren</button>
    <button type="button" class="btn danger" data-act="wipe">Alles auf diesem Gerät löschen</button>
  </section>
  <section class="card"><h2>Quellen</h2>
    ${(state.trip.quellen || []).map((q) => `<p class="note">${esc(q.titel)}${q.url ? ` · <a href="${esc(q.url)}" target="_blank" rel="noopener">Link</a>` : ''}</p>`).join('')}
  </section>`;
}

function more(goName, label) {
  return `<button type="button" data-go="${goName}">${esc(label)}</button>`;
}

function viewBuchungen(root, state) {
  const t = state.tresor;
  const extra = state.tresorExtra || {};
  root.innerHTML = `<section class="card"><h2>Buchungen</h2>${back()}
    ${flightCard('Hinflug', t.hinflug, [
      ['Buchungscode', t.hinflug.buchungscodeAirline],
      ['eSky-Nummer', t.hinflug.buchungsnummerEsky],
    ], t.hinflug.offen, t.hinflug.gepaeck, t.hinflug.checkinLink, 'Check-in')}
    ${stayCard(t.unterkunft, extra)}
    ${flightCard('Rückflug', t.rueckflug, [['Buchungscode', t.rueckflug.buchungscode]], '', t.rueckflug.gepaeck, t.rueckflug.checkinLink, 'Online-Check-in')}
    <article class="card inner"><h3>Konzerte</h3>
      <p>${esc(t.konzerte.saalreservierung || '')}</p>
      ${t.konzerte.ticketLink18 ? `<a class="tap" href="${esc(t.konzerte.ticketLink18)}" target="_blank" rel="noopener">Ticketseite</a>` : ''}
    </article>
    <h3>Telefonnummern</h3>
    ${(t.kontakte || []).map((c, i) => `<label class="field">${esc(c.name)} <span class="note">${esc(c.rolle || '')}</span>
      <input data-phone="${i}" value="${esc(extra.telefone?.[i] || c.telefon || '')}" inputmode="tel"></label>`).join('')}
    <button type="button" class="btn" data-act="save-phones">Nummern merken</button>
  </section>`;
}

function flightCard(title, f, codes, offen, gepaeck, link, linkLabel) {
  return `<article class="card inner"><h3>${esc(title)}</h3>
    <p>${esc(f.datum || '')}<br>${esc(f.strecke || '')}<br>${esc(f.airline || '')}</p>
    ${codes.filter(([, v]) => v).map(([l, v]) => `<div class="code-row"><span>${esc(l)} <b>${esc(v)}</b></span>
      <button type="button" class="btn" data-act="copy" data-copy="${esc(v)}">Kopieren</button></div>`).join('')}
    ${offen ? `<div class="hl">${esc(offen)}</div>` : ''}
    ${gepaeck ? `<p class="note">${esc(gepaeck)}</p>` : ''}
    ${link ? `<a class="tap" href="${esc(link)}" target="_blank" rel="noopener">${esc(linkLabel)}</a>` : ''}
  </article>`;
}

function stayCard(u, extra) {
  const p = { lat: u.lat, lon: u.lon, adresse: u.adresse, name: u.name };
  return `<article class="card inner"><h3>Unterkunft</h3>
    <p><b>${esc(u.name || '')}</b><br>${esc(u.adresse || '')}</p>
    <a class="btn" href="${mapsUrl(p)}" target="_blank" rel="noopener">Route</a>
    <div class="code-row"><span>Buchungsnummer <b>${esc(u.buchungsnummer || '')}</b></span>
      <button type="button" class="btn" data-act="copy" data-copy="${esc(u.buchungsnummer || '')}">Kopieren</button></div>
    <p class="note">${esc(u.checkin || '')}<br>${esc(u.checkout || '')}</p>
    <p class="note">${esc(u.pinHinweis || '')}</p>
    ${u.chatLink ? `<a class="tap" href="${esc(u.chatLink)}" target="_blank" rel="noopener">Chat mit dem Gastgeber</a>` : ''}
    <label class="field">Türcode <input id="tuercode" value="${esc(extra.tuercode || u.tuercode || '')}" autocomplete="off"></label>
    <button type="button" class="btn" data-act="save-door">Türcode merken</button>
    <p class="note">${esc(u.tuercodeHinweis || '')}</p>
    <p class="note">${esc(u.storno || '')}</p>
  </article>`;
}

function viewNotfall(root, state) {
  const b = state.trip.praktisch?.botschaft || {};
  root.innerHTML = `<section class="card"><h2>Notfall</h2>${back()}
    <a class="btn" href="tel:112">Notruf 112</a>
    <p>${esc(b.name || '')}</p>
    <p>${esc(b.adresse || '')}</p>
    ${b.telefon ? `<a class="btn ghost" href="tel:${esc(b.telefon)}">${esc(b.telefon)}</a>` : ''}
    ${b.notfall ? `<p class="hl">${esc(b.notfall)}</p>` : ''}
    ${b.link ? `<a class="tap" href="${esc(b.link)}" target="_blank" rel="noopener">Seite der Vertretung</a>` : ''}
    <p class="note">${esc(b.hinweis || '')}</p>
  </section>`;
}

function viewPraktisch(root, state) {
  const p = state.trip.praktisch || {};
  root.innerHTML = `<section class="card"><h2>Praktisches</h2>${back()}
    <p>${esc(p.geld || '')}</p>
    <p>${esc(p.nahverkehr || '')}</p>
    ${p.fussweg ? `<p>${esc(p.fussweg)}</p>` : ''}
    <p>${esc(p.flughafen || '')}</p>
    ${p.bahn ? `<div class="hl">${esc(p.bahn)}</div>` : ''}
    <p>${esc(p.wetter || '')}</p>
    <div id="fx" class="card inner"><h3>Lei-Rechner</h3>
      <label class="field">Euro <input id="fxEur" inputmode="decimal" value=""></label>
      <label class="field">Lei <input id="fxLei" inputmode="decimal" value=""></label>
      <p class="note" id="fxStand">Kurs wird geladen …</p>
    </div>
    <button type="button" class="btn" data-go="notfall">Notruf und Vertretung</button>
  </section>`;
  loadFx();
}

function viewSprache(root, state) {
  const sp = state.trip.sprache || {};
  const groups = ['alltag', 'buehne', 'soundcheck', 'milonga'];
  const titles = { alltag: 'Alltag', buehne: 'Bühne', soundcheck: 'Soundcheck', milonga: 'Milonga' };
  const voice = roVoice();
  root.innerHTML = `<section class="card"><h2>Sprache</h2>${back()}
    <p class="note">${esc(sp.hinweis || '')}</p>
    ${groups.map((g) => `<h3>${titles[g]}</h3>` + (sp[g] || []).map(([ro, de], i) => `
      <div class="list-row">
        <div><b>${esc(ro)}</b><div class="note">${esc(de)}</div></div>
        ${voice ? `<button type="button" data-act="speak" data-say="${esc(ro)}">Sprechen</button>` : ''}
      </div>`).join('')).join('')}
  </section>`;
}

function roVoice() {
  if (!window.speechSynthesis) return null;
  return speechSynthesis.getVoices().find((v) => /^ro([-_]|$)/i.test(v.lang)) || null;
}

function viewKonzerte(root, state) {
  const list = state.termine.filter((t) => t.kat === 'konzert');
  root.innerHTML = `<section class="card"><h2>Konzerte</h2>${back('Musik')}
    ${list.map((ev) => concertCard(state, ev)).join('') || '<p>Keine Konzerte im Plan.</p>'}
  </section>`;
}

function concertCard(state, ev) {
  const p = placeOf(state, ev.ort, ev.ortText);
  const sound = state.termine.find((t) => t.kat === 'probe' && t.tag === ev.tag && /soundcheck/i.test(t.titel));
  return `<article class="card inner" data-id="${esc(ev.id)}">
    <h3>${esc(ev.titel)} ${ev.fix ? '🔒' : ''} ${STATUS_MARK[ev.status] || ''}</h3>
    <p>${esc(deDate(ev.tag))} · ${esc(whenPhrase(ev, state))}<br>${esc(p.name || '')}</p>
    ${sound ? `<p class="note">Soundcheck ${esc(sound.start)}–${esc(sound.ende)}</p>` : ''}
    ${ev.status === 'kalender' ? '<p class="hl">Details offen – tippen zum Eintragen</p>' : ''}
    <p class="note">${esc(ev.notiz || '')}</p>
    <div class="btn-row">
      <button type="button" class="btn" data-act="open" data-id="${esc(ev.id)}">Bearbeiten</button>
      <button type="button" class="btn ghost" data-act="share-ev" data-id="${esc(ev.id)}">Konzert teilen</button>
      ${ev.link ? `<a class="btn ghost" href="${esc(ev.link)}" target="_blank" rel="noopener">Tickets</a>` : ''}
      <button type="button" class="btn ghost" data-act="focus-set" data-id="${esc(ev.id)}">Setlist</button>
    </div>
  </article>`;
}

function viewSetlist(root, state) {
  const concerts = state.termine.filter((t) => t.kat === 'konzert');
  const id = state.focusId && concerts.some((c) => c.id === state.focusId) ? state.focusId : (nextConcert(state)?.id || concerts[0]?.id);
  state.focusId = id;
  const rows = (state.setlists && state.setlists[id]) || [];
  const sum = rows.reduce((a, r) => a + (Number(r.dauerMin) || 0), 0);
  root.innerHTML = `<section class="card"><h2>Setlist</h2>${back('Musik')}
    <div class="chips">${concerts.map((c) => `<button type="button" class="chip ${c.id === id ? 'on' : ''}" data-act="focus-set" data-id="${esc(c.id)}">${esc(deDate(c.tag))}</button>`).join('')}</div>
    ${rows.length ? rows.map((r, i) => setRow(r, i, rows.length)).join('') : '<p>Noch nichts eingetragen.</p>'}
    <p class="note">Summe ${sum} min</p>
    <button type="button" class="btn" data-act="set-add">Stück hinzufügen</button>
    <button type="button" class="btn ghost" data-go="buehne">Bühnenmodus</button>
  </section>`;
}

function setRow(r, i, n) {
  return `<article class="ev" data-set="${i}">
    <div><b>${esc(r.titel || 'Ohne Titel')}</b>
      <div class="note">${esc(r.tonart || '')} · ${esc(r.instrument || '')} · ${esc(r.dauerMin || 0)} min</div>
      ${r.notiz ? `<div class="note">${esc(r.notiz)}</div>` : ''}</div>
    <div class="btn-row">
      <button type="button" data-act="set-up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Nach oben">▲</button>
      <button type="button" data-act="set-down" data-i="${i}" ${i === n - 1 ? 'disabled' : ''} aria-label="Nach unten">▼</button>
      <button type="button" data-act="set-edit" data-i="${i}">Ändern</button>
    </div>
  </article>`;
}

function viewProben(root, state) {
  const list = state.termine.filter((t) => t.kat === 'probe');
  const notes = state.probenNotizen || {};
  root.innerHTML = `<section class="card"><h2>Proben</h2>${back('Musik')}
    ${list.map((ev) => `<article class="ev" data-id="${esc(ev.id)}">
      <div><b>${esc(deDate(ev.tag))} ${esc(ev.start)} ${esc(ev.titel)}</b>
        <div class="note">${esc(labelOf(state, ev))}</div></div>
      <label class="field">Was proben? / Was war?
        <textarea data-probe="${esc(ev.id)}">${esc(notes[ev.id] || '')}</textarea></label>
    </article>`).join('')}
    <button type="button" class="btn" data-act="share-proben">${esc(state.trip.texte?.probenTeilen || 'Probenzeiten teilen')}</button>
  </section>`;
}

function viewMilongas(root, state) {
  const order = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const todayWt = wtOf(state.trip, state.today);
  const list = [...state.trip.milongas].sort((a, b) => {
    if (a.wt === todayWt) return -1;
    if (b.wt === todayWt) return 1;
    return order.indexOf(a.wt) - order.indexOf(b.wt);
  });
  const tomorrow = state.trip.tage.find((t) => t.datum > state.today);
  const concertTomorrow = tomorrow && state.termine.some((t) => t.tag === tomorrow.datum && t.kat === 'konzert');
  root.innerHTML = `<section class="card"><h2>Tango-Abende</h2>${back('Musik')}
    <p class="note">${esc(state.trip.praktisch?.nahverkehr || '')}</p>
    ${concertTomorrow ? '<p class="hl">Morgen spielst du – Schluss um 23:30?</p>' : ''}
    ${list.map((m) => milongaCard(state, m, m.wt === todayWt)).join('')}
  </section>`;
}

function milongaCard(state, m, today) {
  const p = placeOf(state, m.ort);
  return `<article class="card inner" data-milonga="${esc(m.id)}">
    <h3>${esc(m.name)} · ${esc(m.wt)} ${today ? '· heute' : ''}</h3>
    <p>${esc(m.zeit)} · ${esc(m.preis || '')}<br>${esc(p.adresse || p.name || '')}</p>
    <p class="note">${esc(m.hinweis || '')}</p>
    <div class="btn-row">
      <a class="btn" href="${mapsUrl(p)}" target="_blank" rel="noopener">Route</a>
      ${m.pruefLink ? `<a class="btn ghost" href="${esc(m.pruefLink)}" target="_blank" rel="noopener">Heute prüfen</a>` : ''}
      <button type="button" class="btn ghost" data-act="milonga-plan" data-milonga="${esc(m.id)}">In den Plan</button>
    </div>
  </article>`;
}

function viewBuehne(root, state) {
  const id = state.focusId || nextConcert(state)?.id;
  const rows = (state.setlists && state.setlists[id]) || [];
  const lines = state.trip.sprache?.buehne || [];
  root.innerHTML = `<section class="stage" id="stage">
    <button type="button" class="btn ghost" data-act="back">Schließen</button>
    ${rows.length ? rows.map((r) => `<p class="stage-line">${esc(r.titel || '')}</p>`).join('') : '<p class="stage-line">Noch keine Setlist.</p>'}
    <div class="stage-phrases">${lines.map(([ro]) => `<p>${esc(ro)}</p>`).join('')}</div>
    <p class="note" id="wakeNote"></p>
  </section>`;
  requestWake();
}

async function requestWake() {
  const note = document.getElementById('wakeNote');
  if (!navigator.wakeLock) {
    if (note) note.textContent = 'Bildschirm bleibt auf diesem Gerät nicht automatisch an.';
    return;
  }
  try {
    S().wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    if (note) note.textContent = 'Bildschirm bleibt auf diesem Gerät nicht automatisch an.';
  }
}

function viewStimm(root, state) {
  const hz = state.einst?.stimm || 440;
  root.innerHTML = `<section class="card"><h2>Stimmton & Metronom</h2>${back('Musik')}
    <div class="btn-row">
      <button type="button" class="btn ${hz === 440 ? '' : 'ghost'}" data-act="tone" data-hz="440">A = 440</button>
      <button type="button" class="btn ${hz === 442 ? '' : 'ghost'}" data-act="tone" data-hz="442">A = 442</button>
      <button type="button" class="btn ghost" data-act="tone-stop">Ton aus</button>
    </div>
    <label class="field">Tempo <input id="bpm" type="number" min="40" max="208" value="${esc(state.einst?.bpm || 80)}"></label>
    <button type="button" class="btn" data-act="metro">Metronom</button>
  </section>`;
}

function viewChecks(root, state) {
  root.innerHTML = `<section class="card"><h2>Listen</h2>${back()}
    <button type="button" class="btn" data-act="open-checks">Liste öffnen</button>
  </section>`;
  openChecklist();
}

function viewBelege(root, state) {
  const rows = allBelege(state);
  root.innerHTML = `<section class="card"><h2>Belege</h2>${back()}
    <form id="belegForm">
      <label class="field">Betrag <input id="belegBetrag" inputmode="decimal" required></label>
      <label class="field">Währung
        <select id="belegWaehrung"><option>EUR</option><option>RON</option></select></label>
      <label class="field">Kategorie
        <select id="belegKat">
          <option>Fahrt</option><option>Unterkunft</option><option>Verpflegung</option><option>Saalmiete</option><option>Sonstiges</option>
        </select></label>
      <label class="field">Text <input id="belegText" required></label>
      <button type="submit" class="btn">Merken</button>
    </form>
    ${rows.map((r) => `<p>${esc(r.datum)} · ${esc(r.kategorie)} · ${esc(r.text)} · ${esc(csvNum(r.betrag))} ${esc(r.waehrung)}</p>`).join('')}
    <button type="button" class="btn" data-act="export-belege">CSV teilen</button>
  </section>`;
}

function viewTagebuch(root, state) {
  const text = (state.tagebuch || {})[state.today] || '';
  root.innerHTML = `<section class="card"><h2>Tagebuch</h2>${back()}
    <label class="field">Moment des Tages
      <textarea id="diary">${esc(text)}</textarea></label>
    <button type="button" class="btn" data-act="save-diary">Merken</button>
    <button type="button" class="btn ghost" data-act="export-diary">Alles teilen</button>
  </section>`;
}

function allBelege(state) {
  return [...(state.tresor.belegeStart || []), ...(state.belege || [])];
}

function nextConcert(state) {
  const list = state.termine.filter((t) => t.kat === 'konzert').sort((a, b) => (a.tag + a.start).localeCompare(b.tag + b.start));
  return list.find((t) => t.tag >= state.today) || list[0] || null;
}

function openSheet(html) {
  const el = document.getElementById('sheet');
  el.hidden = false;
  el.innerHTML = `<div class="sheet-card" role="dialog" aria-modal="true"><button type="button" class="btn icon sheet-x" data-act="close-sheet" aria-label="Schließen">✕</button>${html}</div>`;
  const f = el.querySelector('button, input, select, textarea');
  if (f) f.focus();
}

function closeSheet() {
  const el = document.getElementById('sheet');
  if (!el) return;
  el.hidden = true;
  el.innerHTML = '';
}

function onKey(e) {
  if (e.key !== 'Escape') return;
  const sheet = document.getElementById('sheet');
  if (sheet && !sheet.hidden) { closeSheet(); return; }
  if (document.getElementById('stage')) { go('musik'); }
}

function onSubmit(e) {
  if (e.target.id === 'cmdForm') {
    e.preventDefault();
    runCommand(e.target.cmd.value);
  }
  if (e.target.id === 'belegForm') {
    e.preventDefault();
    addBeleg();
  }
}

function onChange(e) {
  const t = e.target;
  if (t.dataset.check) {
    S().checks = S().checks || {};
    S().checks[t.dataset.check] = t.checked;
    ctx.persist();
    draw();
  } else if (t.dataset.done) {
    setDone(S().overlay, t.dataset.done, t.checked);
    ctx.persist();
    draw();
  } else if (t.id === 'regen') {
    S().einst = S().einst || {};
    S().einst.regen = t.checked;
    ctx.persist();
    draw();
  } else if (t.dataset.probe != null) {
    S().probenNotizen = S().probenNotizen || {};
    S().probenNotizen[t.dataset.probe] = t.value;
    ctx.persist();
  } else if (t.id === 'importFile' && t.files[0]) {
    importBackup(t.files[0]);
  } else if (t.id === 'fxEur' || t.id === 'fxLei') {
    convertFx(t.id);
  }
}

function onClick(e) {
  const goBtn = e.target.closest('[data-go]');
  if (goBtn && !e.target.closest('[data-act]')) {
    go(goBtn.dataset.go);
    return;
  }
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  const id = t.dataset.id;
  const state = S();
  if (act === 'back') { history.length > 1 ? history.back() : go('heute'); return; }
  if (act === 'close-sheet') { closeSheet(); return; }
  if (act === 'copy') { ctx.copyText(t.dataset.copy || ''); return; }
  if (act === 'move') { openMove(id, null); return; }
  if (act === 'schedule') { openMove(null, t.dataset.pool); return; }
  if (act === 'pick-day') { applyPickDay(t.dataset.tag); return; }
  if (act === 'pick-slot') {
    state.sheetSlot = t.dataset.slot;
    document.querySelectorAll('[data-act=pick-slot]').forEach((b) => b.classList.toggle('on', b.dataset.slot === state.sheetSlot));
    return;
  }
  if (act === 'apply-time') { applyTime(); return; }
  if (act === 'swap-with') { doSwapWith(); return; }
  if (act === 'use-suggestion') { useSuggestion(); return; }
  if (act === 'open') { openEvent(id); return; }
  if (act === 'confirm-yes') { state.fixOk = true; openEdit(state.pendingId); return; }
  if (act === 'save-edit') { saveEdit(); return; }
  if (act === 'delete-ev') { removeEvent(state.overlay, state.trip, state.pendingId); ctx.persist(); closeSheet(); draw(); ctx.toast('Entfernt', 'success'); return; }
  if (act === 'new-event') { openNew(); return; }
  if (act === 'save-new') { saveNew(t.dataset.preset || ''); return; }
  if (act === 'preset') { applyPreset(t.dataset.preset); return; }
  if (act === 'undo') { doUndo(); return; }
  if (act === 'restore') { openSheet(`<h3>Originalplan wiederherstellen?</h3><p>Verschiebungen auf diesem Gerät gehen verloren. Andere Einträge bleiben.</p><button type="button" class="btn danger" data-act="restore-yes">Wiederherstellen</button>`); return; }
  if (act === 'restore-yes') { restorePlan(); return; }
  if (act === 'swap-open') { openSwap(); return; }
  if (act === 'swap-go') { doSwapDays(); return; }
  if (act === 'heim') { openHeim(); return; }
  if (act === 'milonga-heute') { openMilongaHeute(); return; }
  if (act === 'setlist-next') { state.focusId = nextConcert(state)?.id; go('setlist'); return; }
  if (act === 'focus-set') { state.focusId = id; go('setlist'); return; }
  if (act === 'set-add') { openSetForm(); return; }
  if (act === 'set-edit') { openSetForm(Number(t.dataset.i)); return; }
  if (act === 'set-save') { saveSet(Number(t.dataset.i)); return; }
  if (act === 'set-up' || act === 'set-down') { moveSet(Number(t.dataset.i), act === 'set-up' ? -1 : 1); return; }
  if (act === 'share-ev') { shareEvent(id); return; }
  if (act === 'share-proben') { shareProben(); return; }
  if (act === 'milonga-plan') { planMilonga(t.dataset.milonga); return; }
  if (act === 'speak') { speak(t.dataset.say); return; }
  if (act === 'map-filter') { state.mapFilter = t.dataset.filter; draw(); return; }
  if (act === 'locate') { locateMe(); return; }
  if (act === 'show-plan') { go('plan'); setTimeout(() => document.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'center' }), 50); return; }
  if (act === 'save-door') { saveDoor(); return; }
  if (act === 'save-phones') { savePhones(); return; }
  if (act === 'save-diary') { saveDiary(); return; }
  if (act === 'export-belege') { exportBelege(); return; }
  if (act === 'export-diary') { exportDiary(); return; }
  if (act === 'share-plan') { ctx.shareText(planText(), 'plan.txt'); return; }
  if (act === 'export-ics') { ctx.downloadText(icsText(), 'fixpunkte.ics', 'text/calendar'); return; }
  if (act === 'export-backup') { ctx.downloadText(JSON.stringify(backupObj(), null, 2), 'sicherung.json', 'application/json'); return; }
  if (act === 'install-seen') {
    state.einst = state.einst || {};
    state.einst.installSeen = true;
    ctx.persist();
    draw();
    return;
  }
  if (act === 'lock') { ctx.lockDevice(); return; }
  if (act === 'wipe') { openSheet(`<h3>Alles löschen?</h3><p>Schlüssel, Planänderungen und Notizen auf diesem Gerät werden entfernt.</p><button type="button" class="btn danger" data-act="wipe-yes">Löschen</button>`); return; }
  if (act === 'wipe-yes') { closeSheet(); ctx.wipeDevice(); return; }
  if (act === 'open-checks') { openChecklist(); return; }
  if (act === 'cmd-pick') { pickCandidate(t); return; }
  if (act === 'tone') { startTone(Number(t.dataset.hz)); return; }
  if (act === 'tone-stop') { stopAudio(); return; }
  if (act === 'metro') { toggleMetro(); return; }
  if (act === 'wiki') { openWiki(t.dataset.wiki); return; }
}

function openMove(id, poolId) {
  const state = S();
  const ev = id ? findMerged(state.termine, id) : draftFromPool(poolId);
  if (!ev) return;
  state.moving = { id: id || null, poolId: poolId || null, base: ev };
  state.sheetSlot = ev.slot || 'vormittag';
  const chips = state.trip.tage.map((day) => {
    const info = chipKind(state.trip, state.termine, ev, day.datum, state.sheetSlot);
    const reason = info.kind === 'bad' ? info.reason : info.kind === 'busy' ? 'belegt' : '';
    return `<button type="button" class="chip ${info.kind}" data-act="pick-day" data-tag="${esc(day.datum)}">${esc(day.wt)} ${esc(deDate(day.datum))}${reason ? ' · ' + esc(reason) : ''}</button>`;
  }).join('');
  const poolChip = `<button type="button" class="chip" data-act="close-sheet">Ideen-Pool</button>`;
  openSheet(`<h3>${esc(ev.titel)}</h3>
    <div class="chips">${chips}${id ? '' : poolChip}</div>
    <div class="chips">${SLOTS.map((s) => `<button type="button" class="chip ${s === state.sheetSlot ? 'on' : ''}" data-act="pick-slot" data-slot="${s}">${esc(s)}</button>`).join('')}</div>
    <label class="field">Uhrzeit <input type="time" id="sheetTime" value="${esc(ev.start || '10:00')}"></label>
    <button type="button" class="btn" data-act="apply-time">Uhrzeit übernehmen</button>`);
}

function draftFromPool(poolId) {
  const idea = S().trip.ideenPool.find((i) => i.id === poolId);
  if (!idea) return null;
  const existing = S().termine.find((t) => t.id === 'eigen-' + idea.id);
  if (existing) return existing;
  return {
    id: 'eigen-' + idea.id, titel: idea.titel, kat: idea.kat, ort: idea.ort, slot: idea.slotEmpfehlung || 'vormittag',
    start: '10:00', ende: '12:00', fix: false, geschlossenAn: idea.geschlossenAn || [], milonga: idea.milonga || '',
    status: idea.status, notiz: idea.notiz, draussen: idea.draussen,
  };
}

function applyPickDay(tag) {
  const state = S();
  const moving = state.moving;
  if (!moving) return;
  const slot = state.sheetSlot || moving.base.slot;
  let result;
  if (moving.poolId && !state.termine.some((t) => t.id === 'eigen-' + moving.poolId)) {
    result = schedulePool(state.overlay, state.trip, state.termine, moving.poolId, tag, slot, moving.base.start);
  } else {
    const id = moving.id || ('eigen-' + moving.poolId);
    result = placeEvent(state.overlay, state.trip, state.termine, id, tag, slot, moving.base.start);
  }
  finishMove(result);
}

function applyTime() {
  const state = S();
  const input = document.getElementById('sheetTime');
  if (!input || !state.moving) return;
  const start = input.value;
  const id = state.moving.id || (state.termine.some((t) => t.id === 'eigen-' + state.moving.poolId) ? 'eigen-' + state.moving.poolId : null);
  const tag = state.moving.base.tag || state.today;
  if (!id) {
    state.moving.base.start = start;
    ctx.toast('Uhrzeit gemerkt – jetzt einen Tag wählen', 'info');
    return;
  }
  const result = placeEvent(state.overlay, state.trip, state.termine, id, tag, state.sheetSlot || state.moving.base.slot, start);
  finishMove(result);
}

function finishMove(result) {
  if (!result) return;
  if (result.blocked) {
    S().suggestion = result;
    openSheet(`<h3>Überschneidung mit einem Fixpunkt</h3>
      <p>${esc(result.hit.titel)} bleibt stehen.</p>
      ${result.suggestion ? `<button type="button" class="btn" data-act="use-suggestion">Stattdessen ${esc(result.suggestion)}</button>` : '<p>Keine freie Lücke an diesem Tag.</p>'}`);
    return;
  }
  ctx.persist();
  closeSheet();
  draw();
  const warn = (result.warnings || []).join(' · ');
  const msg = `${describeMove(S().trip, result.ev)}${warn ? ' · ' + warn : ''}`;
  ctx.toast(msg, 'success', result.occupant ? { label: 'Tauschen', run: () => swapWithOccupant(result.ev.id, result.occupant.id) } : { label: 'Rückgängig', run: () => doUndo() });
}

function swapWithOccupant(a, b) {
  exchangePlaces(S().overlay, S().trip, S().termine, a, b);
  ctx.persist();
  draw();
  ctx.toast('Getauscht', 'success', { label: 'Rückgängig', run: () => doUndo() });
}

function doSwapWith() { /* reserviert */ }

function useSuggestion() {
  const state = S();
  const s = state.suggestion;
  if (!s) return;
  const ev = s.ev;
  const id = state.moving?.id || ev.id;
  const result = placeEvent(state.overlay, state.trip, mergeTermine(state.trip, state.overlay), id, ev.tag, ev.slot, s.suggestion);
  state.suggestion = null;
  finishMove(result);
}

function doUndo() {
  if (undo(S().overlay)) {
    ctx.persist();
    closeSheet();
    draw();
    ctx.toast('Rückgängig', 'info');
  }
}

function restorePlan() {
  const version = S().trip.meta.planVersion;
  S().overlay = { saatVersion: version, aenderungen: {}, eigene: [], entfernt: [], erledigt: [], verlauf: [] };
  ctx.persist();
  closeSheet();
  draw();
  ctx.toast('Originalplan wiederhergestellt', 'success');
}

function openEvent(id) {
  const ev = findMerged(S().termine, id);
  if (!ev) return;
  S().pendingId = id;
  if (ev.fix && !S().fixOk) {
    openSheet(`<h3>Fixpunkt ändern?</h3><p>${esc(ev.titel)}</p><button type="button" class="btn" data-act="confirm-yes">Ja, bearbeiten</button>`);
    return;
  }
  S().fixOk = false;
  openEdit(id);
}

function openEdit(id) {
  const state = S();
  state.fixOk = false;
  const ev = findMerged(state.termine, id);
  if (!ev) return;
  const ortOpts = Object.entries(state.trip.orte).map(([k, o]) => `<option value="${esc(k)}" ${k === ev.ort ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
  const tagOpts = state.trip.tage.map((d) => `<option value="${esc(d.datum)}" ${d.datum === ev.tag ? 'selected' : ''}>${esc(d.wt)} ${esc(deDate(d.datum))}</option>`).join('');
  openSheet(`<h3>${esc(ev.titel)}</h3>
    <label class="field">Titel <input id="edTitel" value="${esc(ev.titel)}"></label>
    <label class="field">Tag <select id="edTag">${tagOpts}</select></label>
    <label class="field">Abschnitt <select id="edSlot">${SLOTS.map((s) => `<option ${s === ev.slot ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    <label class="field">Von <input id="edStart" type="time" value="${esc(ev.start)}"></label>
    <label class="field">Bis <input id="edEnde" type="time" value="${esc(ev.ende)}"></label>
    <label class="field">Ort <select id="edOrtSel">${ortOpts}</select></label>
    <label class="field">Ort als Text <input id="edOrt" value="${esc(ev.ortText || '')}"></label>
    <label class="field">Notiz <textarea id="edNotiz">${esc(ev.notiz || '')}</textarea></label>
    <button type="button" class="btn" data-act="save-edit">Speichern</button>
    ${ev.fix ? '' : '<button type="button" class="btn danger" data-act="delete-ev">Entfernen</button>'}`);
}

function saveEdit() {
  const state = S();
  const id = state.pendingId;
  const ortText = document.getElementById('edOrt').value.trim();
  const fields = {
    titel: document.getElementById('edTitel').value.trim(),
    tag: document.getElementById('edTag').value,
    slot: document.getElementById('edSlot').value,
    start: document.getElementById('edStart').value,
    ende: document.getElementById('edEnde').value,
    ort: document.getElementById('edOrtSel').value,
    ortText,
    notiz: document.getElementById('edNotiz').value,
  };
  if (ortText) fields.ortText = ortText;
  applyFields(state.overlay, state.trip, id, fields);
  ctx.persist();
  closeSheet();
  draw();
  ctx.toast('Gespeichert', 'success');
}

function openNew() {
  const state = S();
  const tagOpts = state.trip.tage.map((d) => `<option value="${esc(d.datum)}">${esc(d.wt)} ${esc(deDate(d.datum))}</option>`).join('');
  const ortOpts = Object.entries(state.trip.orte).map(([k, o]) => `<option value="${esc(k)}">${esc(o.name)}</option>`).join('');
  openSheet(`<h3>Neuer Termin</h3>
    <div class="btn-row">
      <button type="button" class="btn ghost" data-act="preset" data-preset="Probe">Probe</button>
      <button type="button" class="btn ghost" data-act="preset" data-preset="Essen">Essen</button>
      <button type="button" class="btn ghost" data-act="preset" data-preset="Treffen">Treffen</button>
    </div>
    <label class="field">Titel <input id="neTitel"></label>
    <label class="field">Kategorie <select id="neKat">
      ${Object.entries(state.trip.meta.kategorien).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('')}
    </select></label>
    <label class="field">Tag <select id="neTag">${tagOpts}</select></label>
    <label class="field">Abschnitt <select id="neSlot">${SLOTS.map((s) => `<option>${s}</option>`).join('')}</select></label>
    <label class="field">Von <input id="neStart" type="time" value="15:00"></label>
    <label class="field">Bis <input id="neEnde" type="time" value="16:00"></label>
    <label class="field">Ort <select id="neOrt">${ortOpts}</select></label>
    <label class="field">Oder freier Ort <input id="neOrtText"></label>
    <label class="field">Notiz <textarea id="neNotiz"></textarea></label>
    <button type="button" class="btn" data-act="save-new">Speichern</button>`);
}

function applyPreset(name) {
  const titel = document.getElementById('neTitel');
  const kat = document.getElementById('neKat');
  if (!titel || !kat) return;
  const map = { Probe: 'probe', Essen: 'essen', Treffen: 'pause' };
  titel.value = name;
  if (map[name]) kat.value = map[name];
}

function saveNew() {
  const state = S();
  const titel = document.getElementById('neTitel').value.trim();
  if (!titel) { ctx.toast('Bitte einen Titel eingeben.', 'error'); return; }
  const ortText = document.getElementById('neOrtText').value.trim();
  addOwn(state.overlay, {
    id: uid('eigen'),
    titel,
    kat: document.getElementById('neKat').value,
    tag: document.getElementById('neTag').value,
    slot: document.getElementById('neSlot').value,
    start: document.getElementById('neStart').value,
    ende: document.getElementById('neEnde').value,
    ort: document.getElementById('neOrt').value,
    ortText,
    notiz: document.getElementById('neNotiz').value,
    fix: false,
    status: 'vorschlag',
  });
  ctx.persist();
  closeSheet();
  draw();
  ctx.toast('Termin angelegt', 'success');
}

function openSwap() {
  const opts = S().trip.tage.map((d) => `<option value="${esc(d.datum)}">${esc(d.wt)} ${esc(deDate(d.datum))}</option>`).join('');
  openSheet(`<h3>Zwei Tage tauschen</h3>
    <label class="field">Tag A <select id="swapA">${opts}</select></label>
    <label class="field">Tag B <select id="swapB">${opts}</select></label>
    <button type="button" class="btn" data-act="swap-go">Tauschen</button>`);
}

function doSwapDays() {
  const a = document.getElementById('swapA').value;
  const b = document.getElementById('swapB').value;
  if (a === b) { ctx.toast('Bitte zwei verschiedene Tage wählen.', 'error'); return; }
  const res = swapDays(S().overlay, S().trip, S().termine, a, b);
  ctx.persist();
  closeSheet();
  draw();
  const warn = (res.warnings || []).slice(0, 3).join(' · ');
  ctx.toast(`Tage getauscht${warn ? ' · ' + warn : ''}`, 'success', { label: 'Rückgängig', run: () => doUndo() });
}

function runCommand(text) {
  const state = S();
  const action = interpret(state.trip, state.termine, text, state.today);
  applyAction(action);
}

function applyAction(action) {
  const state = S();
  if (action.type === 'noop') { ctx.toast(action.message, 'error'); return; }
  if (action.type === 'ask') {
    const box = document.getElementById('cmdAsk');
    const html = `<p>${esc(action.prompt)}</p><div class="chips">${(action.candidates || []).map((c) =>
      `<button type="button" class="chip" data-act="cmd-pick" data-kind="${esc(c.kind || '')}" data-id="${esc(c.id)}" data-ref="${esc(c.ref || '')}">${esc(c.titel)}</button>`).join('')}</div>`;
    if (box) box.innerHTML = html; else openSheet(html);
    return;
  }
  let result;
  if (action.type === 'move') result = placeEvent(state.overlay, state.trip, state.termine, action.id, action.tag, action.slot, action.start);
  else if (action.type === 'schedule') result = schedulePool(state.overlay, state.trip, state.termine, action.poolId, action.tag, action.slot, action.start || undefined);
  else if (action.type === 'swap-days') result = swapDays(state.overlay, state.trip, state.termine, action.a, action.b);
  else if (action.type === 'swap-events') result = exchangePlaces(state.overlay, state.trip, state.termine, action.a, action.b);
  if (!result) return;
  if (result.blocked) {
    state.moving = { id: result.ev.id, base: result.ev };
    state.suggestion = result;
    openSheet(`<h3>Überschneidung mit einem Fixpunkt</h3>${result.suggestion ? `<button type="button" class="btn" data-act="use-suggestion">Stattdessen ${esc(result.suggestion)}</button>` : ''}`);
    return;
  }
  ctx.persist();
  const ask = document.getElementById('cmdAsk');
  if (ask) ask.innerHTML = '';
  draw();
  const warn = (result.warnings || []).join(' · ');
  const base = result.ev ? describeMove(state.trip, result.ev) : 'Erledigt';
  ctx.toast(`${base}${warn ? ' · ' + warn : ''}`, 'success', { label: 'Rückgängig', run: () => doUndo() });
}

function pickCandidate(btn) {
  const state = S();
  const kind = btn.dataset.kind;
  const id = btn.dataset.id;
  if (kind === 'day' || kind === 'pool-day') {
    const ref = btn.dataset.ref;
    const isPool = kind === 'pool-day' || String(ref).startsWith('pool-');
    applyAction(isPool
      ? { type: 'schedule', poolId: ref, tag: id, slot: 'vormittag', start: '' }
      : { type: 'move', id: ref, tag: id, slot: 'vormittag', start: findMerged(state.termine, ref)?.start });
    return;
  }
  if (kind === 'pool') {
    applyAction({ type: 'ask', prompt: 'An welchem Tag?', candidates: state.trip.tage.map((t) => ({ id: t.datum, titel: `${t.wt} ${deDate(t.datum)}`, kind: 'pool-day', ref: id })) });
    return;
  }
  applyAction({ type: 'ask', prompt: 'An welchem Tag?', candidates: state.trip.tage.map((t) => ({ id: t.datum, titel: `${t.wt} ${deDate(t.datum)}`, kind: 'day', ref: id })) });
}

function openHeim() {
  const u = S().tresor.unterkunft;
  const p = placeOf(S(), 'unterkunft');
  openSheet(`<h3>Unterkunft</h3>
    <p><b>${esc(u.name || '')}</b><br>${esc(u.adresse || '')}</p>
    <a class="btn" href="${mapsUrl(p)}" target="_blank" rel="noopener">Route</a>
    <button type="button" class="btn ghost" data-act="copy" data-copy="${esc(u.adresse || '')}">Adresse kopieren</button>`);
}

function openMilongaHeute() {
  const state = S();
  const ev = state.termine.find((t) => t.tag === state.today && t.kat === 'tango');
  if (!ev) {
    openSheet(`<h3>Heute keine Milonga im Plan</h3><button type="button" class="btn" data-go="milongas">Alle Abende</button>`);
    return;
  }
  const p = placeOf(state, ev.ort, ev.ortText);
  openSheet(`<h3>${esc(ev.titel)}</h3>
    <p>${esc(whenPhrase(ev, state))}<br>${esc(p.adresse || p.name || '')}</p>
    <p class="note">${esc(ev.notiz || '')}</p>
    <a class="btn" href="${mapsUrl(p)}" target="_blank" rel="noopener">Route</a>`);
}

function currentSet() {
  const state = S();
  const id = state.focusId || nextConcert(state)?.id;
  state.focusId = id;
  state.setlists = state.setlists || {};
  if (!state.setlists[id]) state.setlists[id] = [];
  return state.setlists[id];
}

function openSetForm(index = -1) {
  const row = index >= 0 ? currentSet()[index] : { titel: '', tonart: '', instrument: 'Bandoneon', dauerMin: 3, notiz: '' };
  openSheet(`<h3>Stück</h3>
    <label class="field">Titel <input id="setTitel" value="${esc(row.titel || '')}"></label>
    <label class="field">Tonart <input id="setKey" value="${esc(row.tonart || '')}"></label>
    <label class="field">Instrument <select id="setInst">
      ${['Bandoneon', 'Gitarre', 'Gesang'].map((x) => `<option ${row.instrument === x ? 'selected' : ''}>${x}</option>`).join('')}
    </select></label>
    <label class="field">Dauer (Minuten) <input id="setDur" type="number" min="1" value="${esc(row.dauerMin || 3)}"></label>
    <label class="field">Notiz <input id="setNote" value="${esc(row.notiz || '')}"></label>
    <button type="button" class="btn" data-act="set-save" data-i="${index}">Speichern</button>`);
}

function saveSet(index) {
  const list = currentSet();
  const row = {
    titel: document.getElementById('setTitel').value.trim(),
    tonart: document.getElementById('setKey').value.trim(),
    instrument: document.getElementById('setInst').value,
    dauerMin: Number(document.getElementById('setDur').value) || 0,
    notiz: document.getElementById('setNote').value.trim(),
  };
  if (index >= 0) list[index] = row; else list.push(row);
  ctx.persist();
  closeSheet();
  draw();
}

function moveSet(i, dir) {
  const list = currentSet();
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  const [row] = list.splice(i, 1);
  list.splice(j, 0, row);
  ctx.persist();
  draw();
}

function shareEvent(id) {
  const ev = findMerged(S().termine, id);
  if (!ev) return;
  const p = placeOf(S(), ev.ort, ev.ortText);
  const text = [ev.titel, `${deDate(ev.tag)} ${ev.start}`, p.name, ev.link || ''].filter(Boolean).join('\n');
  ctx.shareText(text);
}

function shareProben() {
  const lines = S().termine.filter((t) => t.kat === 'probe').map((t) => `${deDate(t.tag)} ${t.start}–${t.ende} ${t.titel}`);
  ctx.shareText(lines.join('\n'));
}

function planMilonga(id) {
  const state = S();
  const m = state.trip.milongas.find((x) => x.id === id);
  if (!m) return;
  const day = state.trip.tage.find((t) => t.wt === m.wt);
  if (!day) return;
  const ownId = 'eigen-milonga-' + m.id + '-' + day.datum;
  if (state.termine.some((t) => t.id === ownId)) {
    ctx.toast('Steht schon im Plan', 'info');
    return;
  }
  addOwn(state.overlay, {
    id: ownId, titel: m.name, kat: 'tango', ort: m.ort, tag: day.datum, slot: 'abend',
    start: '21:00', ende: '23:30', fix: false, status: 'pruefen', milonga: m.id, notiz: m.hinweis || '',
  });
  ctx.persist();
  draw();
  ctx.toast('In den Plan genommen', 'success');
}

function speak(text) {
  const v = roVoice();
  if (!v || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ro-RO';
  u.voice = v;
  speechSynthesis.speak(u);
}

function saveDoor() {
  S().tresorExtra = S().tresorExtra || {};
  S().tresorExtra.tuercode = document.getElementById('tuercode').value;
  ctx.persist();
  ctx.toast('Türcode gemerkt', 'success');
}

function savePhones() {
  const extra = S().tresorExtra || {};
  extra.telefone = extra.telefone || {};
  document.querySelectorAll('[data-phone]').forEach((el) => { extra.telefone[el.dataset.phone] = el.value; });
  S().tresorExtra = extra;
  ctx.persist();
  ctx.toast('Nummern gemerkt', 'success');
}

function addBeleg() {
  const betrag = String(document.getElementById('belegBetrag').value).replace(',', '.');
  const row = {
    datum: S().today,
    kategorie: document.getElementById('belegKat').value,
    text: document.getElementById('belegText').value.trim(),
    betrag: Number(betrag),
    waehrung: document.getElementById('belegWaehrung').value,
  };
  if (!row.text || !Number.isFinite(row.betrag)) { ctx.toast('Betrag und Text brauchen eine Angabe.', 'error'); return; }
  S().belege = S().belege || [];
  S().belege.push(row);
  ctx.persist();
  draw();
  ctx.toast('Beleg gemerkt', 'success');
}

function belegCsv() {
  const lines = ['Datum;Kategorie;Text;Betrag;Währung'];
  for (const r of allBelege(S())) {
    lines.push([r.datum, r.kategorie, String(r.text).replace(/;/g, ','), csvNum(r.betrag), r.waehrung].join(';'));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

function exportBelege() { ctx.downloadText(belegCsv(), 'belege.csv', 'text/csv'); }

function saveDiary() {
  const el = document.getElementById('diary');
  S().tagebuch = S().tagebuch || {};
  S().tagebuch[S().today] = el.value;
  ctx.persist();
  ctx.toast('Gespeichert', 'success');
}

function exportDiary() {
  const lines = Object.entries(S().tagebuch || {}).map(([d, t]) => `${d}\n${t}`);
  ctx.shareText(lines.join('\n\n') || 'Keine Einträge');
}

function planText() {
  return S().trip.tage.map((day) => {
    const lines = sortedDay(S().termine, day.datum).map((ev) => `${ev.start} ${ev.titel}${ev.fix ? ' [fix]' : ''}`);
    return `${day.wt} ${deDate(day.datum)} ${day.motto}\n${lines.join('\n')}`;
  }).join('\n\n');
}

function icsText() {
  const tz = S().tz;
  const events = S().termine.filter((t) => t.fix).map((ev) => {
    const zone = ev.zeitzone || tz;
    const stamp = (ymd, hm) => ymd.replace(/-/g, '') + 'T' + hm.replace(':', '') + '00';
    return `BEGIN:VEVENT\nUID:${ev.id}@reise\nDTSTART;TZID=${zone}:${stamp(ev.tag, ev.start)}\nDTEND;TZID=${zone}:${stamp(ev.tag, ev.ende)}\nSUMMARY:${ev.titel}\nEND:VEVENT`;
  }).join('\n');
  return `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//reisebegleiter//DE\n${events}\nEND:VCALENDAR\n`;
}

function backupObj() {
  const s = S();
  return {
    plan: s.overlay, tresor: s.tresorExtra, setlists: s.setlists, checks: s.checks,
    belege: s.belege, tagebuch: s.tagebuch, einst: s.einst, probenNotizen: s.probenNotizen,
  };
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const s = S();
      if (data.plan) s.overlay = data.plan;
      if (data.tresor) s.tresorExtra = data.tresor;
      if (data.setlists) s.setlists = data.setlists;
      if (data.checks) s.checks = data.checks;
      if (data.belege) s.belege = data.belege;
      if (data.tagebuch) s.tagebuch = data.tagebuch;
      if (data.einst) s.einst = data.einst;
      if (data.probenNotizen) s.probenNotizen = data.probenNotizen;
      ctx.persist();
      draw();
      ctx.toast('Sicherung geladen', 'success');
    } catch {
      ctx.toast('Die Datei ließ sich nicht lesen.', 'error');
    }
  };
  reader.readAsText(file);
}

function openChecklist() {
  const state = S();
  const data = checklistData(state);
  const tabs = Object.keys(data);
  let active = tabs[0];
  const ov = document.createElement('div');
  ov.className = 'cl-overlay';
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
  const modal = document.createElement('div');
  modal.className = 'cl-modal';
  function paint() {
    const sections = data[active];
    const names = Object.keys(sections);
    const all = names.flatMap((n) => sections[n]);
    const done = all.filter((it) => state.checks?.[it.id]).length;
    const pct = all.length ? Math.round(done / all.length * 100) : 0;
    modal.innerHTML = `<div class="cl-header"><h3>Listen</h3><button type="button" class="btn icon cl-x" aria-label="Schließen">✕</button></div>
      <div class="cl-tabs">${tabs.map((t) => `<button type="button" class="cl-tab ${t === active ? 'active' : ''}" data-tab="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="cl-progress"><div class="cl-progress-bar" style="width:${pct}%"></div></div>
      <p class="note">${done}/${all.length} erledigt (${pct}%)</p>
      <div class="cl-items">${names.map((n) => `<div class="cl-section">${esc(n)}</div>` + sections[n].map((it) => {
        const on = !!state.checks?.[it.id];
        return `<label class="check-row ${on ? 'done' : ''}"><input type="checkbox" data-clid="${esc(it.id)}" ${on ? 'checked' : ''}><span>${esc(it.text)}${it.note ? `<div class="note">${esc(it.note)}</div>` : ''}</span></label>`;
      }).join('')).join('')}</div>
      <div class="btn-row"><button type="button" class="btn ghost" data-cl="reset">Zurücksetzen</button><button type="button" class="btn" data-cl="export">Offene kopieren</button></div>`;
    modal.querySelector('.cl-x').onclick = () => ov.remove();
    modal.querySelectorAll('.cl-tab').forEach((b) => { b.onclick = () => { active = b.dataset.tab; paint(); }; });
    modal.querySelectorAll('[data-clid]').forEach((cb) => {
      cb.onchange = () => {
        state.checks = state.checks || {};
        state.checks[cb.dataset.clid] = cb.checked;
        ctx.persist();
        paint();
      };
    });
    modal.querySelector('[data-cl=export]').onclick = () => {
      const open = all.filter((it) => !state.checks?.[it.id]).map((it) => '☐ ' + it.text);
      ctx.copyText(open.join('\n') || 'Alles erledigt');
    };
    modal.querySelector('[data-cl=reset]').onclick = () => {
      all.forEach((it) => { if (state.checks) delete state.checks[it.id]; });
      ctx.persist();
      paint();
    };
  }
  paint();
  ov.appendChild(modal);
  document.body.appendChild(ov);
}

function checklistData(state) {
  const vor = {};
  for (const it of state.trip.vorDerReise || []) {
    vor[it.bis] = vor[it.bis] || [];
    vor[it.bis].push({ id: it.id, text: it.titel, note: it.detail });
  }
  const pack = {};
  const groups = state.trip.packliste || {};
  for (const [name, items] of Object.entries(groups)) {
    pack[name] = (Array.isArray(items) ? items : [items]).map((text, i) => ({ id: 'pack-' + name + '-' + i, text: String(text) }));
  }
  return { 'Vor der Reise': Object.keys(vor).length ? vor : { Allgemein: [] }, Packliste: pack };
}

let audioCtx = null;
let toneOsc = null;
let metroTimer = null;

function audio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function startTone(hz) {
  stopAudio();
  S().einst = S().einst || {};
  S().einst.stimm = hz;
  ctx.persist();
  const c = audio();
  toneOsc = c.createOscillator();
  const g = c.createGain();
  toneOsc.frequency.value = hz;
  g.gain.value = 0.08;
  toneOsc.connect(g).connect(c.destination);
  toneOsc.start();
  draw();
}

function stopAudio() {
  if (toneOsc) { try { toneOsc.stop(); } catch { /* schon aus */ } toneOsc = null; }
  if (metroTimer) { clearInterval(metroTimer); metroTimer = null; }
}

function toggleMetro() {
  if (metroTimer) { stopAudio(); ctx.toast('Metronom aus', 'info'); return; }
  const bpm = Math.max(40, Math.min(208, Number(document.getElementById('bpm')?.value) || 80));
  S().einst = S().einst || {};
  S().einst.bpm = bpm;
  ctx.persist();
  const c = audio();
  const tick = () => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = 1000;
    g.gain.value = 0.1;
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.05);
  };
  tick();
  metroTimer = setInterval(tick, Math.round(60000 / bpm));
}

async function loadFx() {
  const stand = document.getElementById('fxStand');
  if (!stand) return;
  let kurs = S().kurs;
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=EUR&to=RON');
    if (res.ok) {
      const data = await res.json();
      if (data?.rates?.RON) {
        kurs = { rate: data.rates.RON, datum: data.date };
        S().kurs = kurs;
        ctx.persist();
      }
    }
  } catch { /* offline */ }
  if (!kurs) { stand.textContent = 'Kein Kurs gespeichert. Bitte später erneut öffnen.'; return; }
  stand.textContent = `1 EUR = ${String(kurs.rate).replace('.', ',')} RON, Stand ${kurs.datum}`;
}

function convertFx(which) {
  const kurs = S().kurs;
  if (!kurs?.rate) return;
  const eur = document.getElementById('fxEur');
  const lei = document.getElementById('fxLei');
  if (which === 'fxEur') {
    const n = Number(String(eur.value).replace(',', '.'));
    if (Number.isFinite(n)) lei.value = (n * kurs.rate).toFixed(2).replace('.', ',');
  } else {
    const n = Number(String(lei.value).replace(',', '.'));
    if (Number.isFinite(n)) eur.value = (n / kurs.rate).toFixed(2).replace('.', ',');
  }
}

export async function loadWeather(state) {
  const box = document.getElementById('wetter');
  if (!box) return;
  const c = state.trip.meta.kartenMitte;
  if (!c) { box.textContent = state.trip.praktisch?.wetter || ''; return; }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=7&timezone=${encodeURIComponent(state.tz)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('wetter');
    const data = await res.json();
    const i = (data.daily.time || []).indexOf(state.today);
    const idx = i >= 0 ? i : 0;
    const max = data.daily.temperature_2m_max[idx];
    const min = data.daily.temperature_2m_min[idx];
    const rain = data.daily.precipitation_probability_max[idx];
    box.textContent = `${Math.round(min)}–${Math.round(max)} °C, Regenwahrscheinlichkeit ${rain} %`;
    if (rain > 60) box.textContent += ' · Regen-Schalter im Plan ansehen';
  } catch {
    box.textContent = state.trip.praktisch?.wetter || 'Wetter gerade nicht erreichbar.';
  }
}

export function afterDrawWeather() {
  if (S().route === 'heute') loadWeather(S());
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => {
      if (S().route === 'sprache') draw();
    };
  }
}

async function openWiki(title) {
  if (!title) return;
  try {
    const res = await fetch('https://de.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title));
    if (!res.ok) throw new Error('wiki');
    const data = await res.json();
    openSheet(`<h3>${esc(data.title || title)}</h3><p>${esc(data.extract || '')}</p>${data.content_urls?.desktop?.page ? `<a class="tap" href="${esc(data.content_urls.desktop.page)}" target="_blank" rel="noopener">Wikipedia</a>` : ''}`);
  } catch {
    ctx.toast('Lexikon gerade nicht erreichbar.', 'error');
  }
}

export { draw };
