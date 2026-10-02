// crypto.mjs — Verschlüsselung der Reisedaten
// ---------------------------------------------------------------------------
// EIN Modul für Build (Node >= 18) UND Browser: nutzt nur die Web Crypto API
// (globalThis.crypto.subtle). Keine Abhängigkeiten.
//
// Verfahren:  Passphrase --PBKDF2-SHA256 (600.000 Runden, fester Projekt-Salt)-->
//             256-bit-Schlüssel --AES-256-GCM (zufälliger 96-bit-IV pro Build)-->
//             Blob { v, kdf, iter, salt, iv, ct }   (alles Base64)
//
// Warum so:   Das Repo auf GitHub Pages ist öffentlich. Dort liegt NUR der Blob.
//             Ohne Passphrase ist er nicht lesbar; ein falsches Passwort scheitert
//             am GCM-Auth-Tag (kein separater Passwort-Hash nötig).
//
// NICHT ÄNDERN ohne Opus-Review: Runden, Algorithmen, Blob-Format.
// ---------------------------------------------------------------------------

export const KDF_ITERATIONS = 600000;
const FORMAT_VERSION = 1;

const te = new TextEncoder();
const td = new TextDecoder();

function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error('Web Crypto nicht verfügbar – Seite muss über https:// oder http://localhost laufen.');
  }
  return c.subtle;
}

export function toB64(bytes) {
  let s = '';
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromB64(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/** Passphrase vereinheitlichen: Unicode-normalisiert, ohne Leerzeichen/Bindestriche, klein. */
export function normalizePassphrase(p) {
  return String(p).normalize('NFKC').replace(/[\s-]+/g, '').toLowerCase();
}

/** Zufällige Passphrase, gut tippbar: 5 Gruppen à 4 Zeichen (ca. 100 Bit). */
export function generatePassphrase() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // ohne i, l, o, 0, 1
  const limit = 256 - (256 % alphabet.length);          // Rejection Sampling gegen Modulo-Bias
  const out = [];
  while (out.length < 20) {
    const buf = globalThis.crypto.getRandomValues(new Uint8Array(32));
    for (const b of buf) {
      if (b < limit && out.length < 20) out.push(alphabet[b % alphabet.length]);
    }
  }
  return out.join('').replace(/(.{4})(?=.)/g, '$1-');
}

export function generateSaltB64() {
  return toB64(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

/** Leitet die 32 Schlüssel-Bytes ab (langsam – Ergebnis darf lokal gecacht werden). */
export async function deriveKeyBytes(passphrase, saltB64, iterations = KDF_ITERATIONS) {
  const base = await subtle().importKey('raw', te.encode(normalizePassphrase(passphrase)), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations },
    base,
    256
  );
  return new Uint8Array(bits);
}

async function importAesKey(keyBytes, usages) {
  return subtle().importKey('raw', keyBytes, { name: 'AES-GCM' }, false, usages);
}

/** Build-Seite: Objekt -> verschlüsselter Blob. saltB64 fest pro Projekt (privat/key.json). */
export async function encryptJSON(obj, passphrase, saltB64) {
  if (!saltB64) throw new Error('saltB64 fehlt (fester Projekt-Salt aus privat/key.json).');
  const keyBytes = await deriveKeyBytes(passphrase, saltB64);
  const key = await importAesKey(keyBytes, ['encrypt']);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj)));
  return {
    v: FORMAT_VERSION,
    kdf: 'PBKDF2-SHA256',
    iter: KDF_ITERATIONS,
    salt: saltB64,
    iv: toB64(iv),
    ct: toB64(new Uint8Array(ct)),
  };
}

/** App-Seite, schneller Weg: mit bereits abgeleiteten Schlüssel-Bytes entschlüsseln. */
export async function decryptWithKeyBytes(blob, keyBytes) {
  if (!blob || blob.v !== FORMAT_VERSION) throw new Error('Unbekanntes Datenformat – App neu laden.');
  const key = await importAesKey(keyBytes, ['decrypt']);
  let plain;
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(blob.iv) }, key, fromB64(blob.ct));
  } catch (e) {
    const err = new Error('Falsches Passwort oder beschädigte Daten.');
    err.code = 'BAD_KEY';
    throw err;
  }
  return JSON.parse(td.decode(plain));
}

/** App-Seite, erster Start: Passphrase -> { data, keyB64 }. keyB64 lokal merken, dann nie wieder tippen. */
export async function decryptJSON(blob, passphrase) {
  const keyBytes = await deriveKeyBytes(passphrase, blob.salt, blob.iter);
  const data = await decryptWithKeyBytes(blob, keyBytes);
  return { data, keyB64: toB64(keyBytes) };
}
