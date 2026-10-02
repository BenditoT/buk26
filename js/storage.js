function k(key) { return 'buk.' + key; }

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(k(key));
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(k(key), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadRaw(key) {
  try { return localStorage.getItem(k(key)); } catch { return null; }
}

export function saveRaw(key, value) {
  try {
    localStorage.setItem(k(key), value);
    return true;
  } catch {
    return false;
  }
}

export function remove(key) {
  try { localStorage.removeItem(k(key)); } catch { /* leer */ }
}

export function keys() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (name && name.startsWith('buk.')) out.push(name.slice(4));
    }
  } catch { /* leer */ }
  return out;
}

export function clearAll() {
  for (const key of keys()) remove(key);
}
