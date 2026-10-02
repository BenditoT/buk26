export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function minutes(t) {
  const [h, m] = String(t || '00:00').split(':').map(Number);
  return h * 60 + m;
}

export function fmtMinutes(total) {
  let t = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60);
  const m = t % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

export function durationMin(ev) {
  let a = minutes(ev.start);
  let b = minutes(ev.ende);
  if (b <= a) b += 1440;
  return b - a;
}

export function interval(ev) {
  const a = minutes(ev.start);
  let b = minutes(ev.ende);
  if (b <= a) b += 1440;
  return [a, b];
}

export function overlaps(a, b) {
  return a[0] < b[1] && b[0] < a[1];
}

export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function deDate(ymd) {
  const [y, m, d] = ymd.split('-');
  return `${d}.${m}.`;
}

export function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

export function csvNum(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '';
  return x.toFixed(2).replace('.', ',');
}

export function uid(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}
