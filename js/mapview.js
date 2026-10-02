let map = null;
let layers = [];

export function destroyMap() {
  if (map) {
    map.remove();
    map = null;
  }
  layers = [];
}

function colorFor(kat) {
  const m = {
    reise: '#3d5a80', unterkunft: '#5a0d18', konzert: '#c8962f', probe: '#a67c2d',
    tango: '#8b3a62', tourismus: '#7a1320', essen: '#a65d2e', pause: '#2e7d4f', online: '#3d6b8c',
  };
  return m[kat] || '#7a1320';
}

export function renderMap(root, ctx) {
  destroyMap();
  const { state, placeOf, mapsUrl, esc } = ctx;
  const filter = state.mapFilter || 'heute';
  const today = state.today;
  const points = collect(state, placeOf, filter, today);
  const online = navigator.onLine !== false;
  root.innerHTML = `
    <div class="chips" role="group" aria-label="Kartenfilter">
      ${['heute', 'alles', 'musik', 'tango', 'stadt'].map((f) =>
        `<button type="button" class="chip ${filter === f ? 'on' : ''}" data-act="map-filter" data-filter="${f}">${label(f)}</button>`).join('')}
      <button type="button" class="chip" data-act="locate">Wo bin ich?</button>
    </div>
    ${online ? '<div id="map"></div>' : '<div class="card"><p>Ohne Netz zeige ich die Orte als Liste. Die Routen-Links bleiben nutzbar.</p></div>'}
    <div class="card" id="mapList">${listHtml(points, mapsUrl, esc)}</div>`;
  if (!online || typeof L === 'undefined') return;
  const center = state.trip.meta.kartenMitte || { lat: 0, lon: 0, zoom: 12 };
  const el = document.getElementById('map');
  if (!el) return;
  try {
    map = L.map(el, { scrollWheelZoom: false, zoomControl: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);
    const latlngs = [];
    points.forEach((p, i) => {
      if (p.lat == null) return;
      const icon = L.divIcon({
        className: '',
        html: `<div class="poi-marker" style="background:${colorFor(p.kat)}">${esc(p.icon || '')}</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
      const marker = L.marker([p.lat, p.lon], { icon }).addTo(map);
      const html = `<b>${esc(p.name)}</b><br>${esc(p.hinweis || '')}<br>
        <a href="${mapsUrl(p)}" target="_blank" rel="noopener">Route</a>
        ${p.eventId ? ` · <button type="button" data-act="show-plan" data-id="${esc(p.eventId)}">Im Plan zeigen</button>` : ''}`;
      marker.bindPopup(html);
      layers.push(marker);
      latlngs.push([p.lat, p.lon]);
    });
    if (filter === 'heute' && latlngs.length > 1) {
      const line = L.polyline(latlngs, { color: '#7a1320', weight: 4, opacity: 0.75 }).addTo(map);
      layers.push(line);
    }
    if (latlngs.length) map.fitBounds(latlngs, { padding: [28, 28] });
    else map.setView([center.lat, center.lon], center.zoom || 12);
    setTimeout(() => map && map.invalidateSize(), 60);
  } catch {
    el.innerHTML = '<div class="note">Karte konnte nicht geladen werden. Die Liste darunter bleibt nutzbar.</div>';
  }
}

function label(f) {
  return { heute: 'Heute', alles: 'Alles', musik: 'Musik', tango: 'Tango', stadt: 'Stadt' }[f] || f;
}

function collect(state, placeOf, filter, today) {
  const seen = new Set();
  const rows = [];
  const events = state.termine.filter((ev) => {
    if (filter === 'heute') return ev.tag === today;
    if (filter === 'musik') return ev.kat === 'konzert' || ev.kat === 'probe';
    if (filter === 'tango') return ev.kat === 'tango';
    if (filter === 'stadt') return ev.kat === 'tourismus';
    return true;
  });
  const ordered = filter === 'heute'
    ? events.slice().sort((a, b) => a.start.localeCompare(b.start))
    : events;
  for (const ev of ordered) {
    const p = placeOf(state, ev.ort, ev.ortText);
    if (p.lat == null && !p.adresse) continue;
    const key = `${p.lat},${p.lon},${p.adresse}`;
    if (filter !== 'heute' && seen.has(key)) continue;
    seen.add(key);
    rows.push({
      name: p.name, adresse: p.adresse, lat: p.lat, lon: p.lon, hinweis: p.hinweis || ev.titel,
      kat: ev.kat, icon: icon(ev.kat), eventId: ev.id,
    });
  }
  return rows;
}

function icon(kat) {
  return { reise: '✈', unterkunft: '⌂', konzert: '♬', probe: '♪', tango: '💃', tourismus: '🏛', essen: '🍽', pause: '🌿', online: '💻' }[kat] || '•';
}

function listHtml(points, mapsUrl, esc) {
  if (!points.length) return '<p>Keine Orte für diesen Filter.</p>';
  return points.map((p) => `
    <div class="list-row">
      <div><b>${esc(p.name)}</b><div class="note">${esc(p.hinweis || '')}</div></div>
      <a class="tap" href="${mapsUrl(p)}" target="_blank" rel="noopener">Route</a>
      ${p.eventId ? `<button type="button" data-act="show-plan" data-id="${esc(p.eventId)}">Im Plan</button>` : ''}
    </div>`).join('');
}

export function locateMe() {
  if (!map || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((pos) => {
    const ll = [pos.coords.latitude, pos.coords.longitude];
    L.circleMarker(ll, { radius: 8, color: '#7a1320', fillColor: '#c8962f', fillOpacity: 1 }).addTo(map);
    map.setView(ll, 15);
  }, () => {}, { enableHighAccuracy: true, timeout: 8000 });
}
