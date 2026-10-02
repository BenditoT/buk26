export function partsInZone(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const p = {};
  for (const x of fmt.formatToParts(date)) p[x.type] = x.value;
  return p;
}

export function ymdInZone(date, tz) {
  const p = partsInZone(date, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

export function hmInZone(date, tz) {
  const p = partsInZone(date, tz);
  return `${p.hour}:${p.minute}`;
}

/** Wanduhr-Zeit in der Zeitzone als absolutes Date. */
export function zonedWallToDate(isoLocal, tz) {
  const [d, t] = isoLocal.split('T');
  const [Y, M, D] = d.split('-').map(Number);
  const [h, m] = (t || '00:00').split(':').map(Number);
  let utc = Date.UTC(Y, M - 1, D, h, m);
  const want = Date.UTC(Y, M - 1, D, h, m);
  for (let i = 0; i < 3; i++) {
    const p = partsInZone(new Date(utc), tz);
    const got = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    utc += want - got;
  }
  return new Date(utc);
}

export function eventBounds(ev, tzDefault) {
  const tz = ev.zeitzone || tzDefault;
  const start = zonedWallToDate(`${ev.tag}T${ev.start}`, tz);
  let end = zonedWallToDate(`${ev.tag}T${ev.ende}`, tz);
  if (end <= start) end = new Date(end.getTime() + 86400000);
  return { start, end };
}

export function formatClock(date, tz) {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
}

export function relPhrase(ms) {
  if (ms < 0) return 'läuft';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'gleich';
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `in ${h} h ${rm}` : `in ${h} h`;
}
