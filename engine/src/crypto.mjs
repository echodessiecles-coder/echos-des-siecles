// Chiffrement des données privées (prix d'achat, marges, commandes, clients).
// Le dépôt est public : tout ce qui est privé est stocké chiffré en AES-256-GCM.
// La clé vient d'une phrase secrète (PBKDF2 SHA-256). Ce module marche à
// l'identique dans le navigateur (admin) et dans Node 20+ (moteur).

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const ITER = 210000;

const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const keyCache = new Map();
async function deriveKey(passphrase, salt) {
  const id = passphrase + '|' + b64(salt);
  if (keyCache.has(id)) return keyCache.get(id);
  const base = await subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  keyCache.set(id, key);
  return key;
}

export async function encryptJSON(obj, passphrase) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return JSON.stringify({ v: 1, alg: 'AES-256-GCM/PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) });
}

export async function decryptJSON(text, passphrase) {
  const box = typeof text === 'string' ? JSON.parse(text) : text;
  if (!box || box.v !== 1) throw new Error('Format de fichier chiffré inconnu');
  const key = await deriveKey(passphrase, unb64(box.salt));
  try {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
    return JSON.parse(dec.decode(pt));
  } catch {
    throw new Error('Phrase secrète incorrecte');
  }
}
